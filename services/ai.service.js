import axios from 'axios';
import dotenv from 'dotenv';
import { runNeo4jQuery } from '../config/neo4j.config.js';

dotenv.config();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Check formatting quality of AI response
 * Returns score based on presence of required formatting elements
 */
const checkFormattingQuality = (text) => {
    if (!text) return { score: 0, details: {} };

    const hasMainTitle = /###\s+.+/g.test(text);
    const hasSubtitles = /####\s+.+/g.test(text);
    const hasBulletPoints = /^[\s]*[-*]\s+.+/gm.test(text);
    const hasNumberedLists = /^\d+\.\s+.+/gm.test(text);
    const hasBoldText = /\*\*.+?\*\*/g.test(text);
    const hasCodeBlocks = /```[\s\S]*?```/g.test(text);
    const hasInlineCode = /`.+?`/g.test(text);
    const hasFormulas = /\[.+?\]/g.test(text);

    const titleCount = (text.match(/###\s+.+/g) || []).length;
    const subtitleCount = (text.match(/####\s+.+/g) || []).length;

    return {
        score: (hasMainTitle ? 15 : 0) +
            (hasSubtitles ? 15 : 0) +
            (hasBulletPoints ? 10 : 0) +
            (hasNumberedLists ? 10 : 0) +
            (hasBoldText ? 10 : 0) +
            (hasCodeBlocks ? 5 : 0) +
            (hasInlineCode ? 5 : 0) +
            (hasFormulas ? 5 : 0) +
            (titleCount >= 1 ? 5 : 0) +
            (subtitleCount >= 2 ? 10 : 0),
        details: {
            hasMainTitle,
            hasSubtitles,
            hasBulletPoints,
            hasNumberedLists,
            hasBoldText,
            hasCodeBlocks,
            hasInlineCode,
            hasFormulas,
            titleCount,
            subtitleCount
        }
    };
};

/**
 * Calculate comprehensive confidence score based on multiple parameters
 * Returns final score (0-100) and detailed breakdown
 */
const calculateConfidence = (params) => {
    const {
        aiConfidence = 85,
        hasContext = false,
        hasSelectedText = false,
        hasVisualContext = false,
        isVisionMode = false,
        responseLength = 0,
        hasFormatting = { score: 0 },
        contentType = 'text',
        isVerifiedSource = false
    } = params;

    // Base score from AI (35% weight for AI, 50% for verified)
    const aiWeight = isVerifiedSource ? 0.50 : 0.35;
    const aiScore = Math.min(100, Math.max(0, aiConfidence)) * aiWeight;

    // Context quality score (25% weight)
    let contextScore = 0;
    if (hasSelectedText) contextScore += 12; // Specific text selected
    if (hasContext) contextScore += 8; // General context available
    if (hasVisualContext) contextScore += 5; // Visual positioning data
    contextScore = Math.min(25, contextScore);

    // Response quality score (20% weight)
    let responseScore = 0;
    if (responseLength >= 400) responseScore = 20;
    else if (responseLength >= 200) responseScore = 15;
    else if (responseLength >= 100) responseScore = 10;
    else responseScore = 5;

    // Formatting quality score (20% weight) - increased for AI to reward "Smart Tutor" structure
    const formattingScore = (hasFormatting.score / 100) * 20;

    // Verified Source Bonus
    const sourceBonus = isVerifiedSource ? 10 : 0;

    // Calculate final score
    const finalScore = Math.round(aiScore + contextScore + responseScore + formattingScore + sourceBonus);

    return {
        finalScore: Math.min(100, Math.max(0, finalScore)),
        breakdown: {
            aiConfidence: {
                value: Math.round(aiScore / aiWeight),
                weight: `${aiWeight * 100}%`,
                contribution: Math.round(aiScore)
            },
            contextQuality: {
                weight: '25%',
                contribution: Math.round(contextScore)
            },
            responseQuality: {
                weight: '20%',
                contribution: Math.round(responseScore)
            },
            formattingQuality: {
                weight: '20%',
                contribution: Math.round(formattingScore)
            },
            summary: {
                totalScore: Math.min(100, Math.max(0, finalScore)),
                reliability: finalScore >= 85 ? 'High' :
                    finalScore >= 70 ? 'Good' :
                        finalScore >= 50 ? 'Moderate' : 'Low'
            }
        }
    };
};

// Helper to get embeddings from ML service (Rule 1)
const getEmbedding = async (text) => {
    try {
        const response = await axios.post('https://ml-service-etaott.onrender.com/embeddings', { text });
        return response.data.success ? response.data.embedding : null;
    } catch (error) {
        console.warn('Embedding service unavailable:', error.message);
        return null;
    }
};

/**
 * Search Knowledge Graph for semantic match (Rule 1 & 2)
 */
export const searchKnowledgeGraph = async (query, courseId = null, context = '') => {
    try {
        // Rule 1: Combine query with context for better semantic search on follow-ups
        const searchPhrase = (query.split(' ').length < 4 && context)
            ? `${query} (context: ${context.substring(0, 100)})`
            : query;

        const embedding = await getEmbedding(searchPhrase);
        if (!embedding) return { match: false, confidence: 0 };

        // Neo4j Vector Search
        // We prioritize course-specific matches but allow global matches with higher score
        const cypher = `
            CALL db.index.vector.queryNodes('doubt_vector_index', 5, $embedding)
            YIELD node, score
            WHERE score >= 0.75
            MATCH (node)-[:ANSWERS]->(a:Answer)
            OPTIONAL MATCH (node)-[:RELATES_TO]->(c:Course {id: $courseId})
            RETURN node.text as question, a.text as answer, score * 100 as confidence, (c IS NOT NULL) as isSameCourse
            ORDER BY isSameCourse DESC, score DESC LIMIT 1
        `;

        const result = await runNeo4jQuery(cypher, { embedding, courseId });
        if (result.records.length > 0) {
            const record = result.records[0];
            return {
                match: true,
                question: record.get('question'),
                answer: record.get('answer'),
                confidence: record.get('confidence'),
                source: 'KNOWLEDGE_GRAPH'
            };
        }
        return { match: false, confidence: 0 };
    } catch (error) {
        console.warn('Knowledge Graph search failed:', error.message);
        return { match: false, confidence: 0 };
    }
};

export const searchExistingDoubts = async (query, context = '', contentId = null) => {
    try {
        const searchKey = `${query.toLowerCase().trim()}${context ? '|' + context.toLowerCase().trim() : ''}`;

        // 1. Try to find an exact doubt match linked to THIS specific content first
        if (contentId) {
            const contentSpecificResult = await runNeo4jQuery(
                `MATCH (c:Content {id: $contentId})<-[:RELATES_TO]-(d:Doubt {queryKey: $searchKey})
                 WHERE d.confidence >= 80
                 RETURN d.answer as answer, d.confidence as confidence
                 LIMIT 1`,
                { contentId, searchKey }
            );

            if (contentSpecificResult.records.length > 0) {
                return {
                    answer: contentSpecificResult.records[0].get('answer'),
                    confidence: contentSpecificResult.records[0].get('confidence'),
                    source: 'content_knowledge_base'
                };
            }
        }

        // 2. Fallback to global doubt search
        const globalResult = await runNeo4jQuery(
            `MATCH (d:Doubt)
             WHERE d.queryKey = $searchKey
             AND d.confidence >= 80
             RETURN d.answer as answer, d.confidence as confidence
             LIMIT 1`,
            { searchKey }
        );

        if (globalResult.records.length > 0) {
            return {
                answer: globalResult.records[0].get('answer'),
                confidence: globalResult.records[0].get('confidence'),
                source: 'graph_db'
            };
        }
        return null;
    } catch (error) {
        console.error('Error searching existing doubts:', error);
        return null;
    }
};

/**
 * Call Groq Llama to answer a doubt
 */
/**
 * Save high-confidence resolution to Knowledge Graph (Rule 3 & 5)
 */
export const saveToKnowledgeGraph = async (params) => {
    const { query, answer, confidence, courseId, contentId, context, selectedText } = params;

    // Confidence threshold check (Rule 3)
    if (confidence < 80) return null;

    try {
        const embedding = await getEmbedding(query);
        if (!embedding) return null;

        const cypher = `
            MERGE (q:Question {text: $query})
            SET q.embedding = $embedding, q.timestamp = datetime()
            
            MERGE (a:Answer {text: $answer})
            SET a.confidence = $confidence, a.source = "AI_GENERATED", a.timestamp = datetime()
            
            MERGE (q)-[:ANSWERS]->(a)
            
            WITH q, a
            MATCH (c:Course {id: $courseId})
            MERGE (q)-[:RELATES_TO]->(c)
            
            // Link to specific content resource if available
            WITH q, a, c
            MATCH (r:Content {id: $contentId})
            MERGE (q)-[:GENERATED_FROM_RESOURCE]->(r)

            // Auto-detect concepts (Basic simulation - Rule 5)
            WITH q, c
            UNWIND split($query, ' ') as word
            WHERE size(word) > 5
            MERGE (con:Concept {name: apoc.text.capitalize(word)})
            MERGE (q)-[:RELATES_TO]->(con)
            MERGE (con)-[:PART_OF]->(c)
            
            RETURN q.text as saved
        `;

        await runNeo4jQuery(cypher, {
            query,
            answer,
            confidence,
            embedding,
            courseId,
            contentId: contentId || '',
            context: context || '',
            selectedText: selectedText || ''
        });

        console.log(`✅ Resolution saved to Knowledge Graph (Confidence: ${confidence}%)`);
        return true;
    } catch (error) {
        console.warn('Failed to save to Knowledge Graph:', error.message);
        return false;
    }
};

export const askGroq = async (query, context = '', visualContext = null, contentUrl = null, contentType = null, language = 'english', userName = 'Student', selectedText = '', userKey = null) => {
    try {
        let spatialInfo = '';
        let isVisionMode = false;
        const activeApiKey = userKey || GROQ_API_KEY;

        if (!activeApiKey) {
            throw new Error('NO_API_KEY');
        }

        if (visualContext && contentUrl && contentType === 'image') {
            // Enable vision mode for region-specific visual queries on images
            isVisionMode = true;
        }

        if (visualContext) {
            spatialInfo = `\n### CRITICAL CONTEXT: REGION OF INTEREST (ROI)
The student has MANUALLY HIGHLIGHTED a specific area on their screen. 
YOUR MISSION: Analyze and explain the contents of this SPECIFIC HIGHLIGHTED area in detail. 
Explain visual elements, nodes, diagrams, or components shown in that exact region. 
Act as if you are pointing your finger at that box and teaching the student about its specific contents.`;
        }

        const activeModel = isVisionMode ? (process.env.GROQ_VISION_MODEL || 'llama-3.2-11b-vision-preview') : (process.env.GROQ_MODEL || 'llama-3.3-70b-versatile');

        // Advanced Language Detection & Instruction (Rule 9/11)
        const hindiKeywords = /hindi|samajha|batao|kaise|kya|kyun|hindi|hinglish|karo|do|kaun|kab|apka|tumhara|aap|hai|hoon|tha|the|thi/i;
        const isHindiDetected = hindiKeywords.test(query) || language.toLowerCase() === 'hindi';
        const detectedLanguage = isHindiDetected ? 'hindi' : 'english';

        let languageInstruction = "";
        if (detectedLanguage === 'hindi') {
            languageInstruction = `
- **LANGUAGE**: STRICT HINGLISH ONLY (Hindi words written in English script).
- **CRITICAL**: Use Hindi vocabulary but ONLY Latin letters. Absolutely NO Devanagari (हिंदी नहीं).
- **TONE**: Natural, conversational, and direct "Aap" style.
- **STYLE**: Explain complex concepts using everyday Hinglish analogies (e.g., "Jaise auto-pilot kaam karta hai...").
- **ABSOLUTELY NO ENGLISH WORDS**: Use Hindi vocabulary exclusively. Example: "computer" → "computer", "network" → "network" (technical terms can stay), but "understand" → "samajhna", "explain" → "samjhana".
- **CONSISTENCY**: Every sentence must be in Hinglish. No switching to English mid-response.`;
        } else {
            languageInstruction = `
- **LANGUAGE**: FULL PROFESSIONAL ENGLISH ONLY.
- **CRITICAL**: No Hinglish mixing, no "smjha?", no "batao", no Hindi words at all.
- **TONE**: Senior Academic Mentor. Precise and technical.
- **CONSISTENCY**: Every sentence must be in pure English. No code-switching to Hindi/Hinglish.`;
        }

        const isStrictRegion = context.startsWith('STRICT_REGION_CONTEXT:');
        let systemPrompt = "";

        // Intelligence check for query type
        const isCodingQuery = /code|programming|java|python|javascript|script|algorithm|function|class/i.test(query) || /code|programming/i.test(selectedText);
        const isExplicitCodeRequest = /show\s+code|example\s+in|write\s+a\s+program|snippet/i.test(query);

        if (isStrictRegion) {
            const rawGrounding = context.replace('STRICT_REGION_CONTEXT: ', '');
            let gc = { transcriptSegment: '', selectedTimestamp: '', courseContext: '', facultyResources: '' };
            try { gc = JSON.parse(rawGrounding); } catch (e) { }

            systemPrompt = `You are an expert precision tutor. The student is focusing on a SPECIFIC visual region.

[[CONCEPT]] 
Start directly with a professional explanation of what the student has selected.
- NO MENTION of timestamps, "frame number", or "at 0:02".
- Explain visual elements, nodes, or diagrams in this specific selection confidently. 
- Use ONLY provided context: "${gc.transcriptSegment}".
- Ground your analysis in ${gc.courseContext}.
- If the selection is not clear from the data, explicitly state: "The selected region is not fully clear from extracted data. Please adjust your selection."
- AVOID VAGUE GUESSING (no "likely", "might", "probably"). Confident extraction-based explanation only.

STRICT: No greetings. No "Namaste". No intro fluff. No code unless the selection itself is a code snippet. No summary headings.`;
        } else {
            // Adaptive General Prompt
            systemPrompt = `You are a high-speed professional academic mentor. Provide a direct, crystal-clear response.

LANGUAGE RULES:
${languageInstruction}

ADAPTIVE STRUCTURE:
[[INTRO]] -> [[CONCEPT]] -> [[CODE]] -> [[SUMMARY]]
- **DIRECT START**: Start the answer immediately. Skip long "I can help with that" preambles.
- **EXPLANATION**: Provide a direct explanation grounded in ${selectedText || context || 'General curriculum'}. Use analogies to make it "click" instantly.
- **NO TIMESTAMPS**: Never mention time/frame references.
- **FACTS ONLY**: No "likely" or "probably". Be confident based on the provided material.

CRITICAL CONSTRAINTS:
- **STRICT: FIRST-STRIKE ANSWERS**. The first sentence must be the core answer or a direct response to the query.
- **CONSTRUCTION**: Use extracted transcript, OCR text, and faculty resources. 
- **NO UI NOISE**: Do not mention confidence, markers, or metadata.
- **STRICT: NO URLs IN TEXT**.
- Use ### for Section Headers.
- Use ${userName}'s name once in the greeting.

TABLE FORMATTING:
- Use markdown tables for comparisons or structured data.`;
        }

        const messages = [];

        if (isVisionMode && contentUrl) {
            try {
                const imageResponse = await axios.get(contentUrl, { responseType: 'arraybuffer' });
                const base64Image = Buffer.from(imageResponse.data, 'binary').toString('base64');
                const mimeType = contentUrl.endsWith('.png') ? 'image/png' : 'image/jpeg';

                messages.push({
                    role: 'user',
                    content: [
                        { type: 'text', text: systemPrompt + "\n\nACTUAL STUDENT QUERY: " + query },
                        {
                            type: 'image_url',
                            image_url: { url: `data:${mimeType};base64,${base64Image}` }
                        }
                    ]
                });
            } catch (imgError) {
                console.warn('Failed to encode image for vision:', imgError.message);
                messages.push({ role: 'system', content: systemPrompt });
                messages.push({ role: 'user', content: query });
            }
        } else {
            messages.push({ role: 'system', content: systemPrompt });
            messages.push({ role: 'user', content: query });
        }

        const response = await axios.post(
            GROQ_API_URL,
            {
                model: isVisionMode ? (process.env.GROQ_VISION_MODEL || 'llama-3.2-11b-vision-preview') : GROQ_MODEL,
                messages: messages,
                temperature: 0.6,
                max_tokens: 2048
            },
            {
                headers: {
                    'Authorization': `Bearer ${activeApiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        ).catch(err => {
            if (err.response?.status === 413 || err.response?.status === 429) {
                throw new Error('API_LIMIT_REACHED');
            }
            if (err.response?.status === 401) {
                throw new Error('INVALID_API_KEY');
            }
            throw err;
        });

        const rawContent = response.data.choices[0].message.content;
        const hasFormatting = checkFormattingQuality(rawContent);

        // Calculate dynamic confidence score (Rule 7)
        const confidenceResult = calculateConfidence({
            aiConfidence: 85, // Base assumption for 70b-versatile
            hasContext: !!context,
            hasSelectedText: !!selectedText,
            hasVisualContext: !!visualContext,
            isVisionMode,
            responseLength: rawContent.length,
            hasFormatting,
            contentType
        });

        return {
            explanation: rawContent,
            confidence: confidenceResult.finalScore,
            confidenceBreakdown: confidenceResult.breakdown,
            source: isVisionMode ? 'groq_vision' : 'groq_llama'
        };
    } catch (error) {
        console.error('Groq AI call failed:', error.message);
        throw new Error('AI Tutor is currently unavailable.');
    }
};

export const saveDoubtToGraph = async (query, answer, confidence, context = '', contentId = null) => {
    try {
        const queryKey = `${query.toLowerCase().trim()}${context ? '|' + context.toLowerCase().trim() : ''}`;
        await runNeo4jQuery(
            `MERGE(d: Doubt { queryKey: $queryKey })
             SET d.query = $query, d.context = $context, d.answer = $answer,
                 d.confidence = $confidence, d.updatedAt = datetime()
             WITH d
             OPTIONAL MATCH(c: Content { id: $contentId })
             FOREACH(ignoreMe IN CASE WHEN c IS NOT NULL THEN [1] ELSE [] END |
                 MERGE(d)-[:RELATES_TO]->(c)
             )`,
            { queryKey, query: query.trim(), context: context.trim(), answer, confidence, contentId }
        );
    } catch (error) {
        console.error('Error saving doubt to graph:', error);
    }
};

export default {
    searchExistingDoubts,
    askGroq,
    saveDoubtToGraph,
    searchKnowledgeGraph,
    saveToKnowledgeGraph
};
