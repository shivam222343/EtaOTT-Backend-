import * as cheerio from 'cheerio';

/**
 * Cleans scraped HTML content by removing navigation, repeated elements, and raw URLs.
 * @param {string} rawHtml - The raw HTML content from the website.
 * @returns {string} Clean plain text.
 */
export const cleanScrapedContent = (rawHtml) => {
    if (!rawHtml) return '';

    const $ = cheerio.load(rawHtml);

    // Remove navigation, footers, headers, asides, scripts, and styles
    $('nav, footer, header, aside, script, style, .nav, .footer, .header, .menu, .sidebar, noscript, iframe, svg, .breadcrumb, .pagination, .ad, .advertisement, .social, .share').remove();

    // Remove hidden elements
    $('[style*="display: none"], [style*="visibility: hidden"]').remove();

    // Get text from body or the main content area if possible
    const bodyText = $('body').text() || $.text();

    // Advanced cleaning using regex
    let cleanText = bodyText
        // Remove repeated lines (headers/menus often repeat)
        .split('\n')
        .map(line => line.trim())
        .filter((line, index, self) => line.length > 0 && self.indexOf(line) === index)
        .join('\n')
        // Remove raw URLs unless they seem educational
        .replace(/https?:\/\/[^\s]+/g, (url) => {
            if (/docs|tutorial|learn|guide|course|edu|wiki/i.test(url)) return url;
            return '';
        })
        // Remove special characters like __, [], excessive spacing
        .replace(/_{2,}/g, '')
        .replace(/\[\d+\]/g, '')
        .replace(/\u00a0/g, ' ') // Non-breaking space
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n/g, '\n\n')
        .trim();

    return cleanText;
};

export default {
    cleanScrapedContent
};
