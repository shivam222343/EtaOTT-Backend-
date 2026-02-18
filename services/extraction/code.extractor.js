import fs from 'fs';
import path from 'path';
import axios from 'axios';

const LANGUAGE_MAP = {
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.py': 'python',
    '.java': 'java',
    '.cpp': 'cpp',
    '.c': 'c',
    '.cs': 'csharp',
    '.go': 'go',
    '.rs': 'rust',
    '.rb': 'ruby',
    '.php': 'php',
    '.html': 'html',
    '.css': 'css'
};

/**
 * Extract data from code files
 * @param {string} fileUrlOrPath - Path or URL to the code file
 * @param {string} originalName - Original filename to determine language
 */
export const extractCodeData = async (fileUrlOrPath, originalName) => {
    try {
        console.log(`💻 Starting code extraction for: ${fileUrlOrPath}`);
        let content;

        if (fileUrlOrPath.startsWith('http')) {
            console.log('🌐 Fetching code from URL...');
            const response = await axios.get(fileUrlOrPath, {
                responseType: 'text',
                timeout: 30000
            });
            content = response.data;
        } else {
            console.log('📁 Reading code from local path...');
            content = fs.readFileSync(fileUrlOrPath, 'utf8');
        }

        const ext = path.extname(originalName).toLowerCase();
        const language = LANGUAGE_MAP[ext] || 'plain text';

        // Basic metrics
        const lines = content.split('\n');
        const lineCount = lines.length;
        const charCount = content.length;

        console.log(`📊 Code stats: Language=${language}, Lines=${lineCount}`);

        // Simple topic/concept extraction based on comments and language keywords
        const topics = [];
        if (language === 'javascript' || language === 'typescript') {
            if (content.includes('React')) topics.push('React');
            if (content.includes('Express')) topics.push('Express');
            if (content.includes('mongoose')) topics.push('Mongoose/MongoDB');
            if (content.includes('async') || content.includes('await')) topics.push('Asynchronous Programming');
        } else if (language === 'python') {
            if (content.includes('pandas')) topics.push('Data Science');
            if (content.includes('django') || content.includes('flask')) topics.push('Web Development');
        }

        // Extract functions/classes (basic regex)
        const functions = [];
        const functionRegex = /(?:function\s+([a-zA-Z0-9_]+))|(?:const\s+([a-zA-Z0-9_]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>)|(?:class\s+([a-zA-Z0-9_]+))/g;
        let match;
        while ((match = functionRegex.exec(content)) !== null) {
            const name = match[1] || match[2] || match[3];
            if (name) functions.push(name);
        }

        // Generate summary
        const summary = `Source code file in ${language} with ${lineCount} lines. Contains ${functions.length} functions/classes.`;

        // Keywords
        const keywords = [language, ...topics.slice(0, 5)];

        console.log('✅ Code extraction completed');
        return {
            text: content.substring(0, 10000), // Limit text storage
            summary,
            topics: Array.from(new Set(topics)),
            keywords,
            metadata: {
                language,
                lineCount,
                charCount,
                functions: functions.slice(0, 20) // Limit count
            }
        };
    } catch (error) {
        console.error('❌ Code extraction error:', error);
        throw error;
    }
};

export default {
    extractCodeData
};

