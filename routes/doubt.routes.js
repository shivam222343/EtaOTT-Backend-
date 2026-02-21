import express from 'express';
import { authenticate, attachUser } from '../middleware/auth.middleware.js';
import { requireFaculty } from '../middleware/role.middleware.js';
import Doubt from '../models/Doubt.model.js';
import Course from '../models/Course.model.js';
import Content from '../models/Content.model.js';
import User from '../models/User.model.js';
import aiService from '../services/ai.service.js';
import youtubeService from '../services/youtube.service.js';
import { emitToCourse, emitToUser } from '../services/websocket.service.js';
import { runNeo4jQuery } from '../config/neo4j.config.js';
import Notification from '../models/Notification.model.js';
import { sendNotification } from '../services/websocket.service.js';
import { guestRateLimit } from '../middleware/guestRateLimit.middleware.js';
import { extractWithML } from '../services/extraction/ml.service.js';

const router = express.Router();

/**
 * WhatsApp/Guest Layer - Primary Entry point
 * Non-persistent, Rate-limited, KG-aware, and supports Multimodal Media
 */
router.post('/whatsapp-guest', guestRateLimit, async (req, res) => {
    try {
        const { query, institutionCode, mediaUrl, mediaType, guestId } = req.body;

        if (!query && !mediaUrl) {
            return res.status(400).json({ success: false, message: 'Query or media is required' });
        }

        let guestContext = {};

        // 1. Multimodal Handling (PDF/Image Context Extraction)
        if (mediaUrl) {
            try {
                const tempId = guestId || 'guest_temp';
                console.log(`📸 WhatsApp Guest: Extracting context from ${mediaType || 'media'}...`);
                // Use a standard type if none provided
                const type = mediaType || (mediaUrl.toLowerCase().endsWith('.pdf') ? 'pdf' : 'image');
                const extraction = await extractWithML(mediaUrl, tempId, type);
                guestContext.extractedText = extraction?.text || extraction?.content || '';
                console.log(`✅ Extracted ${guestContext.extractedText.length} chars for guest context`);
            } catch (err) {
                console.warn('⚠️ Guest media extraction failed:', err.message);
                // Continue with query if extraction fails
            }
        }

        // 2. Resolve via specialized Guest Service (Neo4j KG + Groq)
        const result = await aiService.resolveGuestDoubt(query || 'Explain what is in this image/document', institutionCode, guestContext);

        res.json(result);
    } catch (error) {
        console.error('❌ WhatsApp Guest Error:', error);
        res.status(500).json({
            success: false,
            answer: "Eta is experiencing high traffic in this guest layer. Please try again or log in to your portal for faster resolution!"
        });
    }
});

/**
 * Ask a doubt - Main resolution workflow
 */
