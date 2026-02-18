import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const pollyClient = new PollyClient({
    region: process.env.AWS_REGION || "ap-south-1",
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ""
    }
});

/**
 * Synthesize speech using AWS Polly (Indian Accent)
 */
export const synthesizePolly = async (text, voiceId = "Aditi") => {
    try {
        if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
            console.warn("AWS Polly skipped: Credentials missing in .env");
            return null; // Return null to indicate failure without crashing
        }

        const command = new SynthesizeSpeechCommand({
            Engine: "neural",
            OutputFormat: "mp3",
            Text: text,
            VoiceId: voiceId
        });

        const response = await pollyClient.send(command);
        const chunks = [];
        for await (const chunk of response.AudioStream) {
            chunks.push(chunk);
        }
        return Buffer.concat(chunks);
    } catch (error) {
        console.error("Polly TTS error:", error.message);
        throw error;
    }
};

/**
 * Synthesize speech using ElevenLabs (Human-like Voice)
 * Improved with automatic fallback to Polly on failure
 */
export const synthesizeElevenLabs = async (text, voiceId = process.env.ELEVENLABS_VOICE_ID) => {
    try {
        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) throw new Error("ElevenLabs API Key missing");

        const response = await axios.post(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
            {
                text,
                model_id: "eleven_multilingual_v2", // Best for Hindi/English mix
                voice_settings: {
                    stability: 0.6, // Slightly increased for better Hindi fluency
                    similarity_boost: 0.75,
                    style: 0.0,
                    use_speaker_boost: true
                }
            },
            {
                headers: {
                    'xi-api-key': apiKey,
                    'Content-Type': 'application/json'
                },
                responseType: 'arraybuffer'
            }
        );

        return Buffer.from(response.data);
    } catch (error) {
        const errorDetail = error.response?.data ? error.response.data.toString() : error.message;
        console.warn("ElevenLabs TTS failed, falling back to AWS Polly:", errorDetail);

        // Fallback to Polly (Aditi is great for Hindi/English)
        return await synthesizePolly(text, "Aditi");
    }
};

export default {
    synthesizePolly,
    synthesizeElevenLabs
};
