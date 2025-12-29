const fs = require('fs');
const path = require('path');

let knowledgeChunks = [];

/**
 * Parse the ncpmicontent.txt file into URL-based chunks
 */
function loadKnowledgeBase() {
    const filePath = path.join(__dirname, '..', 'ncpmicontent.txt');
    const content = fs.readFileSync(filePath, 'utf-8');
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

    console.log(`Loaded ${knowledgeChunks.length} knowledge chunks`);
    return knowledgeChunks;
}

/**
 * Tokenize a string into searchable terms
 */
function tokenize(text) {
    return text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(token => token.length > 2);
}

/**
 * Calculate relevance score for a chunk
 * @param {Object} chunk - { url, content }
 * @param {string} query - User's question
 * @returns {number} - Relevance score
 */
function calculateScore(chunk, query) {
    const queryTokens = tokenize(query);
    const contentLower = chunk.content.toLowerCase();
    let score = 0;

    // Check for exact phrase match (high value)
    if (contentLower.includes(query.toLowerCase())) {
        score += 20;
    }

    // Score based on keyword matches
    for (const token of queryTokens) {
        // Count occurrences of token in content
        const regex = new RegExp(token, 'gi');
        const matches = (chunk.content.match(regex) || []).length;
        score += matches;

        // Bonus for token in URL
        if (chunk.url.toLowerCase().includes(token)) {
            score += 5;
        }
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
function searchKnowledgeWithContext(query, topK = 5, minScore = 5) {
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
    searchKnowledge,
    searchKnowledgeWithContext,
    buildContext
};
