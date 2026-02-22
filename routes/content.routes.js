import express from 'express';
import axios from 'axios';
import cloudinary from '../config/cloudinary.config.js';
import { authenticate, attachUser } from '../middleware/auth.middleware.js';
import { requireFaculty } from '../middleware/role.middleware.js';
import { uploadWithThumbnail, validateFileSize, getContentType } from '../services/upload.service.js';
import Content from '../models/Content.model.js';
import Course from '../models/Course.model.js';
import Doubt from '../models/Doubt.model.js';
import Branch from '../models/Branch.model.js';
import { deleteFromCloudinary } from '../config/cloudinary.config.js';
import { extractPDFData, generateSummary } from '../services/extraction/pdf.extractor.js';
import { extractVideoMetadata, formatDuration, getQualityLabel } from '../services/extraction/video.extractor.js';
import { extractCodeData } from '../services/extraction/code.extractor.js';
import { extractWithML } from '../services/extraction/ml.service.js';
import {
    createContentNode,
    linkContentToCourse,
    createTopicNodes,
    createConceptNodes,
    linkRelatedContent,
    getLearningPath,
    getRecommendations,
    recordView,
    getContentGraph,
    deleteContentNode
} from '../services/graph/content.graph.js';
import { processContent } from '../services/content_processing.service.js';
import { emitToCourse } from '../services/websocket.service.js';
import { runNeo4jQuery } from '../config/neo4j.config.js';
import GeneratedPDF from '../models/GeneratedPDF.model.js';
import { cleanScrapedContent } from '../services/contentCleaner.service.js';
import { formatContentWithAI } from '../services/aiFormatter.service.js';
import { generateStyledPDF } from '../services/pdfGenerator.service.js';
import { uploadBufferToCloudinary } from '../config/cloudinary.config.js';

const router = express.Router();

// Get recent content for current user
router.get('/recent', authenticate, attachUser, async (req, res) => {
    try {
        let query = { isActive: true };

        if (req.dbUser.role === 'faculty') {
            query.uploadedBy = req.dbUser._id;
        } else if (req.dbUser.role === 'student') {
            // Content belonging to branches the student has joined
            query.branchIds = { $in: req.dbUser.branchIds || [] };
        }

        const totalContent = await Content.countDocuments(query);
        const recentContent = await Content.find(query)
            .populate('courseId', 'name code')
            .populate('uploadedBy', 'profile.name')
            .sort({ createdAt: -1 })
            .limit(10);

        res.json({
            success: true,
            data: {
                recentContent,
                totalContent
            }
        });
    } catch (error) {
        console.error('Get recent content error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get recent content',
            error: error.message
        });
    }
});

// Upload and create content
router.post('/', authenticate, attachUser, requireFaculty, uploadWithThumbnail, validateFileSize, async (req, res) => {
    try {
        const file = req.files?.file?.[0] || req.file;
        const thumbnail = req.files?.thumbnail?.[0];

        if (!file) {
            return res.status(400).json({
                success: false,
                message: 'No file uploaded'
            });
        }

        const { courseId, title, description, difficulty, category, tags } = req.body;

        // Verify course exists and user is faculty
        const course = await Course.findById(courseId);
        if (!course) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }

        if (!course.facultyIds.includes(req.dbUser._id)) {
            return res.status(403).json({
                success: false,
                message: 'You are not authorized to upload content to this course'
            });
        }

        // Determine content type
        const contentType = getContentType(file.mimetype);

        // Prepare file object
        const fileData = {
            url: file.path,
            publicId: file.filename,
            format: file.mimetype.split('/')[1],
            size: file.size
        };

        // Add thumbnail if provided
        if (thumbnail) {
            fileData.thumbnail = {
                url: thumbnail.path,
                publicId: thumbnail.filename
            };
        }

        // Create content record
        const content = await Content.create({
            courseId,
            branchIds: course.branchIds,
            institutionId: course.institutionId,
            title: title || file.originalname,
            description,
            type: contentType,
            file: fileData,
            metadata: {
                difficulty: difficulty || 'intermediate',
                category,
                tags: tags ? JSON.parse(tags) : []
            },
            uploadedBy: req.dbUser._id,
            processingStatus: 'pending',
            isPublished: true, // Show to students immediately
            publishedAt: new Date()
        });

        // Link content to course and increment stats
        await Course.findByIdAndUpdate(courseId, {
            $push: { contentIds: content._id },
            $inc: { 'stats.totalContent': 1 }
        });

        // Notify students via WebSocket
        try {
            emitToCourse(courseId, 'content:uploaded', {
                contentId: content._id,
                title: content.title,
                type: content.type,
                courseId: courseId,
                timestamp: new Date()
            });
        } catch (wsError) {
            console.error('WebSocket notification error:', wsError);
        }

        // Start background processing (don't wait for it)
        processContent(content._id, contentType, file.path).catch(err => {
            console.error('Content processing error:', err);
        });

        res.status(201).json({
            success: true,
            message: 'Content uploaded successfully. Processing in background...',
            data: { content }
        });
    } catch (error) {
        console.error('Upload content error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to upload content',
            error: error.message
        });
    }
});

