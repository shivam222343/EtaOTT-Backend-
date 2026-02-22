import express from 'express';
import { authenticate, attachUser } from '../middleware/auth.middleware.js';
import ttsService from '../services/tts.service.js';
import aiService from '../services/ai.service.js';
import PlatformChat from '../models/PlatformChat.model.js';

const router = express.Router();

/**
 * Text-to-Speech endpoint
 * Supports AWS Polly (Indian Accent) and ElevenLabs (Human-like)
 */
router.post('/tts', authenticate, async (req, res) => {
    try {
        const { text, voiceId, engine = 'elevenlabs' } = req.body;

        if (!text) {
            return res.status(400).json({ success: false, message: 'Text is required' });
        }

        let audioBuffer;
        if (engine === 'elevenlabs') {
            audioBuffer = await ttsService.synthesizeElevenLabs(text, voiceId);
        } else {
            audioBuffer = await ttsService.synthesizePolly(text, voiceId || "Aditi");
        }

        res.set({
            'Content-Type': 'audio/mpeg',
            'Content-Length': audioBuffer.length
        });

        res.send(audioBuffer);
    } catch (error) {
        console.error('TTS Route error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * Global Platform AI Tutor - Ask a platform query
 */
router.post('/platform-ask', authenticate, attachUser, async (req, res) => {
    try {
        const { query, language = 'english' } = req.body;
        const userId = req.dbUser._id;

        if (!query) {
            return res.status(400).json({ success: false, message: 'Query is required' });
        }

        // 1. Get Conversation History (Last 10 messages)
        const history = await PlatformChat.find({ userId })
            .sort({ createdAt: -1 })
            .limit(10);

        // Reverse to get chronological order for AI
        const formattedHistory = history.reverse().map(h => ({
            role: h.role,
            content: h.content
        }));

        // 2. Resolve via AI Service
        const result = await aiService.resolvePlatformQuery(
            query,
            formattedHistory,
            req.dbUser.profile?.name || 'User',
            language
        );

        // 3. Save User Message
        await PlatformChat.create({
            userId,
            role: 'user',
            content: query,
            language
        });

        // 4. Save Assistant Response
        const assistantMsg = await PlatformChat.create({
            userId,
            role: 'assistant',
            content: result.answer,
            language: result.detectedLanguage
        });

        res.json({
            success: true,
            data: {
                answer: result.answer,
                messageId: assistantMsg._id,
                detectedLanguage: result.detectedLanguage
            }
        });
    } catch (error) {
        console.error('Platform AI Error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * Get Platform Chat History
 */
router.get('/platform-history', authenticate, attachUser, async (req, res) => {
    try {
        const userId = req.dbUser._id;
        const history = await PlatformChat.find({ userId })
            .sort({ createdAt: 1 }) // Chronological order
            .limit(50);

        res.json({
            success: true,
            data: { history }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * Clear Platform Chat History
 */
router.delete('/platform-history', authenticate, attachUser, async (req, res) => {
    try {
        const userId = req.dbUser._id;
        await PlatformChat.deleteMany({ userId });
        res.json({ success: true, message: 'Chat history cleared' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

export default router;
