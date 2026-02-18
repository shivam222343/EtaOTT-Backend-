import axios from 'axios';

const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;

const qdrantClient = axios.create({
    baseURL: QDRANT_URL,
    headers: {
        'api-key': QDRANT_API_KEY,
        'Content-Type': 'application/json'
    }
});

// Collection names
export const COLLECTIONS = {
    CONTENT_EMBEDDINGS: 'content_embeddings',
    FACULTY_ANSWERS: 'faculty_answers',
    AI_ANSWERS: 'ai_answers'
};

export async function initQdrant() {
    try {
        // Test connection first
        await qdrantClient.get('/collections');

        // Check if collections exist, create if not
        for (const collectionName of Object.values(COLLECTIONS)) {
            await createCollectionIfNotExists(collectionName);
        }
        console.log('✅ Qdrant initialized successfully');
        return true;
    } catch (error) {
        console.warn('⚠️  Qdrant connection failed - running without vector search');
        console.warn('   AI-powered search features will be unavailable');
        return null;
    }
}

async function createCollectionIfNotExists(collectionName) {
    try {
        // Check if collection exists
        const response = await qdrantClient.get(`/collections/${collectionName}`);
        console.log(`✅ Qdrant collection '${collectionName}' already exists`);
    } catch (error) {
        if (error.response?.status === 404) {
            // Collection doesn't exist, create it
            try {
                await qdrantClient.put(`/collections/${collectionName}`, {
                    vectors: {
                        size: 384, // sentence-transformers/all-MiniLM-L6-v2 dimension
                        distance: 'Cosine'
                    },
                    optimizers_config: {
                        default_segment_number: 2
                    },
                    replication_factor: 1
                });
                console.log(`✅ Created Qdrant collection: ${collectionName}`);
            } catch (createError) {
                console.error(`❌ Failed to create collection ${collectionName}:`, createError.message);
                throw createError;
            }
        } else {
            throw error;
        }
    }
}

export function getQdrantClient() {
    return qdrantClient;
}

// Helper function to search vectors
export async function searchVectors(collectionName, vector, limit = 5) {
    try {
        const response = await qdrantClient.post(`/collections/${collectionName}/points/search`, {
            vector,
            limit,
            with_payload: true,
            with_vector: false
        });
        return response.data.result;
    } catch (error) {
        console.error('Qdrant search error:', error);
        throw error;
    }
}

// Helper function to upsert points
export async function upsertPoints(collectionName, points) {
    try {
        const response = await qdrantClient.put(`/collections/${collectionName}/points`, {
            points
        });
        return response.data;
    } catch (error) {
        console.error('Qdrant upsert error:', error);
        throw error;
    }
}

// Helper function to delete points
export async function deletePoints(collectionName, pointIds) {
    try {
        const response = await qdrantClient.post(`/collections/${collectionName}/points/delete`, {
            points: pointIds
        });
        return response.data;
    } catch (error) {
        console.error('Qdrant delete error:', error);
        throw error;
    }
}
