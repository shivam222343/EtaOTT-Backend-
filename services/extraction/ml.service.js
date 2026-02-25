import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

// Track active requests for cancellation
const activeControllers = new Map();

/**
 * Call ML service for data extraction
 * @param {string} fileUrl - URL of the file on Cloudinary
 * @param {string} contentId - MongoDB ID of the content
 * @param {string} contentType - 'pdf', 'video', etc.
 * @returns {Promise<Object>} Extracted data
 */
export const extractWithML = async (fileUrl, contentId, contentType) => {
    const controller = new AbortController();
    activeControllers.set(contentId.toString(), controller);

    try {
        console.log(`🤖 Calling ML service for ${contentType} extraction [ID: ${contentId}]...`);

        const response = await axios.post(`${ML_SERVICE_URL}/extract`, {
            file_url: fileUrl,
            content_id: contentId,
            content_type: contentType
        }, {
            timeout: 1200000, // 20 minutes
            signal: controller.signal
        });

        if (response.data && response.data.success) {
            console.log(`✅ ML extraction successful for ${contentId}`);
            return response.data.data;
        } else {
            console.error(`❌ ML service returned error:`, response.data?.message);
            throw new Error(response.data?.message || 'ML extraction failed');
        }
    } catch (error) {
        if (axios.isCancel(error)) {
            console.log(`⏹️ ML request for ${contentId} was aborted.`);
            throw new Error('Extraction cancelled');
        }

        console.error(`❌ ML service call failed:`, error.message);
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            throw new Error(`ML service is unreachable at ${ML_SERVICE_URL}. Please ensure the service is deployed and active.`);
        }
        throw error;
    } finally {
        activeControllers.delete(contentId.toString());
    }
};

/**
 * Stop an active ML extraction
 * @param {string} contentId 
 */
export const cancelMLRequest = (contentId) => {
    const controller = activeControllers.get(contentId.toString());
    if (controller) {
        controller.abort();
        console.log(`🛑 Aborted ML request for ${contentId}`);
        return true;
    }
    return false;
};

export default {
    extractWithML,
    cancelMLRequest
};
