-- D1 schema for the Cloudflare Worker (same tables as server/db.js).
-- Apply with: npm run db:migrate

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