// Add YouTube Video
router.post('/youtube', authenticate, attachUser, requireFaculty, async (req, res) => {
    try {
        const { courseId, title, url, description, difficulty, category, tags } = req.body;

        if (!url) {
            return res.status(400).json({ success: false, message: 'YouTube URL is required' });
        }

        // Basic YouTube URL validation
        const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+$/;
        if (!youtubeRegex.test(url)) {
            return res.status(400).json({ success: false, message: 'Invalid YouTube URL' });
        }

        // Verify course exists
        const course = await Course.findById(courseId);
        if (!course) {
            return res.status(404).json({ success: false, message: 'Course not found' });
        }

        if (!course.facultyIds.includes(req.dbUser._id)) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        // Create content record
        const content = await Content.create({
            courseId,
            branchIds: course.branchIds,
            institutionId: course.institutionId,
            title: title || 'YouTube Video',
            description,
            type: 'video', // We still treat it as a video type for most parts
            file: {
                url: url,
                format: 'youtube',
                size: 0
            },
            metadata: {
                difficulty: difficulty || 'intermediate',
                category,
                tags: tags ? (Array.isArray(tags) ? tags : JSON.parse(tags)) : []
            },
            uploadedBy: req.dbUser._id,
            processingStatus: 'pending',
            isPublished: true,
            publishedAt: new Date()
        });

        // Link content to course
        await Course.findByIdAndUpdate(courseId, {
            $push: { contentIds: content._id },
            $inc: { 'stats.totalContent': 1 }
        });

        // Notify students via WebSocket
        try {
            emitToCourse(courseId, 'content:uploaded', {
                contentId: content._id,
                title: content.title,
                type: 'video',
                courseId: courseId,
                timestamp: new Date()
            });
        } catch (wsError) {
            console.error('WebSocket notification error:', wsError);
        }

        // Start background processing via ML service
        processContent(content._id, 'youtube', url).catch(err => {
            console.error('YouTube processing error:', err);
        });

        res.status(201).json({
            success: true,
            message: 'YouTube video added. Processing metadata and transcript in background...',
            data: { content }
        });
    } catch (error) {
        console.error('Add YouTube video error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add YouTube video',
            error: error.message
        });
    }
});

// Add Web Link Content
router.post('/web', authenticate, attachUser, requireFaculty, async (req, res) => {
    try {
        const { courseId, title, url, description, difficulty, category, tags } = req.body;

        if (!url) {
            return res.status(400).json({ success: false, message: 'URL is required' });
        }

        // Basic URL validation
        const urlRegex = /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/;
        if (!urlRegex.test(url)) {
            return res.status(400).json({ success: false, message: 'Invalid URL' });
        }

        // Verify course exists
        const course = await Course.findById(courseId);
        if (!course) {
            return res.status(404).json({ success: false, message: 'Course not found' });
        }

        if (!course.facultyIds.includes(req.dbUser._id)) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        // Create content record
        const content = await Content.create({
            courseId,
            branchIds: course.branchIds,
            institutionId: course.institutionId,
            title: title || 'Web Resource',
            description,
            type: 'web',
            file: {
                url: url,
                format: 'web',
                size: 0
            },
            metadata: {
                difficulty: difficulty || 'intermediate',
                category: category || 'Reference Material',
                tags: tags ? (Array.isArray(tags) ? tags : JSON.parse(tags)) : []
            },
            uploadedBy: req.dbUser._id,
            processingStatus: 'pending',
            isPublished: true,
            publishedAt: new Date()
        });

        // Link content to course
        await Course.findByIdAndUpdate(courseId, {
            $push: { contentIds: content._id },
            $inc: { 'stats.totalContent': 1 }
        });

        // Notify students via WebSocket
        try {
            emitToCourse(courseId, 'content:uploaded', {
                contentId: content._id,
                title: content.title,
                type: 'web',
                courseId: courseId,
                timestamp: new Date()
            });
        } catch (wsError) {
            console.error('WebSocket notification error:', wsError);
        }

        // Start background processing via ML service
        processContent(content._id, 'web', url).catch(err => {
            console.error('Web processing error:', err);
        });

        res.status(201).json({
            success: true,
            message: 'Web resource added. Scraping and simplifying content in background...',
            data: { content }
        });
    } catch (error) {
        console.error('Add web resource error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add web resource',
            error: error.message
        });
    }
});

