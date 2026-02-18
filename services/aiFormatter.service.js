import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Formats clean text into structured academic notes using Groq AI.
 * @param {string} cleanText - The cleaned plain text from the website.
 * @returns {Promise<string>} Structured Markdown content.
 */
export const formatContentWithAI = async (cleanText) => {
    if (!cleanText || cleanText.length < 50) {
        throw new Error('Content too short to format');
    }

    const systemPrompt = `You are a professional academic content editor.
The following text was scraped from a website and may contain messy formatting.
Rewrite it as structured academic notes.

Requirements:
1. Remove website navigation.
2. Organize into sections and subsections.
3. Use clear headings.
4. Use bullet points.
5. Highlight important terms using markdown bold.
6. Keep explanations concise.
7. Separate code blocks properly.
8. Add a "Key Takeaways" section at the end.
9. Return clean Markdown only.
10. Do NOT include website branding or advertising.`;

    const userPrompt = `TEXT TO FORMAT:\n\n${cleanText.substring(0, 15000)}`;

    const callGroq = async () => {
        const response = await axios.post(
            GROQ_API_URL,
            {
                model: GROQ_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.4
            },
            {
                headers: {
                    'Authorization': `Bearer ${GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 60000
            }
        );

        if (response.data && response.data.choices && response.data.choices[0]) {
            return response.data.choices[0].message.content;
        }
        throw new Error('Invalid response from Groq');
    };

    try {
        // Try once
        return await callGroq();
    } catch (error) {
        console.error('Groq call failed, retrying...', error.message);
        // Retry once
        try {
            return await callGroq();
        } catch (retryError) {
            console.error('Groq retry failed:', retryError.message);
            throw new Error('AI formatting failed after retry');
        }
    }
};

export default {
    formatContentWithAI
};
