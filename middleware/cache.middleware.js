import { getCache, setCache } from '../config/redis.config.js';

export function cacheMiddleware(keyPrefix, ttl = 3600) {
    return async (req, res, next) => {
        // Skip caching for non-GET requests
        if (req.method !== 'GET') {
            return next();
        }

        try {
            // Generate cache key from URL and query params
            const cacheKey = `${keyPrefix}:${req.originalUrl}`;

            // Try to get from cache
            const cachedData = await getCache(cacheKey);

            if (cachedData) {
                console.log(`✅ Cache hit: ${cacheKey}`);
                return res.json(cachedData);
            }

            // Store original res.json
            const originalJson = res.json.bind(res);

            // Override res.json to cache the response
            res.json = (data) => {
                // Cache the response
                setCache(cacheKey, data, ttl).catch(err => {
                    console.error('Cache set error:', err);
                });

                // Send the response
                return originalJson(data);
            };

            next();
        } catch (error) {
            console.error('Cache middleware error:', error);
            next();
        }
    };
}
