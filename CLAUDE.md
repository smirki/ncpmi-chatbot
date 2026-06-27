# NCPMI Chatbot — project guide

Support chatbot widget for the PMI North Carolina Chapter (ncpmi.org). A floating chat
widget answers visitor questions from a knowledge base using an LLM, collects emails,
gathers feedback, and lets visitors request a callback from NCPMI staff. An admin
dashboard surfaces all of it. Full user-facing docs are in [README.md](README.md).

## Working agreement
- **The user runs the server. Do not start it yourself unless explicitly asked.**

## Architecture
- `server/server.js` — Express app: chat APIs (`/api/chat`, `/api/chat/stream`), `/api/email`,
  `/api/feedback`, `/api/staff-connect`, the password-protected admin API (`/api/admin/*` + `/admin`),
  and static hosting of the widget. A middleware blocks `/data/*` from the static root.
- `server/llmClient.js` — LLM calls to **Google Gemini** via its OpenAI-compatible endpoint
  (streaming + non-streaming). Thinking is controlled with `THINKING_LEVEL` through
  `extra_body.google.thinking_config.thinking_level`.
- `server/knowledgeBase.js` — loads and searches `ncpmicontent.txt` to build RAG context.
- `server/db.js` — persistence via the built-in `node:sqlite` (no native deps) at `data/ncpmi.db`:
  `emails`, `messages` (full conversations, grouped by a client `conversationId`),
  `feedback` (thumbs up/down stored with the Q&A), `staff_requests`.
- `server/admin/dashboard.html` — admin dashboard UI (HTTP Basic Auth against `ADMIN_PASSWORD`).
- `widget/widget.js`, `widget/widget.css` — the embeddable chat widget.
- `index.html` — demo page that loads the widget.

## Setup — local
Requires Node ≥ 23.4 (for flag-free `node:sqlite`); Node 24 LTS recommended.
1. `cp .env.example .env` and set `LLAMA_API_KEY` (a Google Gemini key) and `ADMIN_PASSWORD`.
2. `cd server && npm install`
3. `npm start` → http://localhost:3002
   - Widget/demo: `/index.html` · Admin dashboard: `/admin`

## Setup — Docker
1. `cp .env.example .env` and fill it in.
2. `docker compose up --build` → http://localhost:3002
   The SQLite DB persists in `./data` (bind-mounted).

## Environment variables
| Var | Required | Purpose |
| --- | --- | --- |
| `LLAMA_API_KEY` | yes | LLM provider key (Google Gemini by default) |
| `LLAMA_BASE_URL` | | OpenAI-compatible base URL (default: Gemini) |
| `LLAMA_MODEL` | | model id (default `models/gemini-flash-latest`) |
| `THINKING_LEVEL` | | `minimal` \| `low` \| `medium` \| `high` |
| `PORT` | | server port (default 3002) |
| `ADMIN_PASSWORD` | yes | password for `/admin` |
| `CORS_ORIGINS` | | comma-separated allowed origins (prod) |

## Notes
- Env vars are named `LLAMA_*` for legacy reasons but point at any OpenAI-compatible provider
  (currently Gemini).
- `gemini-flash-latest` is a Gemini 3 model: thinking can't be fully disabled — `minimal` is the floor.
- The "Connect with NCPMI staff" button records a request (visible in the dashboard) and shows a
  2–3 day callback message; it does **not** send email yet.
- Secrets live only in `.env` (gitignored). Never commit `.env` or `data/`.
