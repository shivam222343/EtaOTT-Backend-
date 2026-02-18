import pdf from 'pdf-parse';
import axios from 'axios';
import fs from 'fs';

/**
 * Extract text and metadata from PDF file
 * @param {string} fileUrlOrPath - URL or local path of the PDF file
 * @returns {Promise<Object>} Extracted data
 */
export const extractPDFData = async (fileUrlOrPath) => {
    try {
        console.log(`📄 Starting PDF extraction for: ${fileUrlOrPath}`);
        let dataBuffer;

        if (fileUrlOrPath.startsWith('http')) {
            // Download PDF from URL
            console.log('🌐 Fetching PDF from URL...');
            const response = await axios.get(fileUrlOrPath, {
                responseType: 'arraybuffer',
                timeout: 30000 // 30 seconds timeout for download
            });
            dataBuffer = Buffer.from(response.data);
        } else {
            // Read PDF from local path
            console.log('📁 Reading PDF from local path...');
            dataBuffer = fs.readFileSync(fileUrlOrPath);
        }

        console.log(`📦 PDF buffer size: ${(dataBuffer.length / 1024).toFixed(2)} KB`);

        // Parse PDF
        console.log('🔍 Parsing PDF content...');
        const data = await pdf(dataBuffer);
        console.log('✅ PDF parsed successfully');

        // Extract basic information
        const extractedData = {
            text: data.text || '',
            pages: data.numpages || 0,
            metadata: {
                title: data.info?.Title || '',
                author: data.info?.Author || '',
                subject: data.info?.Subject || '',
                creator: data.info?.Creator || '',
                producer: data.info?.Producer || '',
                creationDate: data.info?.CreationDate ? new Date(data.info.CreationDate) : null,
                modificationDate: data.info?.ModDate ? new Date(data.info.ModDate) : null
            },
            info: data.info
        };

        // Extract structure (headings, sections)
        console.log('🏗️ Extracting structure...');
        extractedData.structure = extractStructure(data.text || '');

        // Extract keywords
        console.log('🔑 Extracting keywords...');
        extractedData.keywords = extractKeywords(data.text || '');

        // Extract topics
        console.log('📚 Extracting topics...');
        extractedData.topics = extractTopics(data.text || '');

        console.log('🎉 PDF extraction completed');
        return extractedData;
    } catch (error) {
        console.error('❌ PDF extraction error:', error);
        throw new Error(`Failed to extract PDF data: ${error.message}`);
    }
};

/**
 * Extract document structure from text
 * @param {string} text - Full text content
 * @returns {Array} Structured sections
 */
const extractStructure = (text) => {
    if (!text) return [];
    const structure = [];
    const lines = text.split('\n');

    let currentSection = null;
    let sectionNumber = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (!line) continue;

        // Detect headings (simple heuristic: short lines, all caps, or numbered)
        const isHeading = (
            line.length < 100 &&
            (
                /^[A-Z\s]{3,}$/.test(line) ||                    // All caps
                /^(Chapter|Section|Part)\s+\d+/i.test(line) ||   // Chapter/Section
                /^\d+\.?\s+[A-Z]/.test(line) ||                  // Numbered heading
                /^[IVX]+\.\s+[A-Z]/.test(line)                   // Roman numerals
            )
        );

        if (isHeading) {
            if (currentSection) {
                structure.push(currentSection);
            }

            sectionNumber++;
            currentSection = {
                number: sectionNumber,
                title: line,
                content: '',
                startLine: i
            };
        } else if (currentSection) {
            currentSection.content += line + ' ';
        }
    }

    if (currentSection) {
        structure.push(currentSection);
    }

    return structure;
};

/**
 * Extract keywords from text using frequency analysis
 * @param {string} text - Full text content
 * @returns {Array} Top keywords
 */
const extractKeywords = (text) => {
    if (!text) return [];
    // Common stop words to filter out
    const stopWords = new Set([
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
        'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
        'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
        'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those', 'it',
        'its', 'they', 'them', 'their', 'we', 'our', 'you', 'your', 'he', 'she',
        'his', 'her', 'him', 'i', 'me', 'my', 'which', 'what', 'when', 'where',
        'who', 'how', 'why', 'if', 'then', 'than', 'so', 'very', 'just', 'also'
    ]);

    // Tokenize and count words
    const words = text.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 3 && !stopWords.has(word));

    const wordFreq = {};
    words.forEach(word => {
        wordFreq[word] = (wordFreq[word] || 0) + 1;
    });

    // Sort by frequency and get top 20
    const keywords = Object.entries(wordFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([word, freq]) => ({
            word,
            frequency: freq
        }));

    return keywords;
};

/**
 * Extract main topics from text
 * @param {string} text - Full text content
 * @returns {Array} Identified topics
 */
const extractTopics = (text) => {
    if (!text) return [];
    const topics = [];

    // Common academic topics patterns
    const topicPatterns = [
        /(?:introduction to|overview of|fundamentals of|basics of)\s+([a-z\s]+)/gi,
        /(?:chapter|section|part)\s+\d+[:\s]+([a-z\s]+)/gi,
        /(?:understanding|learning|studying|exploring)\s+([a-z\s]+)/gi
    ];

    topicPatterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const topic = match[1].trim();
            if (topic.length > 3 && topic.length < 50) {
                topics.push(topic);
            }
        }
    });

    // Remove duplicates and return unique topics
    return [...new Set(topics)].slice(0, 10);
};

/**
 * Generate summary from PDF text (basic implementation)
 * @param {string} text - Full text content
 * @param {number} maxLength - Maximum summary length
 * @returns {string} Summary
 */
export const generateSummary = (text, maxLength = 500) => {
    if (!text) return '';

    // Split into sentences (more robust regex to avoid catastrophic backtracking)
    // We'll just take the first X characters and then split by punctuation
    const chunk = text.substring(0, maxLength * 2);
    const sentences = chunk.match(/[^.!?]+[.!?]+/g) || [];

    if (sentences.length === 0) {
        return text.substring(0, maxLength);
    }

    // Take first few sentences up to maxLength
    let summary = '';
    for (const sentence of sentences) {
        if ((summary + sentence).length > maxLength) {
            break;
        }
        summary += sentence;
    }

    return summary.trim() || text.substring(0, maxLength);
};

/**
 * Extract page-by-page content (requires additional library)
 * This is a placeholder for future enhancement
 */
export const extractPageByPage = async (fileUrl) => {
    // TODO: Implement page-by-page extraction
    // This would require pdf-lib or similar library
    return {
        message: 'Page-by-page extraction not yet implemented',
        pages: []
    };
};

export default {
    extractPDFData,
    generateSummary,
    extractPageByPage
};

