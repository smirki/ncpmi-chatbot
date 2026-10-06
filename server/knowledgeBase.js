let knowledgeChunks = [];

/**
 * Parse the ncpmicontent.txt file into URL-based chunks
 */
function loadKnowledgeBase() {
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(__dirname, '..', 'ncpmicontent.txt');
    return parseKnowledgeBase(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * Parse knowledge base text (URL line, then that page's content) into chunks.
 * Used directly by the Cloudflare Worker, which bundles the file as a string.
 */
function parseKnowledgeBase(content) {
    knowledgeChunks = [];
    const lines = content.split('\n');

    let currentUrl = null;
    let currentContent = [];

    for (const line of lines) {
        // Check if line is a URL (starts with https://ncpmi.org)
        if (line.trim().startsWith('https://ncpmi.org')) {
            // Save previous chunk if exists
            if (currentUrl) {
                knowledgeChunks.push({
                    url: currentUrl,
                    content: currentContent.join('\n').trim()
                });
            }
            currentUrl = line.trim();
            currentContent = [];
        } else {
            currentContent.push(line);
        }
    }

    // Don't forget the last chunk
    if (currentUrl) {
        knowledgeChunks.push({
            url: currentUrl,
            content: currentContent.join('\n').trim()
        });
    }

    indexChunks();
    console.log(`Loaded ${knowledgeChunks.length} knowledge chunks`);
    return knowledgeChunks;
}

// Words too common to say anything about which page answers the question.
const STOPWORDS = new Set(`
    a about after all also am an and any are as at be been but by can could did do does
    for from get got had has have how i if in into is it its just me more most my no not
    now of on or our out please right should so some than that the their them then there
    these they this those to up us was we were what when where which who whom why will
    with would you your ncpmi pmi chapter find link info information know tell need want like see look
`.trim().split(/\s+/));

// BM25 parameters, plus how much a hit in the page title/URL counts versus the body.
const K1 = 1.2;
const B = 0.75;
const META_WEIGHT = 5;

let docFreq = new Map();
let avgLength = 1;

/** Light stemmer so "jobs"/"job" and "meetings"/"meeting" match. */
function stem(token) {
    if (token.length > 4 && token.endsWith('ies')) return token.slice(0, -3) + 'y';
    if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
    return token;
}

function termCounts(text) {
    const counts = new Map();
    for (const t of tokenize(text)) counts.set(t, (counts.get(t) || 0) + 1);
    return counts;
}

/**
 * Precompute per-chunk term counts for BM25. Title ("# Title" line written by
 * scripts/scrape.mjs) and URL path are a separate, boosted field, so a short page
 * that is *about* the topic (e.g. /about-us/current-board) beats a long page that
 * merely mentions it often.
 */
function indexChunks() {
    docFreq = new Map();
    let totalLength = 0;
    for (const chunk of knowledgeChunks) {
        const title = (chunk.content.match(/^# (.+)$/m) || [])[1] || '';
        const urlPath = chunk.url.replace(/^https?:\/\/[^/]+/, '').replace(/[-_/]/g, ' ');
        chunk.body = termCounts(chunk.content);
        chunk.meta = termCounts(`${title} ${urlPath}`);
        chunk.length = [...chunk.body.values()].reduce((a, b) => a + b, 0);
        totalLength += chunk.length;
        for (const term of new Set([...chunk.body.keys(), ...chunk.meta.keys()])) {
            docFreq.set(term, (docFreq.get(term) || 0) + 1);
        }
    }
    avgLength = totalLength / Math.max(knowledgeChunks.length, 1) || 1;
}

/**
 * Tokenize a string into searchable terms (lowercased, stemmed, no stopwords)
 */
function tokenize(text) {
    return text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(token => token.length > 1 && !STOPWORDS.has(token))
        .map(stem);
}

/**
 * BM25 relevance score for a chunk, with title/URL hits weighted META_WEIGHT times
 * @param {Object} chunk - indexed chunk from parseKnowledgeBase
 * @param {string} query - User's question
 * @returns {number} - Relevance score
 */
function calculateScore(chunk, query) {
    const n = knowledgeChunks.length;
    let score = 0;
    for (const term of new Set(tokenize(query))) {
        const tf = (chunk.body.get(term) || 0) + META_WEIGHT * (chunk.meta.get(term) || 0);
        if (!tf) continue;
        const df = docFreq.get(term) || 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        score += idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * chunk.length / avgLength));
    }
    return score;
}

/**
 * Search the knowledge base for relevant chunks (basic version)
 * @param {string} query - User's question
 * @param {number} topK - Number of top results to return
 * @returns {Array} - Array of { url, content, score }
 */
function searchKnowledge(query, topK = 5) {
    const scored = knowledgeChunks.map(chunk => ({
        url: chunk.url,
        content: chunk.content,
        score: calculateScore(chunk, query)
    }));

    // Sort by score descending and return top K
    return scored
        .filter(chunk => chunk.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
}

/**
 * Search with adjacent chunk context - includes chunks before/after matches
 * This provides better context when information spans multiple pages
 * @param {string} query - User's question
 * @param {number} topK - Number of top matching chunks
 * @returns {Array} - Array of { url, content, score } including adjacent chunks
 */
function searchKnowledgeWithContext(query, topK = 5, minScore = 2) {
    // Score all chunks with their indices
    const scored = knowledgeChunks.map((chunk, index) => ({
        url: chunk.url,
        content: chunk.content,
        index,
        score: calculateScore(chunk, query)
    }));

    // Get top K matches ABOVE the minimum score threshold
    // This prevents weak matches (like "okay" matching random words) from triggering LLM calls
    const topMatches = scored
        .filter(c => c.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);

    if (topMatches.length === 0) {
        return [];
    }

    // Expand to include adjacent chunks (before/after each match)
    const expandedIndices = new Set();
    for (const match of topMatches) {
        // Add chunk before (if exists)
        if (match.index > 0) {
            expandedIndices.add(match.index - 1);
        }
        // Add the matched chunk
        expandedIndices.add(match.index);
        // Add chunk after (if exists)
        if (match.index < knowledgeChunks.length - 1) {
            expandedIndices.add(match.index + 1);
        }
    }

    // Return chunks in order (preserving document flow)
    return Array.from(expandedIndices)
        .sort((a, b) => a - b)
        .map(idx => ({
            url: knowledgeChunks[idx].url,
            content: knowledgeChunks[idx].content,
            score: topMatches.find(m => m.index === idx)?.score || 0,
            isAdjacent: !topMatches.find(m => m.index === idx)
        }));
}

/**
 * Strip HTML tags and attributes from text
 * Converts HTML links to plain text with URLs preserved
 */
function stripHtml(text) {
    return text
        // Convert <a href="url">text</a> to just "text (url)"
        .replace(/<a\s+href="([^"]*)"[^>]*>([^<]*)<\/a>/gi, '$2')
        // Remove any remaining HTML tags
        .replace(/<[^>]+>/g, '')
        // Clean up HTML entities
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        // Clean up extra whitespace
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Build context string for LLM with source URLs
 * @param {Array} relevantChunks - Array of chunks
 * @param {number} maxCharsPerChunk - Max characters per chunk (default 4000)
 */
function buildContext(relevantChunks, maxCharsPerChunk = 4000) {
    return relevantChunks.map(chunk => {
        // Strip HTML from content before sending to LLM
        let cleanContent = stripHtml(chunk.content);

        const truncatedContent = cleanContent.length > maxCharsPerChunk
            ? cleanContent.substring(0, maxCharsPerChunk) + '...'
            : cleanContent;

        return `--- Source: ${chunk.url} ---\n${truncatedContent}`;
    }).join('\n\n');
}

module.exports = {
    loadKnowledgeBase,
    parseKnowledgeBase,
    searchKnowledge,
    searchKnowledgeWithContext,
    buildContext
};