/**
 * Redesigned Pipeline: Generate Professional Styled PDF from Scraped Web Content
 * Workflow: Scrape -> Clean -> AI Format -> Generate Styled PDF -> Upload
 */
router.post('/generate-pdf', authenticate, attachUser, async (req, res) => {
    try {
        const { url, title: userTitle } = req.body;

        if (!url) {
            return res.status(400).json({ success: false, message: 'URL is required' });
        }

        console.log(`🚀 Starting PDF Generation Pipeline for: ${url}`);

        // 1. Fetch raw HTML content
        let rawHtml;
        try {
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                },
                timeout: 15000
            });
            rawHtml = response.data;
        } catch (fetchError) {
            console.error('Failed to fetch URL:', fetchError.message);
            return res.status(400).json({ success: false, message: 'Failed to fetch website content. Ensure the URL is accessible.' });
        }

        // 2. Step 1: Clean Content
        console.log('🧹 Cleaning scraped content...');
        const cleanText = cleanScrapedContent(rawHtml);

        if (!cleanText || cleanText.length < 100) {
            return res.status(400).json({ success: false, message: 'Could not extract sufficient text from this website.' });
        }

        // 3. Step 2: AI Format
        console.log('🤖 Formatting content with AI (Groq)...');
        let formattedMarkdown;
        try {
            formattedMarkdown = await formatContentWithAI(cleanText);
        } catch (aiError) {
            console.error('AI Formatting failed:', aiError.message);
            return res.status(500).json({ success: false, message: 'AI failed to structure the content.' });
        }

        // 4. Step 3: Generate Styled PDF
        console.log('📄 Generating styled PDF with Puppeteer...');
        let pdfBuffer;
        try {
            pdfBuffer = await generateStyledPDF(formattedMarkdown);
        } catch (pdfError) {
            console.error('PDF Generation failed:', pdfError.message);
            return res.status(500).json({ success: false, message: 'Failed to generate PDF document.' });
        }

        // 5. Step 4: Upload to Cloudinary
        console.log('☁️ Uploading PDF to Cloudinary...');
        let uploadResult;
        try {
            const safeTitle = (userTitle || 'Notes').replace(/[^\w\s]/gi, '').substring(0, 30);
            uploadResult = await uploadBufferToCloudinary(pdfBuffer, 'eta-content/pdf', safeTitle);
        } catch (uploadError) {
            console.error('Cloudinary upload failed:', uploadError.message);
            return res.status(500).json({ success: false, message: 'Failed to save PDF to cloud storage.' });
        }

        // 6. Save to MongoDB
        console.log('💾 Saving record to database...');
        const autoTitle = formattedMarkdown.match(/^# (.*)$/m)?.[1] || userTitle || 'Untitled Notes';

        const generatedPdf = await GeneratedPDF.create({
            userId: req.dbUser._id,
            title: autoTitle,
            originalUrl: url,
            pdfUrl: uploadResult.url
        });

        console.log('✅ Pipeline Complete!');
        res.status(201).json({
            success: true,
            message: 'Professional PDF generated successfully!',
            data: {
                id: generatedPdf._id,
                title: generatedPdf.title,
                url: generatedPdf.pdfUrl,
                originalUrl: generatedPdf.originalUrl
            }
        });

    } catch (error) {
        console.error('PDF Pipeline Error:', error);
        res.status(500).json({
            success: false,
            message: 'An unexpected error occurred during PDF generation.',
            error: error.message
        });
    }
});




