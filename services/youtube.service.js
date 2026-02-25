import axios from 'axios';
import User from '../models/User.model.js';
import Course from '../models/Course.model.js';
import Content from '../models/Content.model.js';
import { getCache, setCache } from '../config/redis.config.js';
import dotenv from 'dotenv';

dotenv.config();

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';


/**
 * Advanced YouTube search using Python ML service with semantic embeddings
 * @param {string} query - Search term with context
 * @param {Object} options - Search options
 * @returns {Promise<Array>} Ranked list of videos
 */
export const searchVideos = async (query, options = {}) => {
    const {
        userId = null,
        page = 1,
        selectedText = '',
        transcriptSegment = '',
        preferAnimated = false,
        preferCoding = false,
        language = 'english'
    } = options;

    try {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🎥 YouTube Semantic Search (Python ML Service)`);
        console.log(`   Query: "${query}"`);
        console.log(`   Context: Selected=${selectedText.length} chars, Transcript=${transcriptSegment.length} chars`);
        console.log(`   Preferences: Animated=${preferAnimated}, Coding=${preferCoding}`);
        console.log(`${'='.repeat(60)}\n`);

        // Check cache for this specific search including page
        const cacheKey = `yt_search:${Buffer.from(query + selectedText + transcriptSegment + page).toString('base64').substring(0, 32)}`;
        const cachedResults = await getCache(cacheKey);
        if (cachedResults) {
            console.log('⚡ Returning cached search results');
            return cachedResults;
        }

        // Call Python ML service for advanced semantic search
        const response = await axios.post(`${ML_SERVICE_URL}/search-videos`, {
            query: query.substring(0, 200),
            selected_text: selectedText.substring(0, 500),
            transcript_segment: transcriptSegment.substring(0, 500),
            prefer_animated: preferAnimated,
            prefer_coding: preferCoding,
            max_duration_minutes: 10,  // Strict 10-minute limit
            language: language
        }, {
            timeout: 30000  // 30 second timeout
        });

        if (!response.data.success || !response.data.videos || response.data.videos.length === 0) {
            console.warn('⚠️ ML service returned no videos, using fallback...');
            return fallbackSearch(query, userId);
        }

        const videos = response.data.videos.map(v => ({
            id: v.id,
            url: v.url,
            title: v.title,
            description: v.description,
            thumbnail: v.thumbnail,
            duration: v.duration,
            durationMinutes: v.duration_minutes,
            views: v.views,
            ago: calculateAgo(v.published_at),
            author: v.channel,
            // Scoring metadata
            semanticScore: v.semantic_score,
            finalScore: v.final_score,
            isAnimated: v.is_animated,
            isCoding: v.is_coding,
            scores: v.scores
        }));

        console.log(`✅ ML Service returned ${videos.length} videos`);

        // Cache search results for 1 hour
        await setCache(cacheKey, videos, 3600);

        if (videos.length > 0) {
            const best = videos[0];
            console.log(`   Top: "${best.title.substring(0, 60)}..."`);
            console.log(`   Duration: ${best.durationMinutes.toFixed(1)} min | Views: ${best.views.toLocaleString()}`);
            console.log(`   Semantic: ${(best.semanticScore * 100).toFixed(1)}% | Final: ${(best.finalScore * 100).toFixed(1)}%`);
            console.log(`   Animated: ${best.isAnimated} | Coding: ${best.isCoding}\n`);
        }

        // Save to search history
        if (userId && query) {
            await User.findByIdAndUpdate(userId, {
                $push: {
                    searchHistory: {
                        $each: [{
                            term: query,
                            timestamp: new Date()
                        }],
                        $slice: -20
                    }
                }
            }).catch(err => console.warn('Failed to save search history:', err.message));
        }

        return videos;

    } catch (error) {
        console.error('❌ ML Service error:', error.message);
        console.log('   Falling back to basic search...\n');
        return fallbackSearch(query, userId);
    }
};

/**
 * Fallback search using yt-search (when ML service is unavailable)
 */
const fallbackSearch = async (query, userId = null) => {
    try {
        const yts = (await import('yt-search')).default;
        const r = await yts(query);

        const videos = r.videos.slice(0, 15)
            .filter(v => {
                // Filter for videos under 10 minutes
                const duration = parseDurationToMinutes(v.timestamp);
                return duration <= 10 && duration >= 2;
            })
            .sort((a, b) => b.views - a.views)
            .map(v => ({
                id: v.videoId,
                url: v.url,
                title: v.title,
                description: v.description,
                thumbnail: v.thumbnail,
                duration: v.timestamp,
                durationMinutes: parseDurationToMinutes(v.timestamp),
                views: v.views,
                ago: v.ago,
                author: v.author.name,
                semanticScore: 0.5,
                finalScore: 0.5
            }));

        console.log(`✅ Fallback search returned ${videos.length} videos (filtered to ≤10 min)`);

        // Save to search history
        if (userId && query) {
            await User.findByIdAndUpdate(userId, {
                $push: {
                    searchHistory: {
                        $each: [{
                            term: query,
                            timestamp: new Date()
                        }],
                        $slice: -20
                    }
                }
            }).catch(err => console.warn('Failed to save search history:', err.message));
        }

        return videos;
    } catch (error) {
        console.error('Fallback search also failed:', error);
        return [];
    }
};

/**
 * Parse duration string to minutes
 */
const parseDurationToMinutes = (timestamp) => {
    if (!timestamp) return 10;

    const parts = timestamp.split(':').map(p => parseInt(p));

    if (parts.length === 3) {
        // HH:MM:SS
        return parts[0] * 60 + parts[1] + parts[2] / 60;
    } else if (parts.length === 2) {
        // MM:SS
        return parts[0] + parts[1] / 60;
    }

    return 10;
};

/**
 * Calculate "X ago" string from ISO date
 */
const calculateAgo = (publishedAt) => {
    if (!publishedAt) return 'Unknown';

    try {
        const pubDate = new Date(publishedAt);
        const now = new Date();
        const diffMs = now - pubDate;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays < 1) return 'Today';
        if (diffDays === 1) return '1 day ago';
        if (diffDays < 7) return `${diffDays} days ago`;
        if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
        if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
        return `${Math.floor(diffDays / 365)} years ago`;
    } catch {
        return 'Unknown';
    }
};

/**
 * Get recommended YouTube videos based on user context
 * @param {string} userId - User ID
 * @param {number} page - Page number
 * @param {boolean} refresh - Whether to bypass cache and fetch fresh
 * @returns {Promise<Array>} List of recommended videos
 */
export const getRecommendedVideos = async (userId, page = 1, refresh = false) => {
    try {
        // 0. Cache strategy: Store a larger pool, but return a shuffled subset for Page 1
        const poolCacheKey = `yt_pool:${userId}`;
        const pageCacheKey = `yt_recs:${userId}:${page}`;

        // If refreshing, clear pool
        if (refresh) await deleteCache(poolCacheKey);

        // For Page 1, we want it to feel "flipped" every single time
        if (page === 1 && !refresh) {
            const cachedPool = await getCache(poolCacheKey);
            if (cachedPool && cachedPool.length > 0) {
                console.log(`⚡ Returning fresh shuffle from pool for user ${userId}`);
                return cachedPool.sort(() => 0.5 - Math.random()).slice(0, 30);
            }
        }

        const user = await User.findById(userId);
        if (!user) throw new Error('User not found');

        // 1. Get themes from joined courses
        const joinedCourses = await Course.find({
            branchIds: { $in: user.branchIds || [] },
            isActive: true
        }).limit(5);
        const courseThemes = joinedCourses.map(c => c.name);

        // 2. Get themes from faculty added content
        const recentContent = await Content.find({
            branchIds: { $in: user.branchIds || [] },
            isActive: true
        })
            .sort({ createdAt: -1 })
            .limit(10);
        const contentThemes = recentContent.map(c => c.title);

        // 3. Get search history
        const searchHistory = user.searchHistory?.slice(-10).map(h => h.term) || [];

        // 4. Combine and deduplicate themes
        const allThemes = [...new Set([...courseThemes, ...contentThemes, ...searchHistory])];

        // Pick random themes to keep it dynamic
        const selectedThemes = allThemes
            .sort(() => 0.5 - Math.random())
            .slice(0, 5);

        // Add a "learning spice" to get different types of videos each time
        const learningSpices = [
            'visual explanation',
            'interactive tutorial',
            'deep dive',
            'quick summary',
            'crash course',
            'hands on',
            'conceptual animation',
            'advanced lecture'
        ];
        const spice = learningSpices[Math.floor(Math.random() * learningSpices.length)];

        let recommendationQuery;
        if (selectedThemes.length > 0) {
            recommendationQuery = `${selectedThemes.join(' ')} ${spice} educational academic`;
        } else {
            // Default educational query if no history/courses
            recommendationQuery = `trending ${spice} science technology lectures academic`;
        }

        console.log(`🔍 Generating fresh recommendations: "${recommendationQuery}" (Page: ${page})`);

        const videos = await searchVideos(recommendationQuery, { userId, page });
        const finalVideos = videos.sort(() => 0.5 - Math.random());

        // Cache the result
        if (finalVideos.length > 0) {
            // Store in pool for the "flipped" experience on return
            if (page === 1) {
                await setCache(poolCacheKey, finalVideos, 7200);
            }
            await setCache(pageCacheKey, finalVideos.slice(0, 30), 7200);
        }

        return finalVideos.slice(0, 30);
    } catch (error) {
        console.error('YouTube recommendation error:', error);
        throw error;
    }
};

export default {
    searchVideos,
    getRecommendedVideos
};
