import { getRedisClient } from '../config/redis.config.js';

/**
 * Rate limiter for WhatsApp Guest users.
 * Allows 3 doubts per guestId (phone number/identifier).
 * Uses Redis for persistence.
 */
export const guestRateLimit = async (req, res, next) => {
    try {
        const guestId = req.body.guestId || req.ip; // Fallback to IP if no ID provided
        const redis = getRedisClient();

        if (!redis) {
            console.warn('Redis not available, skipping guest rate limit');
            return next();
        }

        const key = `whatsapp_guest_limit:${guestId}`;
        const count = await redis.get(key);

        if (count && parseInt(count) >= 3) {
            return res.status(429).json({
                success: false,
                answer: "🚀 **Guest Limit Reached!**\n\nYou've used your 3 free guest doubts. To continue learning, seeing interactive 3D models, and accessing your institution's full video library, please log in to the Eta platform.\n\nVisit: https://eta-ott.netlify.app/login",
                limitReached: true
            });
        }

        // Increment count and set expiry (e.g., 24 hours)
        await redis.incr(key);
        if (!count) {
            await redis.expire(key, 86400);
        }

        req.guestCount = (parseInt(count) || 0) + 1;
        next();
    } catch (error) {
        console.error('Guest Rate Limit Error:', error);
        next(); // Proceed anyway but log error
    }
};
