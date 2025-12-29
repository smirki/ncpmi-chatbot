require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const path = require('path');
const { loadKnowledgeBase, searchKnowledgeWithContext, buildContext } = require('./knowledgeBase');
const { chat, chatStream } = require('./llmClient');

const app = express();
const PORT = process.env.PORT || 3002;

// CORS Configuration
// Set CORS_ORIGINS in .env as comma-separated list for production
// Example: CORS_ORIGINS=https://ncpmi.org,https://www.ncpmi.org,https://other-pmi-chapter.org
const corsOptions = {
    origin: process.env.CORS_ORIGINS
        ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
        : true, // Allow all origins in development
    credentials: true
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Serve static files (widget)
app.use('/widget', express.static(path.join(__dirname, '..', 'widget')));
app.use(express.static(path.join(__dirname, '..')));

// Store emails (in production, use a database)
const collectedEmails = [];

// Load knowledge base on startup
loadKnowledgeBase();

/**
 * POST /api/email
 * Collect user email before chat
 */
app.post('/api/email', (req, res) => {
    const { email, newsletter } = req.body;

    if (!email || !isValidEmail(email)) {
        return res.status(400).json({ error: 'Valid email required' });
    }

    // Store email
    collectedEmails.push({
        email,
        newsletter: newsletter || false,
        timestamp: new Date().toISOString()
    });

    console.log(`Email collected: ${email}, Newsletter: ${newsletter}`);

    res.json({ success: true, message: 'Email registered' });
});

/**
 * POST /api/chat
 * Main chat endpoint - requires email
 */
app.post('/api/chat', async (req, res) => {
    const { message, email } = req.body;

    // Verify email is provided
    if (!email) {
        return res.status(400).json({ error: 'Email required before chatting' });
    }

    if (!message || message.trim().length === 0) {
        return res.status(400).json({ error: 'Message required' });
    }

    try {
        // Search knowledge base for relevant chunks (5 chunks + adjacent context)
        const relevantChunks = searchKnowledgeWithContext(message, 5);

        // Build context with source URLs (empty if no chunks found - LLM will handle gracefully)
        const context = relevantChunks.length > 0
            ? buildContext(relevantChunks)
            : 'No specific information found in the available resources.';

        // Call LLM
        const answer = await chat(context, message);

        // Extract source URLs from relevant chunks (default to main site if none found)
        const sources = relevantChunks.length > 0
            ? relevantChunks.map(chunk => chunk.url)
            : ['https://ncpmi.org'];

        res.json({
            answer,
            sources
        });

    } catch (error) {
        console.error('Chat API Error:', error);
        res.status(500).json({
            error: 'Failed to get response. Please try again.',
            details: error.message
        });
    }
});

/**
 * POST /api/chat/stream
 * Streaming chat endpoint using Server-Sent Events
 */
app.post('/api/chat/stream', async (req, res) => {
    const { message, email } = req.body;

    if (!email) {
        return res.status(400).json({ error: 'Email required before chatting' });
    }

    if (!message || message.trim().length === 0) {
        return res.status(400).json({ error: 'Message required' });
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
        const relevantChunks = searchKnowledgeWithContext(message, 5);

        // Build context (empty message if no chunks - LLM will handle gracefully)
        const context = relevantChunks.length > 0
            ? buildContext(relevantChunks)
            : 'No specific information found in the available resources.';

        // Default to main site if no sources found
        const sources = relevantChunks.length > 0
            ? relevantChunks.map(chunk => chunk.url)
            : ['https://ncpmi.org'];

        await chatStream(
            context,
            message,
            // onChunk
            (chunk) => {
                res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
            },
            // onDone
            (fullText) => {
                res.write(`data: ${JSON.stringify({ type: 'done', sources })}\n\n`);
                res.end();
            },
            // onError
            (error) => {
                res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
                res.end();
            }
        );
    } catch (error) {
        console.error('Stream Chat API Error:', error);
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'Failed to get response' })}\n\n`);
        res.end();
    }
});

/**
 * POST /api/feedback
 * Collect feedback on responses
 */
app.post('/api/feedback', (req, res) => {
    const { email, messageIndex, helpful, comment } = req.body;

    console.log(`Feedback received: email=${email}, helpful=${helpful}, comment=${comment || 'none'}`);

    // In production, store this in a database
    res.json({ success: true });
});

/**
 * GET /api/health
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Validate email format
 */
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Start server
app.listen(PORT, () => {
    console.log(`NCPMI Chatbot server running on http://localhost:${PORT}`);
    console.log(`Widget available at http://localhost:${PORT}/index.html`);
});
