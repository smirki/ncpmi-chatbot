require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const path = require('path');
const { loadKnowledgeBase, searchKnowledgeWithContext, buildContext } = require('./knowledgeBase');
const { chat, chatStream } = require('./llmClient');
const db = require('./db');

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

// Block direct download of the database / data dir from the static root below.
app.use((req, res, next) => {
    if (req.path === '/data' || req.path.startsWith('/data/')) {
        return res.status(404).end();
    }
    next();
});

// Serve static files (widget)
app.use('/widget', express.static(path.join(__dirname, '..', 'widget')));
app.use(express.static(path.join(__dirname, '..')));

// HTTP Basic Auth for the admin dashboard (shared password from .env)
function adminAuth(req, res, next) {
    const expected = process.env.ADMIN_PASSWORD;
    if (!expected) {
        return res.status(500).send('Admin dashboard not configured: set ADMIN_PASSWORD in .env');
    }
    const header = req.headers.authorization || '';
    const [scheme, encoded] = header.split(' ');
    if (scheme === 'Basic' && encoded) {
        const decoded = Buffer.from(encoded, 'base64').toString();
        const password = decoded.slice(decoded.indexOf(':') + 1);
        if (password === expected) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="NCPMI Admin"');
    return res.status(401).send('Authentication required');
}

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

    // Persist email
    db.recordEmail(email, newsletter || false);

    console.log(`Email collected: ${email}, Newsletter: ${newsletter}`);

    res.json({ success: true, message: 'Email registered' });
});

/**
 * POST /api/chat
 * Main chat endpoint - requires email
 */
app.post('/api/chat', async (req, res) => {
    const { message, email, conversationId } = req.body;

    // Verify email is provided
    if (!email) {
        return res.status(400).json({ error: 'Email required before chatting' });
    }

    if (!message || message.trim().length === 0) {
        return res.status(400).json({ error: 'Message required' });
    }

    try {
        // Log the user's question
        db.recordMessage({ conversationId, email, role: 'user', content: message });

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

        // Log the assistant's answer
        db.recordMessage({ conversationId, email, role: 'assistant', content: answer, sources });

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
    const { message, email, conversationId } = req.body;

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
        // Log the user's question
        db.recordMessage({ conversationId, email, role: 'user', content: message });

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
                // Log the assistant's full answer
                db.recordMessage({ conversationId, email, role: 'assistant', content: fullText, sources });
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
    const { email, conversationId, question, answer, helpful, comment } = req.body;

    db.recordFeedback({ conversationId, email, question, answer, helpful, comment });

    console.log(`Feedback received: email=${email}, helpful=${helpful}, comment=${comment || 'none'}`);

    res.json({ success: true });
});

/**
 * POST /api/staff-connect
 * User asked to be connected with NCPMI staff. We record the request
 * (with their email + recent context) so admins can follow up.
 */
app.post('/api/staff-connect', (req, res) => {
    const { email, conversationId, lastQuestion } = req.body;

    if (!email || !isValidEmail(email)) {
        return res.status(400).json({ error: 'Valid email required' });
    }

    db.recordStaffRequest({ conversationId, email, lastQuestion });

    console.log(`Staff connection requested by ${email}`);

    res.json({
        success: true,
        message: "We've reached out to them with your email. They'll get back to you in 2-3 days."
    });
});

/* ============================== ADMIN API ============================== */

// Serve the admin dashboard page (password protected)
app.get('/admin', adminAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin', 'dashboard.html'));
});

app.get('/api/admin/stats', adminAuth, (req, res) => {
    res.json(db.getStats());
});

app.get('/api/admin/emails', adminAuth, (req, res) => {
    res.json(db.listEmails());
});

app.get('/api/admin/feedback', adminAuth, (req, res) => {
    res.json(db.listFeedback());
});

app.get('/api/admin/conversations', adminAuth, (req, res) => {
    res.json(db.listConversations());
});

app.get('/api/admin/conversations/:id', adminAuth, (req, res) => {
    res.json(db.getConversation(req.params.id));
});

app.get('/api/admin/staff-requests', adminAuth, (req, res) => {
    res.json(db.listStaffRequests());
});

app.post('/api/admin/staff-requests/:id/status', adminAuth, (req, res) => {
    const ok = db.updateStaffStatus(Number(req.params.id), req.body.status);
    if (!ok) return res.status(400).json({ error: 'Invalid status' });
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
    console.log(`Admin dashboard at http://localhost:${PORT}/admin`);
});
