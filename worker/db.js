/**
 * Persistent storage for the Cloudflare Worker, backed by D1.
 * Same tables and queries as server/db.js (node:sqlite), but async.
 * Schema: worker/schema.sql
 */

const now = () => new Date().toISOString();

export function createDb(d1) {
    const all = async (sql, ...params) => (await d1.prepare(sql).bind(...params).all()).results;
    const count = async (sql) => (await d1.prepare(sql).first()).c;

    return {
        // ---- Write helpers -------------------------------------------------

        recordEmail(email, newsletter) {
            return d1.prepare(
                'INSERT INTO emails (email, newsletter, created_at) VALUES (?, ?, ?)'
            ).bind(email, newsletter ? 1 : 0, now()).run();
        },

        recordMessage({ conversationId, email, role, content, sources }) {
            return d1.prepare(
                `INSERT INTO messages (conversation_id, email, role, content, sources, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)`
            ).bind(
                conversationId || null,
                email || null,
                role,
                content,
                sources ? JSON.stringify(sources) : null,
                now()
            ).run();
        },

        recordFeedback({ conversationId, email, question, answer, helpful, comment }) {
            return d1.prepare(
                `INSERT INTO feedback (conversation_id, email, question, answer, helpful, comment, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`
            ).bind(
                conversationId || null,
                email || null,
                question || null,
                answer || null,
                helpful ? 1 : 0,
                comment || null,
                now()
            ).run();
        },

        recordStaffRequest({ conversationId, email, lastQuestion }) {
            return d1.prepare(
                `INSERT INTO staff_requests (conversation_id, email, last_question, status, created_at)
                 VALUES (?, ?, ?, 'new', ?)`
            ).bind(conversationId || null, email || null, lastQuestion || null, now()).run();
        },

        // ---- Dashboard read helpers ----------------------------------------

        async getStats() {
            const [emails, uniqueEmails, newsletterSignups, conversations, messages, userQuestions,
                thumbsUp, thumbsDown, staffRequests, staffRequestsNew] = await Promise.all([
                count('SELECT COUNT(*) AS c FROM emails'),
                count('SELECT COUNT(DISTINCT email) AS c FROM emails'),
                count('SELECT COUNT(*) AS c FROM emails WHERE newsletter = 1'),
                count('SELECT COUNT(DISTINCT conversation_id) AS c FROM messages WHERE conversation_id IS NOT NULL'),
                count('SELECT COUNT(*) AS c FROM messages'),
                count("SELECT COUNT(*) AS c FROM messages WHERE role = 'user'"),
                count('SELECT COUNT(*) AS c FROM feedback WHERE helpful = 1'),
                count('SELECT COUNT(*) AS c FROM feedback WHERE helpful = 0'),
                count('SELECT COUNT(*) AS c FROM staff_requests'),
                count("SELECT COUNT(*) AS c FROM staff_requests WHERE status = 'new'")
            ]);
            return {
                emails, uniqueEmails, newsletterSignups, conversations, messages, userQuestions,
                thumbsUp, thumbsDown, staffRequests, staffRequestsNew
            };
        },

        listEmails(limit = 500) {
            return all('SELECT id, email, newsletter, created_at FROM emails ORDER BY id DESC LIMIT ?', limit);
        },

        listFeedback(limit = 500) {
            return all(
                `SELECT id, conversation_id, email, question, answer, helpful, comment, created_at
                 FROM feedback ORDER BY id DESC LIMIT ?`, limit);
        },

        listConversations(limit = 500) {
            return all(
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
                 LIMIT ?`, limit);
        },

        getConversation(conversationId) {
            return all(
                `SELECT id, role, content, sources, email, created_at
                 FROM messages
                 WHERE conversation_id = ?
                 ORDER BY id ASC`, conversationId);
        },

        listStaffRequests(limit = 500) {
            return all(
                `SELECT id, conversation_id, email, last_question, status, created_at
                 FROM staff_requests ORDER BY id DESC LIMIT ?`, limit);
        },

        async updateStaffStatus(id, status) {
            const allowed = ['new', 'contacted', 'resolved'];
            if (!allowed.includes(status)) return false;
            await d1.prepare('UPDATE staff_requests SET status = ? WHERE id = ?').bind(status, id).run();
            return true;
        }
    };
}
