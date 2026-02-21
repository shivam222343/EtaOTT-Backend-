import Content from '../models/Content.model.js';
import { extractWithML } from '../services/extraction/ml.service.js';
import { extractCodeData } from '../services/extraction/code.extractor.js';
import { emitToCourse } from './websocket.service.js';
import {
    createContentNode,
    linkContentToCourse,
    createTopicNodes,
    createConceptNodes,
    linkRelatedContent,
} from '../services/graph/content.graph.js';

/**
 * Background processing function for content
 * Handles ML extraction and graph database integration
 */
export async function processContent(contentId, contentType, fileUrl) {
    try {
        console.log(`🌀 Starting background processing for content: ${contentId} (${contentType})`);
        const content = await Content.findById(contentId);
        if (!content) {
            console.error(`❌ Content ${contentId} not found in database`);
            return;
        }

        // 1. Mark as processing
        content.processingStatus = 'processing';
        content.processingProgress = 10;
        await content.save();
        console.log(`📊 [${contentId}] Status: processing, Progress: 10%`);
        emitToCourse(content.courseId, 'content:processing', { contentId, progress: 10, status: 'processing' });

        let extractedData = {};

        // 2. Extract data based on content type
        try {
            console.log(`🔍 [${contentId}] Extracting ${contentType} data via ML service...`);
            if (contentType === 'pdf' || contentType === 'video' || contentType === 'youtube' || contentType === 'web') {
                // Ensure YouTube URLs use the correct pipeline regardless of the provided contentType
                let effectiveType = contentType;
                if (fileUrl.includes('youtube.com') || fileUrl.includes('youtu.be')) {
                    effectiveType = 'youtube';
                }

                const mlData = await extractWithML(fileUrl, contentId, effectiveType);

                // Check for cancellation after long-running ML extraction
                const checkContent = await Content.findById(contentId).select('processingStatus');
                if (!checkContent || checkContent.processingStatus === 'failed') {
                    console.log(`⏹️ [${contentId}] Processing aborted after ML extraction (User cancelled)`);
                    return;
                }

                if (contentType === 'pdf') {
                    // ... (rest of extraction logic) ...
                    extractedData = {
                        text: mlData.text,
                        summary: mlData.summary,
                        topics: mlData.topics,
                        keywords: mlData.keywords,
                        structure: mlData.structure,
                        metadata: mlData.metadata
                    };
                } else if (contentType === 'video' || contentType === 'youtube') {
                    extractedData = {
                        text: mlData.text,
                        summary: mlData.summary,
                        topics: mlData.topics || [],
                        keywords: mlData.keywords || [],
                        metadata: {
                            ...mlData.metadata,
                            duration: mlData.duration,
                            language: mlData.language
                        }
                    };

                    // Update content with video specific info
                    content.file.duration = mlData.duration;
                    if (mlData.metadata && mlData.metadata.thumbnail) {
                        content.file.thumbnail = {
                            url: mlData.metadata.thumbnail,
                            publicId: mlData.metadata.thumbnail_public_id || ''
                        };
                    } else if (mlData.thumbnail_url) {
                        content.file.thumbnail = {
                            url: mlData.thumbnail_url,
                            publicId: mlData.thumbnail_public_id || ''
                        };
                    }
                } else if (contentType === 'web') {
                    extractedData = {
                        text: mlData.text,
                        raw_text: mlData.raw_text,
                        summary: mlData.summary,
                        topics: mlData.topics || [],
                        keywords: mlData.keywords || [],
                        metadata: {
                            ...mlData.metadata,
                            title: mlData.title,
                            url: mlData.url
                        }
                    };

                    if (mlData.title && (!content.title || content.title === 'Web Resource')) {
                        content.title = mlData.title;
                    }

                    if (mlData.pdf_url) {
                        content.file.url = mlData.pdf_url;
                        content.file.publicId = mlData.pdf_public_id || '';
                        content.file.format = 'pdf';
                    }

                    if (mlData.docx_url) {
                        extractedData.metadata.docxUrl = mlData.docx_url;
                        extractedData.metadata.docxPublicId = mlData.docx_public_id || '';
                    }

                    if (mlData.thumbnail_url) {
                        content.file.thumbnail = {
                            url: mlData.thumbnail_url,
                            publicId: mlData.thumbnail_public_id || ''
                        };
                    }
                }

                if (contentType === 'pdf' && mlData.thumbnail_url) {
                    content.file.thumbnail = {
                        url: mlData.thumbnail_url,
                        publicId: mlData.thumbnail_public_id || ''
                    };
                }
            } else if (contentType === 'code' || contentType === 'document') {
                const codeData = await extractCodeData(fileUrl, content.title);
                extractedData = {
                    text: codeData.text,
                    summary: codeData.summary,
                    topics: codeData.topics,
                    keywords: codeData.keywords,
                    metadata: codeData.metadata
                };
            }
        } catch (extractionError) {
            console.error(`❌ [${contentId}] Extraction failed:`, extractionError);
            throw extractionError;
        }

        content.processingProgress = 40;
        await content.save();
        console.log(`📊 [${contentId}] Progress: 40% (Extraction complete)`);
        emitToCourse(content.courseId, 'content:processing', { contentId, progress: 40, status: 'processing' });

        // 3. Update content with extracted data
        content.extractedData = extractedData;
        content.processingProgress = 60;
        await content.save();
        console.log(`📊 [${contentId}] Progress: 60% (Data saved)`);
        emitToCourse(content.courseId, 'content:processing', { contentId, progress: 60, status: 'processing' });

        // 4. Create graph structure
        try {
            // Check for cancellation before graph creation
            const beforeGraphCheck = await Content.findById(contentId).select('processingStatus');
            if (!beforeGraphCheck || beforeGraphCheck.processingStatus === 'failed') {
                console.log(`⏹️ [${contentId}] Processing aborted before graph creation (User cancelled)`);
                return;
            }

            console.log(`🕸️ [${contentId}] Creating graph nodes...`);
            const graphNodeId = await createContentNode(content);
            content.graphNodeId = graphNodeId;
            content.processingProgress = 80;
            await content.save();
            console.log(`📊 [${contentId}] Progress: 80% (Graph created)`);
            emitToCourse(content.courseId, 'content:processing', { contentId, progress: 80, status: 'processing' });

            await linkContentToCourse(content._id, content.courseId);

            // Integrate content topics and related links into the knowledge graph
            if (extractedData.topics && extractedData.topics.length > 0) {
                await createTopicNodes(content._id, extractedData.topics);
            }
            await linkRelatedContent(content._id);
        } catch (graphError) {
            console.error(`❌ [${contentId}] Graph processing failed:`, graphError);
        }

        // 5. Complete processing
        content.processingStatus = 'completed';
        content.processingProgress = 100;
        content.isPublished = true;
        if (!content.publishedAt) content.publishedAt = new Date();

        await content.save();
        console.log(`✅ [${contentId}] Content processed successfully!`);
        emitToCourse(content.courseId, 'content:completed', { contentId, content });
    } catch (error) {
        console.error(`❌ Content processing failed for ${contentId}:`, error);
        try {
            const content = await Content.findById(contentId);
            if (content) {
                content.processingStatus = 'failed';
                content.processingError = error.message;
                content.processingProgress = 100;
                await content.save();
                emitToCourse(content.courseId, 'content:failed', { contentId, error: error.message });
            }
        } catch (saveError) {
            console.error('❌ Failed to save failure status:', saveError);
        }
    }
}