router.post('/ask', authenticate, attachUser, async (req, res) => {
    try {
        let { query, selectedText, courseId, contentId, context, visualContext } = req.body;
        const studentId = req.dbUser._id;

        if (!query || !courseId) {
            return res.status(400).json({ success: false, message: 'Query and Course ID are required' });
        }

        // Fetch user with API key for this request
        const user = await User.findById(studentId).select('+groqApiKey');

        // Fetch content details early to get extracted data
        const contentDoc = await Content.findById(contentId).populate('courseId');
        const contentUrl = contentDoc?.file?.url;
        const contentType = contentDoc?.type || 'video';
        const fullTranscript = contentDoc?.extractedData?.text || '';

        // Rule 3: Construct structured context object
        let groundingContext = {
            selectedTimestamp: null,
            transcriptSegment: null,
            detectedTextFromFrame: null, // To be filled by Vision
            detectedObjects: null,       // To be filled by Vision
            courseContext: contentDoc?.courseId?.name || 'General Course',
            facultyResources: contentDoc?.title || 'Main content'
        };

        let isRegionSelect = false;
        let enhancedContext = selectedText || context || '';

        // 1. Process Region Selection (Rule 1 & 3)
        if (visualContext) {
            isRegionSelect = true;

            if (contentType === 'video') {
                // Extract timestamp from selectedText: "(Video Focus - Analyzing Frame [at 1:23])"
                const timeMatch = selectedText?.match(/\[at (\d+):(\d+)\]/);
                if (timeMatch) {
                    const mins = parseInt(timeMatch[1]);
                    const secs = parseInt(timeMatch[2]);
                    const totalSeconds = mins * 60 + secs;
                    groundingContext.selectedTimestamp = `${mins}:${secs.toString().padStart(2, '0')}`;

                    if (fullTranscript) {
                        // Rule 1: Extract transcript segment ±30 seconds
                        const wordsPerSec = 2.5;
                        const windowSeconds = 30;
                        const words = fullTranscript.split(/\s+/);
                        const startIdx = Math.max(0, Math.floor((totalSeconds - windowSeconds) * wordsPerSec));
                        const endIdx = Math.floor((totalSeconds + windowSeconds) * wordsPerSec);
                        groundingContext.transcriptSegment = words.slice(startIdx, endIdx).join(' ');
                    }
                }
            } else {
                // For PDF, Web, etc., use the manual text selection passed from frontend
                // Filter out UI placeholders before using as primary context
                const uiPlaceholders = [
                    /\(Visual Scan - AI Analysis\)/g,
                    /\(Video Focus - Analyzing Frame.*?\)/g,
                    /\(Image Focus - AI Vision\)/g,
                    /\(Visual Scan.*?\)/g
                ];
                let cleanSelectedText = (selectedText || '').trim();
                uiPlaceholders.forEach(regex => {
                    cleanSelectedText = cleanSelectedText.replace(regex, '');
                });

                groundingContext.transcriptSegment = cleanSelectedText || selectedText;
            }

            // Rule 7: Knowledge Graph Integration - Fetch related concept nodes
            try {
                const graphData = await runNeo4jQuery(
                    `MATCH (c:Content {id: $contentId})-[:COVERS|TEACHES]->(node)
                     RETURN node.name as name, labels(node)[0] as type
                     LIMIT 5`,
                    { contentId: contentId.toString() }
                );
                if (graphData.records.length > 0) {
                    groundingContext.facultyResources += ` | Related Nodes: ${graphData.records.map(r => r.get('name')).join(', ')}`;
                }
            } catch (gError) {
                console.warn('Neo4j context fetch failed:', gError.message);
            }
        }

        // Apply grounding to enhanced context for Groq
        if (isRegionSelect) {
            // Check if transcriptSegment is empty or just a placeholder/UI tag
            const isPlaceholder = /^\(.*\)$/.test(groundingContext.transcriptSegment?.trim() || '');

            // Ensure transcriptSegment has at least some real content from the resource
            if ((!groundingContext.transcriptSegment || isPlaceholder) && fullTranscript) {
                groundingContext.transcriptSegment = fullTranscript.substring(0, 3500); // Robust fallback
            }
            enhancedContext = `STRICT_REGION_CONTEXT: ${JSON.stringify(groundingContext)}`;

            // Rule 15: Enhance mentor visibility - Add transcript content to selectedText for video doubts
            if (contentType === 'video' && groundingContext.transcriptSegment) {
                selectedText = `${selectedText}\n\n[Extracted Video Content]: ${groundingContext.transcriptSegment}`;
            }
        } else if (fullTranscript && !enhancedContext.includes(fullTranscript.substring(0, 50))) {
            // General content fallback
            const sample = fullTranscript.substring(0, 2000);
            enhancedContext += `\n\n[Context]: ${sample}`;
        }

        // 1. Rule 2 & 4: Search Knowledge Graph First (Neo4j Semantic Memory - Cache First)
        const kgResult = await aiService.searchKnowledgeGraph(query, courseId, selectedText || groundingContext.facultyResources);

        // Prepare common vars for video search and AI
        const language = req.body.language || 'english';
        const userName = req.dbUser.profile?.name || 'Student';

        if (kgResult && kgResult.confidence >= 85) {
            console.log(`🎯 CACHE HIT (Neo4j): Confidence ${kgResult.confidence}%`);

            // Still try to get a video in parallel for cache hits but don't block too long or just use saved one if exists
            // For now, prioritize speed for KG hits by returning immediately
            const doubt = await Doubt.create({
                studentId,
                courseId,
                contentId,
                query,
                selectedText,
                context: enhancedContext,
                visualContext,
                aiResponse: kgResult.answer,
                confidence: kgResult.confidence,
                status: 'resolved',
                isFromCache: true,
                source: 'KNOWLEDGE_GRAPH'
            });

            return res.json({
                success: true,
                message: 'Answer retrieved from Knowledge Graph',
                data: {
                    doubt,
                    isFromCache: true,
                    isSaved: true,
                    source: 'KNOWLEDGE_GRAPH',
                    confidence: kgResult.confidence
                }
            });
        }

        // 2. CACHE MISS: Run AI first, then use its response context to suggest videos
        console.log('⚡ Cache miss: Generating AI response first to capture context');

        const aiResult = await aiService.askGroq(
            query,
            enhancedContext,
            visualContext,
            contentUrl,
            contentType,
            language,
            userName,
            selectedText,
            user?.groqApiKey
        );

        // Perform YouTube Search using AI's response context
        const suggestedVideo = await (async () => {
            try {
                // Skip if conversational or greeting (Rule 14)
                if (aiResult.isConversational) return null;
                const conversationalKeywords = /^(hi|hello|hey|namaste|hola|good morning|yo|who are you|thanks|thank|ok|bye)/i;
                if (conversationalKeywords.test(query.trim()) && query.length < 30) return null;

                // Build high-precision search topic using: Query + Selection + AI Response context
                const uiPlaceholders = [/\(Visual Scan - AI Analysis\)/g, /\(Video Focus - Analyzing Frame.*?\)/g, /\(Image Focus - AI Vision\)/g, /\[\[INTRO\]\]/g, /\[\[CONCEPT\]\]/g, /\[\[CODE\]\]/g, /\[\[SUMMARY\]\]/g];

                let cleanSelectedText = (selectedText || '').trim();
                uiPlaceholders.forEach(regex => { cleanSelectedText = cleanSelectedText.replace(regex, ''); });

                // Extract core concept from AI response (Skip intro markers)
                let aiContext = aiResult.explanation.replace(/\[\[.*?\]\]/g, '').substring(0, 80).trim();

                let searchTopic = "";
                if (cleanSelectedText && cleanSelectedText.length > 5) {
                    // Highest priority: Selection + AI's technical interpretation
                    searchTopic = `${cleanSelectedText.substring(0, 60)} ${aiContext}`;
                } else {
                    // Fallback: Query + AI's technical interpretation
                    searchTopic = `${query.substring(0, 50)} ${aiContext}`;
                }

                const videoSearchQuery = `${searchTopic} ${language === 'hindi' ? 'hindi' : 'english'} tutorial`.substring(0, 100);
                const searchResults = await youtubeService.searchVideos(videoSearchQuery, { userId: studentId, language });

                if (searchResults && searchResults.length > 0) {
                    const freshVideo = searchResults[0];
                    return {
                        id: freshVideo.id,
                        url: freshVideo.url,
                        title: freshVideo.title,
                        thumbnail: freshVideo.thumbnail,
                        views: freshVideo.views,
                        searchQuery: videoSearchQuery
                    };
                }
            } catch (err) {
                console.warn('Post-AI video discovery failed:', err.message);
            }
            return null;
        })();

        // Clean up video placeholders if no video found
        if (!suggestedVideo && aiResult.explanation.includes('[[VIDEO:')) {
            aiResult.explanation = aiResult.explanation.replace(/\[\[VIDEO:?\s*[^\]]*\]\]/g, '\n\n*No high-quality video found specifically for this subtopic.*');
        }

        // Save high-confidence AI responses to Neo4j Graph (Auto-Learning)
        let isSaved = false;
        if (aiResult.confidence >= 70) {
            try {
                await aiService.saveToKnowledgeGraph({
                    query,
                    answer: aiResult.explanation,
                    confidence: aiResult.confidence,
                    courseId,
                    contentId,
                    context: enhancedContext,
                    selectedText
                });
                isSaved = true;
            } catch (saveErr) {
                console.warn('Failed to save to KG:', saveErr.message);
            }
        }

        const doubt = await Doubt.create({
            studentId,
            courseId,
            contentId,
            query,
            selectedText,
            context: enhancedContext,
            visualContext,
            aiResponse: aiResult.explanation,
            confidence: aiResult.confidence,
            confidenceBreakdown: aiResult.confidenceBreakdown,
            suggestedVideo,
            isFromCache: false,
            source: 'AI_API',
            isConversational: aiResult.isConversational || false,
            status: aiResult.confidence >= 80 ? 'resolved' : 'pending'
        });

        res.json({
            success: true,
            message: aiResult.confidence >= 80 ? 'AI Mentor resolved your doubt!' : 'AI provided a tentative answer, but confidence is low.',
            data: {
                doubt,
                isFromCache: false,
                isSaved,
                isConversational: aiResult.isConversational || false,
                source: 'AI_API',
                confidence: aiResult.confidence
            }
        });
    } catch (error) {
        console.error('AI Error:', error.message);

        // Return specific error codes for frontend handling
        if (error.message === 'API_LIMIT_REACHED' || error.message === 'INVALID_API_KEY' || error.message === 'NO_API_KEY') {
            return res.status(401).json({
                success: false,
                message: error.message === 'NO_API_KEY' ? 'Please provide your Groq API key' : 'Your Groq API key limits reached or key is invalid',
                errorCode: error.message
            });
        }

        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * Update Groq API Key
 */
router.post('/config/groq-key', authenticate, attachUser, async (req, res) => {
    try {
        const { apiKey } = req.body;
        if (!apiKey) return res.status(400).json({ success: false, message: 'API Key is required' });

        const user = await User.findByIdAndUpdate(req.dbUser._id, {
            groqApiKey: apiKey,
            'aiOnboarding.skipCount': 0 // Reset if they finally provided it
        }, { new: true }).select('+groqApiKey');

        res.json({ success: true, message: 'Groq API Key updated successfully', data: { user } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * Handle Onboarding interaction tracking
 */
router.post('/config/onboarding-skip', authenticate, attachUser, async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.dbUser._id, {
            $inc: { 'aiOnboarding.skipCount': 1 },
            'aiOnboarding.lastModalShown': new Date()
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * Escalate a doubt to a mentor
 */
router.post('/:id/escalate', authenticate, attachUser, async (req, res) => {
    try {
        const doubt = await Doubt.findById(req.params.id);
        if (!doubt) return res.status(404).json({ success: false, message: 'Doubt not found' });

        doubt.escalated = true;
        doubt.status = 'escalated';
        await doubt.save();

        // Notify course faculty via WebSocket and Database
        const course = await Course.findById(doubt.courseId).populate('facultyIds');
        if (course) {
            for (const facultyId of course.facultyIds) {
                const notification = await Notification.create({
                    recipientId: facultyId,
                    type: 'doubt_escalated',
                    title: 'New Doubt Escalated',
                    message: `${req.dbUser.profile.name} escalated a doubt in "${course.name}"`,
                    metadata: {
                        doubtId: doubt._id,
                        courseId: course._id,
                        query: doubt.query,
                        selectedText: doubt.selectedText,
                        aiResponse: doubt.aiResponse
                    }
                });
                sendNotification(facultyId, notification);
            }
        }

        // Keep the existing socket call for legacy support if needed, but sendNotification handles it better now
        emitToCourse(doubt.courseId, 'doubt:escalated', {
            doubtId: doubt._id,
            query: doubt.query,
            studentName: req.dbUser.profile.name
        });

        res.json({ success: true, message: 'Doubt escalated to mentors' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * Answer an escalated doubt (Faculty Only)
 */
router.post('/:id/answer', authenticate, attachUser, requireFaculty, async (req, res) => {
    try {
        const { answer, saveToGraph = true } = req.body;
        const doubt = await Doubt.findById(req.params.id);

        if (!doubt) return res.status(404).json({ success: false, message: 'Doubt not found' });

        doubt.facultyAnswer = answer;
        doubt.answeredBy = req.dbUser._id;
        doubt.status = 'answered';
        doubt.resolvedAt = new Date();
        await doubt.save();

        // Save mentor's verified answer to Graph DB if toggled
        if (saveToGraph) {
            const mentorContext = doubt.selectedText || doubt.context || '';
            await aiService.saveDoubtToGraph(doubt.query, answer, 100, mentorContext, doubt.contentId);
        }

        // Notify student via WebSocket and Database
        const notification = await Notification.create({
            recipientId: doubt.studentId,
            type: 'doubt_answered',
            title: 'Doubt Answered',
            message: `Your doubt "${doubt.query.substring(0, 30)}..." has been answered by a mentor.`,
            metadata: {
                doubtId: doubt._id,
                answeredBy: req.dbUser._id
            }
        });
        sendNotification(doubt.studentId, notification);

        // Keep existing socket call
        emitToUser(doubt.studentId, 'doubt:answered', {
            doubtId: doubt._id,
            answer,
            query: doubt.query
        });

        res.json({ success: true, message: 'Answered and saved to knowledge base' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * Get student's doubt history
 */
router.get('/my-doubts', authenticate, attachUser, async (req, res) => {
    try {
        const doubts = await Doubt.find({ studentId: req.dbUser._id })
            .sort({ createdAt: -1 })
            .populate('courseId', 'name');
        res.json({ success: true, data: { doubts } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * Get escalated doubts for a course (Faculty Only)
 */
router.get('/escalated/:courseId', authenticate, attachUser, requireFaculty, async (req, res) => {
    try {
        const doubts = await Doubt.find({
            courseId: req.params.courseId,
            status: 'escalated'
        })
            .populate('studentId', 'profile.name')
            .sort({ createdAt: -1 });

        res.json({ success: true, data: { doubts } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

export default router;
