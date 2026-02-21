import express from 'express';
import { authenticate, attachUser } from '../middleware/auth.middleware.js';
import { searchVideos, getRecommendedVideos } from '../services/youtube.service.js';
import Content from '../models/Content.model.js';
import Course from '../models/Course.model.js';
import { processContent } from '../services/content_processing.service.js';

const router = express.Router();

/**
 * @route   POST /api/v1/youtube/prepare
 * @desc    Prepare a YouTube video for viewing by creating content record and starting extraction
 * @access  Private (Student)
 */
router.post('/prepare', authenticate, attachUser, async (req, res) => {
    try {
        const { url, title, thumbnail, duration: durationRaw } = req.body;

        // Convert duration string (e.g., "6:21" or "1:05:30") to seconds number
        let duration = 0;
        if (typeof durationRaw === 'string' && durationRaw.includes(':')) {
            const parts = durationRaw.split(':').reverse();
            // seconds + minutes*60 + hours*3600
            duration = parts.reduce((acc, part, i) => acc + parseInt(part) * Math.pow(60, i), 0);
        } else {
            duration = parseInt(durationRaw) || 0;
        }

        if (!url) {
            return res.status(400).json({ success: false, message: 'URL is required' });
        }

        // 1. Check if content already exists for this URL
        let content = await Content.findOne({ 'file.url': url });

        if (content) {
            // If it exists but failed, retry processing
            if (content.processingStatus === 'failed') {
                processContent(content._id, 'youtube', url).catch(console.error);
            }
            return res.json({ success: true, data: { content } });
        }

        // 2. Need a course to associate with. Let's find or create a YT Discovery course for this institution
        const instId = req.dbUser.institutionIds?.[0] || req.dbUser.institutionId;

        if (!instId) {
            return res.status(400).json({
                success: false,
                message: 'No institution found for user to associate discovery content.'
            });
        }

        let discoveryCourse = await Course.findOne({
            institutionId: instId,
            code: 'YT_DISCOVERY'
        });

        if (!discoveryCourse) {
            // Create a default discovery course
            discoveryCourse = await Course.create({
                institutionId: instId,
                branchIds: req.dbUser.branchIds || [],
                facultyIds: [req.dbUser._id], // Temp: associate with first student who discovers it
                name: 'YouTube Knowledge Discovery',
                code: 'YT_DISCOVERY',
                description: 'A collection of AI-indexed YouTube videos discovered by students.',
                category: 'Discovery',
                semester: 'All',
                isActive: true
            });
        }

        // 3. Create new content
        content = await Content.create({
            courseId: discoveryCourse._id,
            branchIds: req.dbUser.branchIds || [],
            institutionId: instId,
            title: title || 'YouTube Video',
            type: 'video',
            file: {
                url: url,
                format: 'youtube',
                thumbnail: { url: thumbnail },
                duration: duration
            },
            metadata: {
                difficulty: 'intermediate',
                category: 'Research',
                tags: ['youtube', 'discovery']
            },
            uploadedBy: req.dbUser._id,
            processingStatus: 'pending',
            isPublished: true,
            publishedAt: new Date()
        });

        // Link to course
        await Course.findByIdAndUpdate(discoveryCourse._id, {
            $push: { contentIds: content._id },
            $inc: { 'stats.totalContent': 1 }
        });

        // 4. Start background processing
        processContent(content._id, 'youtube', url).catch(err => {
            console.error('YouTube processing error:', err);
        });

        res.status(201).json({
            success: true,
            data: { content }
        });

    } catch (error) {
        console.error('YouTube prepare error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to prepare video',
            error: error.message
        });
    }
});

/**
 * @route   GET /api/v1/youtube/search
 * @desc    Search for educational YouTube videos
 * @access  Private (Student)
 */
router.get('/search', authenticate, attachUser, async (req, res) => {
    try {
        const { q, page = 1 } = req.query;
        if (!q) {
            return res.status(400).json({
                success: false,
                message: 'Search query is required'
            });
        }

        const videos = await searchVideos(q, { userId: req.dbUser._id, page: parseInt(page) });

        res.json({
            success: true,
            data: { videos }
        });
    } catch (error) {
        console.error('YouTube search route error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to search videos',
            error: error.message
        });
    }
});

/**
 * @route   GET /api/v1/youtube/recommendations
 * @desc    Get personalized educational YouTube recommendations
 * @access  Private (Student)
 */
router.get('/recommendations', authenticate, attachUser, async (req, res) => {
    try {
        const { page = 1, refresh = false } = req.query;
        const videos = await getRecommendedVideos(req.dbUser._id, parseInt(page), refresh === 'true');

        res.json({
            success: true,
            data: { videos }
        });
    } catch (error) {
        console.error('YouTube recommendations route error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get recommendations',
            error: error.message
        });
    }
});

export default router;
