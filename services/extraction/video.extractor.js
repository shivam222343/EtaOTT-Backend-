import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Extract metadata from video file
 * @param {string} fileUrl - URL of the video file
 * @returns {Promise<Object>} Video metadata
 */
export const extractVideoMetadata = async (fileUrl) => {
    return new Promise(async (resolve, reject) => {
        try {
            // Create temporary file
            const tempDir = os.tmpdir();
            const tempFile = path.join(tempDir, `temp-video-${Date.now()}.mp4`);

            // Download video to temp file
            const response = await axios.get(fileUrl, {
                responseType: 'stream',
                timeout: 120000 // 2 minutes timeout
            });

            const writer = fs.createWriteStream(tempFile);
            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            // Extract metadata using ffmpeg
            ffmpeg.ffprobe(tempFile, (err, metadata) => {
                // Clean up temp file
                fs.unlink(tempFile, () => { });

                if (err) {
                    return reject(new Error(`Failed to extract video metadata: ${err.message}`));
                }

                const videoStream = metadata.streams.find(s => s.codec_type === 'video');
                const audioStream = metadata.streams.find(s => s.codec_type === 'audio');

                const extractedData = {
                    duration: metadata.format.duration,
                    size: metadata.format.size,
                    bitRate: metadata.format.bit_rate,
                    format: metadata.format.format_name,

                    video: videoStream ? {
                        codec: videoStream.codec_name,
                        width: videoStream.width,
                        height: videoStream.height,
                        frameRate: eval(videoStream.r_frame_rate), // e.g., "30/1" -> 30
                        aspectRatio: videoStream.display_aspect_ratio,
                        bitRate: videoStream.bit_rate
                    } : null,

                    audio: audioStream ? {
                        codec: audioStream.codec_name,
                        sampleRate: audioStream.sample_rate,
                        channels: audioStream.channels,
                        bitRate: audioStream.bit_rate
                    } : null,

                    metadata: metadata.format.tags || {}
                };

                resolve(extractedData);
            });
        } catch (error) {
            reject(new Error(`Video extraction error: ${error.message}`));
        }
    });
};

/**
 * Generate thumbnail from video
 * @param {string} fileUrl - URL of the video file
 * @param {number} timestamp - Timestamp in seconds for thumbnail
 * @returns {Promise<string>} Path to generated thumbnail
 */
export const generateThumbnail = async (fileUrl, timestamp = 1) => {
    return new Promise(async (resolve, reject) => {
        try {
            const tempDir = os.tmpdir();
            const tempVideo = path.join(tempDir, `temp-video-${Date.now()}.mp4`);
            const thumbnailPath = path.join(tempDir, `thumbnail-${Date.now()}.jpg`);

            // Download video
            const response = await axios.get(fileUrl, {
                responseType: 'stream',
                timeout: 120000
            });

            const writer = fs.createWriteStream(tempVideo);
            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            // Generate thumbnail
            ffmpeg(tempVideo)
                .screenshots({
                    timestamps: [timestamp],
                    filename: path.basename(thumbnailPath),
                    folder: path.dirname(thumbnailPath),
                    size: '640x360'
                })
                .on('end', () => {
                    // Clean up temp video
                    fs.unlink(tempVideo, () => { });
                    resolve(thumbnailPath);
                })
                .on('error', (err) => {
                    // Clean up
                    fs.unlink(tempVideo, () => { });
                    reject(new Error(`Thumbnail generation failed: ${err.message}`));
                });
        } catch (error) {
            reject(new Error(`Thumbnail generation error: ${error.message}`));
        }
    });
};

/**
 * Extract chapters/segments from video (basic implementation)
 * @param {number} duration - Video duration in seconds
 * @returns {Array} Suggested chapters
 */
export const suggestChapters = (duration) => {
    const chapters = [];
    const chapterLength = 300; // 5 minutes per chapter

    const numChapters = Math.ceil(duration / chapterLength);

    for (let i = 0; i < numChapters; i++) {
        chapters.push({
            number: i + 1,
            title: `Chapter ${i + 1}`,
            startTime: i * chapterLength,
            endTime: Math.min((i + 1) * chapterLength, duration),
            duration: Math.min(chapterLength, duration - (i * chapterLength))
        });
    }

    return chapters;
};

/**
 * Format duration in HH:MM:SS
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration
 */
export const formatDuration = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
};

/**
 * Get video quality label
 * @param {number} height - Video height in pixels
 * @returns {string} Quality label
 */
export const getQualityLabel = (height) => {
    if (height >= 2160) return '4K';
    if (height >= 1440) return '2K';
    if (height >= 1080) return '1080p';
    if (height >= 720) return '720p';
    if (height >= 480) return '480p';
    if (height >= 360) return '360p';
    return '240p';
};

export default {
    extractVideoMetadata,
    generateThumbnail,
    suggestChapters,
    formatDuration,
    getQualityLabel
};
