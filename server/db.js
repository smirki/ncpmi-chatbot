/**
 * Persistent storage for the NCPMI chatbot.
 * Uses node:sqlite (built into Node 22+, no native dependency).
 *
 * Tracks: collected emails, full chat conversations, thumbs up/down
 * feedback (with the Q&A it refers to), and "connect with staff" requests.
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

// Keep the DB outside the static web root would be ideal; we keep it in
// /data and the server blocks /data from static serving (see server.js).
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'ncpmi.db');

const db = new DatabaseSync(dbPath);

db.exec(`
    CREATE TABLE IF NOT EXISTS emails (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        newsletter INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT,
        email TEXT,
        role TEXT NOT NULL,            -- 'user' | 'assistant'
        content TEXT NOT NULL,
        sources TEXT,                  -- JSON array of source URLs (assistant only)
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT,
        email TEXT,
        question TEXT,
        answer TEXT,
        helpful INTEGER NOT NULL,      -- 1 = thumbs up, 0 = thumbs down
        comment TEXT,
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS staff_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT,
        email TEXT,
        last_question TEXT,
        status TEXT NOT NULL DEFAULT 'new',   -- 'new' | 'contacted' | 'resolved'
        created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
`);

const now = () => new Date().toISOString();

// ---- Write helpers ---------------------------------------------------------

function recordEmail(email, newsletter) {
    db.prepare(
        'INSERT INTO emails (email, newsletter, created_at) VALUES (?, ?, ?)'
    ).run(email, newsletter ? 1 : 0, now());
}

function recordMessage({ conversationId, email, role, content, sources }) {
    db.prepare(
        `INSERT INTO messages (conversation_id, email, role, content, sources, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
        conversationId || null,
        email || null,
        role,
        content,
        sources ? JSON.stringify(sources) : null,
        now()
    );
}

function recordFeedback({ conversationId, email, question, answer, helpful, comment }) {
    db.prepare(
        `INSERT INTO feedback (conversation_id, email, question, answer, helpful, comment, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
        conversationId || null,
        email || null,
        question || null,
        answer || null,
        helpful ? 1 : 0,
        comment || null,
        now()
    );
}

function recordStaffRequest({ conversationId, email, lastQuestion }) {
    const info = db.prepare(
        `INSERT INTO staff_requests (conversation_id, email, last_question, status, created_at)
         VALUES (?, ?, ?, 'new', ?)`
    ).run(conversationId || null, email || null, lastQuestion || null, now());
    return info.lastInsertRowid;
}

// ---- Dashboard read helpers ------------------------------------------------

function getStats() {
    const one = (sql) => db.prepare(sql).get();
    return {
        emails: one('SELECT COUNT(*) AS c FROM emails').c,
        uniqueEmails: one('SELECT COUNT(DISTINCT email) AS c FROM emails').c,
        newsletterSignups: one('SELECT COUNT(*) AS c FROM emails WHERE newsletter = 1').c,
        conversations: one('SELECT COUNT(DISTINCT conversation_id) AS c FROM messages WHERE conversation_id IS NOT NULL').c,
        messages: one('SELECT COUNT(*) AS c FROM messages').c,
        userQuestions: one("SELECT COUNT(*) AS c FROM messages WHERE role = 'user'").c,
        thumbsUp: one('SELECT COUNT(*) AS c FROM feedback WHERE helpful = 1').c,
        thumbsDown: one('SELECT COUNT(*) AS c FROM feedback WHERE helpful = 0').c,
        staffRequests: one('SELECT COUNT(*) AS c FROM staff_requests').c,
        staffRequestsNew: one("SELECT COUNT(*) AS c FROM staff_requests WHERE status = 'new'").c
    };
}

function listEmails(limit = 500) {
    return db.prepare(
        'SELECT id, email, newsletter, created_at FROM emails ORDER BY id DESC LIMIT ?'
    ).all(limit);
}

function listFeedback(limit = 500) {
    return db.prepare(
        `SELECT id, conversation_id, email, question, answer, helpful, comment, created_at
         FROM feedback ORDER BY id DESC LIMIT ?`
    ).all(limit);
}

function listConversations(limit = 500) {
    return db.prepare(
        `SELECT conversation_id,
                MAX(email) AS email,
                COUNT(*) AS message_count,
                SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) AS question_count,
                MIN(created_at) AS started_at,
                MAX(created_at) AS last_at
         FROM messages
         WHERE conversation_id IS NOT NULL
         GROUP BY conversation_id
         ORDER BY last_at DESC
         LIMIT ?`
    ).all(limit);
}

function getConversation(conversationId) {
    return db.prepare(
        `SELECT id, role, content, sources, email, created_at
         FROM messages
         WHERE conversation_id = ?
         ORDER BY id ASC`
    ).all(conversationId);
}

function listStaffRequests(limit = 500) {
    return db.prepare(
        `SELECT id, conversation_id, email, last_question, status, created_at
         FROM staff_requests ORDER BY id DESC LIMIT ?`
    ).all(limit);
}

function updateStaffStatus(id, status) {
    const allowed = ['new', 'contacted', 'resolved'];
    if (!allowed.includes(status)) return false;
    db.prepare('UPDATE staff_requests SET status = ? WHERE id = ?').run(status, id);
    return true;
}

module.exports = {
    recordEmail,
    recordMessage,
    recordFeedback,
    recordStaffRequest,
    getStats,
    listEmails,
    listFeedback,
    listConversations,
    getConversation,
    listStaffRequests,
    updateStaffStatus
};
