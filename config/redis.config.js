import { createClient } from 'redis';

let redisClient = null;

export async function connectRedis() {
    if (redisClient?.isOpen) {
        console.log('✅ Redis already connected');
        return redisClient;
    }

    try {
        redisClient = createClient({
            url: process.env.REDIS_URL || 'redis://localhost:6379',
            socket: {
                reconnectStrategy: (retries) => {
                    if (retries > 3) {
                        console.warn('⚠️  Redis unavailable - continuing without cache');
                        return false; // Stop reconnecting
                    }
                    return Math.min(retries * 100, 1000);
                }
            }
        });

        redisClient.on('error', (err) => {
            // Suppress repetitive error logs
            if (!err.message.includes('ECONNREFUSED')) {
                console.error('❌ Redis Client Error:', err.message);
            }
        });

        redisClient.on('ready', () => {
            console.log('✅ Redis connected and ready');
        });

        await redisClient.connect();
        return redisClient;
    } catch (error) {
        console.warn('⚠️  Redis connection failed - running without cache');
        console.warn('   To enable caching, install and start Redis locally');
        redisClient = null;
        return null; // Return null instead of throwing
    }
}

export function getRedisClient() {
    if (!redisClient?.isOpen) {
        throw new Error('Redis client is not connected');
    }
    return redisClient;
}

// Cache helper functions
export async function setCache(key, value, ttl = 3600) {
    try {
        const client = getRedisClient();
        await client.setEx(key, ttl, JSON.stringify(value));
    } catch (error) {
        console.error('Redis setCache error:', error);
    }
}

export async function getCache(key) {
    try {
        const client = getRedisClient();
        const data = await client.get(key);
        return data ? JSON.parse(data) : null;
    } catch (error) {
        console.error('Redis getCache error:', error);
        return null;
    }
}

export async function deleteCache(key) {
    try {
        const client = getRedisClient();
        await client.del(key);
    } catch (error) {
        console.error('Redis deleteCache error:', error);
    }
}

export async function clearCachePattern(pattern) {
    try {
        const client = getRedisClient();
        const keys = await client.keys(pattern);
        if (keys.length > 0) {
            await client.del(keys);
        }
    } catch (error) {
        console.error('Redis clearCachePattern error:', error);
    }
}