// Get content by ID
router.get('/:id', authenticate, attachUser, async (req, res) => {
    try {
        const content = await Content.findById(req.params.id)
            .populate('courseId', 'name code')
            .populate('branchIds', 'name')
            .populate('institutionId', 'name')
            .populate('uploadedBy', 'profile.name email');

        if (!content) {
            return res.status(404).json({
                success: false,
                message: 'Content not found'
            });
        }

        // Increment view count
        await content.incrementViews();

        // Record view in graph (if student)
        if (req.dbUser.role === 'student') {
            await recordView(req.dbUser._id, content._id).catch(err => {
                console.error('Record view error:', err);
            });
        }

        res.json({
            success: true,
            data: { content }
        });
    } catch (error) {
        console.error('Get content error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get content',
            error: error.message
        });
    }
});

// Get all content for a course
router.get('/course/:courseId', authenticate, attachUser, async (req, res) => {
    try {
        const { type, difficulty, published } = req.query;

        const filter = {
            courseId: req.params.courseId,
            isActive: true
        };

        if (type) filter.type = type;
        if (difficulty) filter['metadata.difficulty'] = difficulty;
        if (published !== undefined) filter.isPublished = published === 'true';

        const content = await Content.find(filter)
            .populate('uploadedBy', 'profile.name')
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            data: { content }
        });
    } catch (error) {
        console.error('Get course content error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get content',
            error: error.message
        });
    }
});

// Update content
router.put('/:id', authenticate, attachUser, requireFaculty, async (req, res) => {
    try {
        const { title, description, difficulty, category, tags, isPublished } = req.body;

        const content = await Content.findById(req.params.id);
        if (!content) {
            return res.status(404).json({
                success: false,
                message: 'Content not found'
            });
        }

        // Verify authorization
        if (content.uploadedBy.toString() !== req.dbUser._id.toString()) {
            return res.status(403).json({
                success: false,
                message: 'You are not authorized to update this content'
            });
        }

        // Update fields
        if (title) content.title = title;
        if (description !== undefined) content.description = description;
        if (difficulty) content.metadata.difficulty = difficulty;
        if (category) content.metadata.category = category;
        if (tags) content.metadata.tags = tags;
        if (isPublished !== undefined) {
            content.isPublished = isPublished;
            if (isPublished && !content.publishedAt) {
                content.publishedAt = new Date();
            }
        }

        await content.save();

        res.json({
            success: true,
            message: 'Content updated successfully',
            data: { content }
        });
    } catch (error) {
        console.error('Update content error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update content',
            error: error.message
        });
    }
});

