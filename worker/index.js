/**
 * NCPMI Chatbot: Cloudflare Worker entry.
 *
 * Mirrors server/server.js (Express) route for route. Static files in public/
 * (demo page + widget) are served by Workers Static Assets before this code runs;
 * everything else lands here. Persistence is D1 (worker/db.js); the knowledge base
 * and admin dashboard are bundled into the Worker as text modules.
 *
 * LLM settings come from process.env (nodejs_compat populates it from vars + secrets),
 * so server/llmClient.js is shared unchanged with the Express server.
 */

import kbText from '../ncpmicontent.txt';
import dashboardHtml from '../server/admin/dashboard.html';
import { parseKnowledgeBase, searchKnowledgeWithContext, buildContext } from '../server/knowledgeBase.js';
import { chat, chatStream } from '../server/llmClient.js';
import { createDb } from './db.js';

parseKnowledgeBase(kbText);

const json = (data, status = 200) => Response.json(data, { status });

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Same behaviour as the Express cors() config: reflect the origin if allowed
// (all origins when CORS_ORIGINS is unset), with credentials.
function corsHeaders(request, env) {
    const origin = request.headers.get('Origin');
    if (!origin) return {};
    const allowed = env.CORS_ORIGINS ? env.CORS_ORIGINS.split(',').map(o => o.trim()) : null;
    if (allowed && !allowed.includes(origin)) return {};
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Vary': 'Origin'
    };
}

// HTTP Basic Auth for the admin dashboard (shared password from ADMIN_PASSWORD).
function isAdmin(request, env) {
    const [scheme, encoded] = (request.headers.get('Authorization') || '').split(' ');
    if (scheme !== 'Basic' || !encoded) return false;
    let decoded;
    try {
        decoded = atob(encoded);
    } catch {
        return false;
    }
    return decoded.slice(decoded.indexOf(':') + 1) === env.ADMIN_PASSWORD;
}

function retrieve(message) {
    // 5 best chunks + adjacent context, same as the Express server.
    const relevantChunks = searchKnowledgeWithContext(message, 5);
    const context = relevantChunks.length > 0
        ? buildContext(relevantChunks)
        : 'No specific information found in the available resources.';
    const sources = relevantChunks.length > 0
        ? relevantChunks.map(chunk => chunk.url)
        : ['https://ncpmi.org'];
    return { context, sources };
}

async function handleChat(body, db) {
    const { message, email, conversationId } = body;
    if (!email) return json({ error: 'Email required before chatting' }, 400);
    if (!message || message.trim().length === 0) return json({ error: 'Message required' }, 400);

    try {
        await db.recordMessage({ conversationId, email, role: 'user', content: message });
        const { context, sources } = retrieve(message);
        const answer = await chat(context, message);
        await db.recordMessage({ conversationId, email, role: 'assistant', content: answer, sources });
        return json({ answer, sources });
    } catch (error) {
        console.error('Chat API Error:', error);
        return json({ error: 'Failed to get response. Please try again.', details: error.message }, 500);
    }
}

function handleChatStream(body, db, ctx) {
    const { message, email, conversationId } = body;
    if (!email) return json({ error: 'Email required before chatting' }, 400);
    if (!message || message.trim().length === 0) return json({ error: 'Message required' }, 400);

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    const send = (data) => writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

    ctx.waitUntil((async () => {
        try {
            await db.recordMessage({ conversationId, email, role: 'user', content: message });
            const { context, sources } = retrieve(message);
            let finished;
            const done = new Promise(resolve => { finished = resolve; });

            chatStream(
                context,
                message,
                (chunk) => send({ type: 'chunk', content: chunk }),
                (fullText) => finished(
                    db.recordMessage({ conversationId, email, role: 'assistant', content: fullText, sources })
                        .then(() => send({ type: 'done', sources }))
                ),
                (error) => finished(send({ type: 'error', message: error.message }))
            );
            await done;
        } catch (error) {
            console.error('Stream Chat API Error:', error);
            await send({ type: 'error', message: 'Failed to get response' });
        } finally {
            await writer.close();
        }
    })());

    return new Response(readable, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
    });
}

async function route(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;
    const db = createDb(env.DB);
    const body = method === 'POST' ? await request.json().catch(() => ({})) : {};

    if (method === 'GET' && pathname === '/api/health') {
        return json({ status: 'ok', timestamp: new Date().toISOString() });
    }

    if (method === 'POST' && pathname === '/api/email') {
        const { email, newsletter } = body;
        if (!email || !isValidEmail(email)) return json({ error: 'Valid email required' }, 400);
        await db.recordEmail(email, newsletter || false);
        return json({ success: true, message: 'Email registered' });
    }

    if (method === 'POST' && pathname === '/api/chat') return handleChat(body, db);
    if (method === 'POST' && pathname === '/api/chat/stream') return handleChatStream(body, db, ctx);

    if (method === 'POST' && pathname === '/api/feedback') {
        const { email, conversationId, question, answer, helpful, comment } = body;
        await db.recordFeedback({ conversationId, email, question, answer, helpful, comment });
        return json({ success: true });
    }

    if (method === 'POST' && pathname === '/api/staff-connect') {
        const { email, conversationId, lastQuestion } = body;
        if (!email || !isValidEmail(email)) return json({ error: 'Valid email required' }, 400);
        await db.recordStaffRequest({ conversationId, email, lastQuestion });
        return json({
            success: true,
            message: "We've reached out to them with your email. They'll get back to you in 2-3 days."
        });
    }

    /* ============================== ADMIN ============================== */

    if (pathname === '/admin' || pathname.startsWith('/api/admin/')) {
        if (!env.ADMIN_PASSWORD) {
            return new Response('Admin dashboard not configured: set the ADMIN_PASSWORD secret', { status: 500 });
        }
        if (!isAdmin(request, env)) {
            return new Response('Authentication required', {
                status: 401,
                headers: { 'WWW-Authenticate': 'Basic realm="NCPMI Admin"' }
            });
        }

        if (method === 'GET' && pathname === '/admin') {
            return new Response(dashboardHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }
        if (method === 'GET') {
            const conversation = pathname.match(/^\/api\/admin\/conversations\/(.+)$/);
            if (conversation) return json(await db.getConversation(decodeURIComponent(conversation[1])));
            const reads = {
                '/api/admin/stats': () => db.getStats(),
                '/api/admin/emails': () => db.listEmails(),
                '/api/admin/feedback': () => db.listFeedback(),
                '/api/admin/conversations': () => db.listConversations(),
                '/api/admin/staff-requests': () => db.listStaffRequests()
            };
            if (reads[pathname]) return json(await reads[pathname]());
        }
        const status = pathname.match(/^\/api\/admin\/staff-requests\/(\d+)\/status$/);
        if (method === 'POST' && status) {
            const ok = await db.updateStaffStatus(Number(status[1]), body.status);
            if (!ok) return json({ error: 'Invalid status' }, 400);
            return json({ success: true });
        }
    }

    return new Response('Not found', { status: 404 });
}

export default {
    async fetch(request, env, ctx) {
        const cors = corsHeaders(request, env);
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: {
                    ...cors,
                    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
                    'Access-Control-Allow-Headers': request.headers.get('Access-Control-Request-Headers') || 'Content-Type'
                }
            });
        }

        const response = await route(request, env, ctx);
        for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
        return response;
    }
};
