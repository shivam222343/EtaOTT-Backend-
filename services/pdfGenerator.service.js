import MarkdownIt from 'markdown-it';
import puppeteer from 'puppeteer';

const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true
});

/**
 * Generates a professionally styled PDF from Markdown content using Puppeteer.
 * @param {string} markdownContent - The academic notes in Markdown format.
 * @returns {Promise<Buffer>} The PDF buffer.
 */
export const generateStyledPDF = async (markdownContent) => {
    if (!markdownContent) throw new Error('No content provided for PDF generation');

    // 1. Extract Title
    const titleMatch = markdownContent.match(/^# (.*)$/m);
    const title = titleMatch ? titleMatch[1] : 'Academic Research Notes';

    // 2. Prepare TOC and Anchors
    const headings = [];
    const tokens = md.parse(markdownContent, {});

    tokens.forEach((token, i) => {
        if (token.type === 'heading_open') {
            const level = token.tag.substring(1);
            const content = tokens[i + 1].content;
            const id = content.toLowerCase().replace(/[^\w]+/g, '-');
            headings.push({ level, content, id });
        }
    });

    let tocHtml = '';
    if (headings.length > 2) {
        tocHtml = `
        <div class="toc">
            <h2>Table of Contents</h2>
            <ul>
                ${headings.filter(h => h.level <= 3).map(h => `
                    <li class="level-${h.level}">
                        <a href="#${h.id}">${h.content}</a>
                    </li>
                `).join('')}
            </ul>
        </div>`;
    }

    // 3. Convert Markdown to HTML and inject IDs
    let htmlContent = md.render(markdownContent);
    headings.forEach(h => {
        const hTag = `<h${h.level}>${h.content}</h${h.level}>`;
        const hTagWithId = `<h${h.level} id="${h.id}">${h.content}</h${h.level}>`;
        htmlContent = htmlContent.replace(hTag, hTagWithId);
    });

    const fullHtml = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Roboto:wght@300;400;500&display=swap" rel="stylesheet">
        <style>
            :root {
                --primary: #1e3a8a;
                --secondary: #7c3aed;
                --accent: #0d9488;
                --text-main: #334155;
                --bg-light: #f8fafc;
                --code-bg: #f1f5f9;
            }
            body { 
                font-family: 'Roboto', sans-serif; 
                line-height: 1.7; 
                color: var(--text-main);
                margin: 0;
                padding: 0;
            }
            .page-container { 
                padding: 1in; 
                background: white;
            }
            .cover-page {
                height: 100vh;
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                text-align: center;
                background: linear-gradient(135deg, #eff6ff 0%, #faf5ff 100%);
                page-break-after: always;
                position: relative;
                overflow: hidden;
            }
            .cover-page::before {
                content: '';
                position: absolute;
                top: -10%;
                right: -10%;
                width: 400px;
                height: 400px;
                background: radial-gradient(circle, rgba(124, 58, 237, 0.05) 0%, transparent 70%);
                border-radius: 50%;
            }
            .cover-page h1 { 
                font-family: 'Poppins', sans-serif; 
                font-size: 42px; 
                color: var(--primary); 
                margin: 0 40px 10px 40px;
                font-weight: 700;
                line-height: 1.2;
            }
            .cover-page h2 { 
                font-family: 'Poppins', sans-serif;
                font-weight: 300; 
                color: #64748b; 
                letter-spacing: 4px; 
                text-transform: uppercase;
                font-size: 18px;
            }
            .cover-page .date { 
                margin-top: 60px; 
                color: #94a3b8; 
                font-size: 14px; 
                font-weight: 500;
            }
            
            h1 { font-family: 'Poppins', sans-serif; font-size: 28px; color: var(--primary); border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; margin-top: 50px; }
            h2 { font-family: 'Poppins', sans-serif; font-size: 22px; color: var(--secondary); margin-top: 40px; }
            h3 { font-family: 'Poppins', sans-serif; font-size: 18px; color: var(--accent); margin-top: 30px; }
            
            p { margin-bottom: 16px; text-align: justify; }
            
            strong { 
                background-color: rgba(254, 240, 138, 0.6); 
                padding: 0 4px; 
                border-radius: 2px;
                font-weight: 600; 
            }
            
            ul, ol { margin-bottom: 20px; padding-left: 25px; }
            li { margin-bottom: 8px; }
            
            code { 
                font-family: 'Menlo', 'Monaco', 'Courier New', monospace; 
                background: var(--code-bg); 
                padding: 3px 6px; 
                border-radius: 5px; 
                font-size: 0.9em;
                color: #e11d48;
            }
            pre { 
                background: #1e293b; 
                color: #f8fafc;
                padding: 20px; 
                border-radius: 12px; 
                overflow-x: auto;
                margin-bottom: 24px;
                box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
            }
            pre code { 
                background: transparent; 
                padding: 0; 
                color: inherit;
            }
            
            .toc { 
                background: #f8fafc; 
                border: 1px solid #e2e8f0; 
                padding: 30px; 
                border-radius: 16px; 
                margin: 40px 0; 
                page-break-after: avoid; 
            }
            .toc h2 { margin-top: 0; color: var(--text-main); font-size: 20px; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px; }
            .toc ul { list-style: none; padding-left: 0; margin-bottom: 0; }
            .toc li { margin-bottom: 12px; }
            .toc .level-1 { font-weight: 700; color: var(--primary); margin-top: 15px; }
            .toc .level-2 { margin-left: 20px; font-size: 15px; font-weight: 500; }
            .toc .level-3 { margin-left: 40px; font-size: 14px; color: #64748b; }
            .toc a { text-decoration: none; color: inherit; display: block; }
            .toc a:hover { color: var(--secondary); }
            
            hr { border: 0; border-top: 1px solid #e2e8f0; margin: 40px 0; }

            .takeaways {
                background: #f0fdf4;
                border-left: 4px solid #22c55e;
                padding: 20px;
                border-radius: 0 12px 12px 0;
                margin: 40px 0;
            }

            @page {
                size: A4;
                margin: 0;
            }
        </style>
    </head>
    <body>
        <div class="cover-page">
            <h2 style="margin-bottom: 30px;">Eta Platform</h2>
            <h1>${title}</h1>
            <h2>Structured Research Notes</h2>
            <div class="date">${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
        </div>
        <div class="page-container">
            ${tocHtml ? tocHtml : ''}
            <div class="main-content">
                ${htmlContent}
            </div>
        </div>
    </body>
    </html>
    `;

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setContent(fullHtml, { waitUntil: 'networkidle0' });

        const buffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            displayHeaderFooter: true,
            headerTemplate: `
                <div style="font-size: 9px; width: 100%; text-align: right; color: #94a3b8; padding: 20px 50px 0 0;">
                    ${title} • Eta Platform
                </div>`,
            footerTemplate: `
                <div style="font-size: 9px; width: 100%; display: flex; justify-content: space-between; color: #94a3b8; padding: 0 50px 20px 50px;">
                    <span>Generated on ${new Date().toLocaleDateString()}</span>
                    <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
                </div>`,
            margin: { top: '80px', bottom: '80px', left: '0px', right: '0px' }
        });

        return buffer;
    } finally {
        if (browser) await browser.close();
    }
};

export default {
    generateStyledPDF
};