// Delete content
router.delete('/:id', authenticate, attachUser, requireFaculty, async (req, res) => {
    try {
        const content = await Content.findById(req.params.id);
        if (!content) {
            return res.status(404).json({
                success: false,
                message: 'Content not found'
            });
        }

        // Verify authorization (Either uploader or faculty of the course)
        const targetCourse = await Course.findById(content.courseId);
        const isUploader = content.uploadedBy.toString() === req.dbUser._id.toString();
        const isCourseFaculty = targetCourse && targetCourse.facultyIds.map(id => id.toString()).includes(req.dbUser._id.toString());

        if (!isUploader && !isCourseFaculty) {
            return res.status(403).json({
                success: false,
                message: 'You are not authorized to delete this content'
            });
        }

        // Delete files from Cloudinary
        if (content.file && content.file.publicId) {
            await deleteFromCloudinary(content.file.publicId).catch(err => {
                console.error('Cloudinary file delete error:', err);
            });
        }

        // Delete thumbnail from Cloudinary
        if (content.file && content.file.thumbnail && content.file.thumbnail.publicId) {
            await deleteFromCloudinary(content.file.thumbnail.publicId).catch(err => {
                console.error('Cloudinary thumbnail delete error:', err);
            });
        }

        // Delete Word document from Cloudinary if it exists (for web content)
        if (content.extractedData?.metadata?.docxPublicId) {
            await deleteFromCloudinary(content.extractedData.metadata.docxPublicId).catch(err => {
                console.error('Cloudinary docx delete error:', err);
            });
        }

        // Delete from Neo4j
        await deleteContentNode(content._id).catch(err => {
            console.error('Neo4j delete error:', err);
        });

        // Remove reference from Course and update stats
        const course = await Course.findByIdAndUpdate(content.courseId, {
            $pull: { contentIds: content._id },
            $inc: { 'stats.totalContent': -1 }
        });

        // Update branch stats
        if (course && course.branchIds && course.branchIds.length > 0) {
            await Branch.updateMany(
                { _id: { $in: course.branchIds } },
                { $inc: { 'stats.totalContent': -1 } }
            );
        }

        // Delete associated Doubts
        await Doubt.deleteMany({ contentId: content._id });

        // 5. Hard delete content from MongoDB
        console.log(`🗑️ Hard deleting content from MongoDB: ${content._id}`);
        const deletedContent = await Content.findByIdAndDelete(content._id);

        if (!deletedContent) {
            console.warn(`⚠️ Content ${content._id} was already deleted or not found during final step`);
        } else {
            console.log(`✅ Successfully deleted content: ${content.title}`);
        }

        // 6. Ensure ID is removed from course contentIds (even if pull failed before)
        await Course.updateOne(
            { _id: content.courseId },
            { $pull: { contentIds: content._id } }
        );

        res.json({
            success: true,
            message: 'Content and all related resources deleted successfully'
        });
    } catch (error) {
        console.error('Delete content error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete content',
            error: error.message
        });
    }
});

// Get learning path for a course
router.get('/course/:courseId/learning-path', authenticate, attachUser, async (req, res) => {
    try {
        const path = await getLearningPath(req.params.courseId);

        res.json({
            success: true,
            data: { path }
        });
    } catch (error) {
        console.error('Get learning path error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get learning path',
            error: error.message
        });
    }
});

// Get recommendations for student
router.get('/recommendations/me', authenticate, attachUser, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 5;
        const recommendations = await getRecommendations(req.dbUser._id, limit);

        res.json({
            success: true,
            data: { recommendations }
        });
    } catch (error) {
        console.error('Get recommendations error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get recommendations',
            error: error.message
        });
    }
});

// Get content graph visualization
router.get('/course/:courseId/graph', authenticate, attachUser, async (req, res) => {
    try {
        const { courseId } = req.params;

        // Self-Healing: Ensure the Course node exists in Neo4j before fetching
        // This handles cases where courses were created before Neo4j integration
        const course = await Course.findById(courseId);
        if (course) {
            await runNeo4jQuery(
                `MERGE (c:Course {id: $id})
                 ON CREATE SET c.name = $name, c.code = $code, c.createdAt = datetime()
                 ON MATCH SET c.name = $name, c.code = $code`,
                {
                    id: courseId,
                    name: course.name,
                    code: course.code || ''
                }
            );
        }

        const graph = await getContentGraph(courseId);

        res.json({
            success: true,
            data: { graph }
        });
    } catch (error) {
        console.error('Get content graph error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get content graph',
            error: error.message
        });
    }
});

// Reprocess content (Automatic restart if opened again)
router.post('/:id/reprocess', authenticate, attachUser, async (req, res) => {
    try {
        const content = await Content.findById(req.params.id);
        if (!content) {
            return res.status(404).json({
                success: false,
                message: 'Content not found'
            });
        }

        // Authorization: Faculty of the course OR student who has access to the content
        const isFaculty = req.dbUser.role === 'faculty' && content.uploadedBy.toString() === req.dbUser._id.toString();
        const isStudentWithAccess = req.dbUser.role === 'student' && content.branchIds.some(bid => req.dbUser.branchIds.includes(bid));

        if (!isFaculty && !isStudentWithAccess) {
            return res.status(403).json({
                success: false,
                message: 'You are not authorized to reprocess this content'
            });
        }

        // Only allow restart if it's completed, failed, or stalled
        // If it's already processing, don't start another one
        if (content.processingStatus === 'processing') {
            return res.json({
                success: true,
                message: 'Content is already being processed'
            });
        }

        // Start reprocessing
        content.processingStatus = 'pending';
        content.processingError = null;
        content.processingProgress = 0;
        await content.save();

        console.log(`♻️ Restarting processing for content: ${content.title} (${content._id})`);

        processContent(content._id, content.type, content.file.url).catch(err => {
            console.error('Reprocessing error:', err);
        });

        res.json({
            success: true,
            message: 'Content reprocessing started'
        });
    } catch (error) {
        console.error('Reprocess content error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to reprocess content',
            error: error.message
        });
    }
});

