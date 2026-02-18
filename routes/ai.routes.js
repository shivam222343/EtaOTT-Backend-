import express from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import ttsService from '../services/tts.service.js';

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

export default router;