// Cancel processing content
router.patch('/:id/cancel-processing', authenticate, attachUser, async (req, res) => {
    try {
        const content = await Content.findById(req.params.id);
        if (!content) {
            return res.status(404).json({ success: false, message: 'Content not found' });
        }

        // Only allow cancel if it's currently processing or pending
        if (content.processingStatus === 'processing' || content.processingStatus === 'pending') {
            content.processingStatus = 'failed';
            content.processingError = 'Processing stopped by user';
            content.processingProgress = 0;
            await content.save();

            // Also abort the ML service call if it's active
            const { cancelMLRequest } = await import('../services/extraction/ml.service.js');
            cancelMLRequest(req.params.id);

            console.log(`🛑 User requested cancellation for content: ${req.params.id}`);

            return res.json({
                success: true,
                message: 'Processing has been stopped and marked as failed.'
            });
        }

        res.json({
            success: true,
            message: 'Content was not in a processable state, or already finished.'
        });
    } catch (error) {
        console.error('Cancel processing error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to cancel processing',
            error: error.message
        });
    }
});

// Proxy external content (to bypass CORS for PDF viewer)
router.get('/view/proxy', authenticate, async (req, res) => {
    let { url } = req.query;
    try {
        if (!url) {
            return res.status(400).json({ success: false, message: 'URL is required' });
        }

        // Validate URL (ensure it's from Cloudinary)
        if (!url.includes('cloudinary.com')) {
            return res.status(403).json({ success: false, message: 'Forbidden: Only Cloudinary URLs can be proxied' });
        }

        // Handle potential multiple encoding (common with URLs in query params)
        while (url && url.includes('%25')) {
            url = decodeURIComponent(url);
        }

        // Ensure the URL is properly formatted
        url = encodeURI(decodeURI(url));

        let targetUrl = url;

        // If it's a Cloudinary URL, we can sign it to ensure access
        if (url.includes('cloudinary.com')) {
            try {
                // Extract public_id and resource_type
                // Format: .../upload/v12345/folder/id.ext
                const parts = url.split('/upload/');
                if (parts.length > 1) {
                    const pathAfterUpload = parts[1];
                    const pathParts = pathAfterUpload.split('/');

                    // Remove version if present
                    const publicIdWithExt = pathParts[0].startsWith('v')
                        ? pathParts.slice(1).join('/')
                        : pathParts.join('/');

                    // Determine resource type from URL
                    let resourceType = 'raw';
                    if (url.includes('/video/')) resourceType = 'video';
                    else if (url.includes('/image/')) resourceType = 'image';

                    // Get public_id without extension for images/videos
                    let publicId = publicIdWithExt;
                    if (resourceType !== 'raw') {
                        publicId = publicIdWithExt.split('.').slice(0, -1).join('.');
                    }

                    targetUrl = cloudinary.utils.url(publicId, {
                        resource_type: resourceType,
                        secure: true,
                        sign_url: true
                    });

                    console.log('🔄 Proxying via signed URL:', targetUrl);
                }
            } catch (signError) {
                console.warn('⚠️ Could not sign Cloudinary URL, using original:', signError.message);
            }
        }

        const response = await axios.get(targetUrl, {
            responseType: 'stream',
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'application/pdf,*/*'
            }
        });

        // Set appropriate headers
        res.setHeader('Content-Type', response.headers['content-type'] || 'application/pdf');
        if (response.headers['content-length']) {
            res.setHeader('Content-Length', response.headers['content-length']);
        }

        // Pipe the stream
        response.data.pipe(res);
    } catch (error) {
        console.error('❌ Proxy error for:', url);
        console.error('Reason:', error.message);
        if (error.response) {
            console.error('Target status code:', error.response.status);
            res.status(error.response.status).json({ success: false, error: error.message });
        } else {
            res.status(500).json({ success: false, error: 'Failed to proxy content: ' + error.message });
        }
    }
});

export default router;

