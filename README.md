# NCPMI Chatbot

A support chatbot widget for the **PMI North Carolina Chapter** ([ncpmi.org](https://ncpmi.org)).
A floating chat widget answers visitor questions from a curated knowledge base using an
LLM (Google Gemini), collects emails, gathers thumbs-up/down feedback, and lets visitors
request a callback from NCPMI staff. Everything is logged to a built-in admin dashboard.

---

## Features

- 💬 **RAG chat widget** — answers grounded in `ncpmicontent.txt`, with inline source links and streaming responses.
- 📧 **Email capture** — visitors introduce themselves before chatting (with optional newsletter opt-in).
- 👍 **Feedback** — thumbs up/down stored alongside the exact question and answer.
- 🧑‍💼 **"Connect with NCPMI staff"** — records a callback request using the visitor's email.
- 📊 **Admin dashboard** — password-protected view of conversations, feedback, emails, and staff requests.
- 🗄️ **Zero-dependency storage** — SQLite via the built-in `node:sqlite` module (no native build step).

---

## Quick start (local)

> Requires **Node.js 24 LTS** (or any version ≥ 23.4 — needed for the built-in `node:sqlite`).

```bash
# 1. Clone
git clone https://github.com/smirki/ncpmi-chatbot.git
cd ncpmi-chatbot

# 2. Configure
cp .env.example .env
#   then edit .env and set LLAMA_API_KEY (a Google Gemini key) and ADMIN_PASSWORD

# 3. Install & run
cd server
npm install
npm start
```

Then open:

| What | URL |
| --- | --- |
| Demo page + widget | http://localhost:3002/index.html |
| Admin dashboard | http://localhost:3002/admin |

The dashboard login uses any username and the `ADMIN_PASSWORD` from your `.env`.

---

## Quick start (Docker)

> Requires Docker with the Compose plugin. No local Node install needed.

```bash
cp .env.example .env          # then fill in your keys
docker compose up --build
```

The app is served on `http://localhost:3002` (or whatever `PORT` you set in `.env`).
The SQLite database is persisted to `./data` on the host, so your collected data
survives container restarts and rebuilds.

To run in the background: `docker compose up --build -d`
To stop: `docker compose down`

---

## Environment variables

Copy `.env.example` to `.env` and fill these in:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `LLAMA_API_KEY` | ✅ | — | API key for the LLM provider (a **Google Gemini** key by default). |
| `LLAMA_BASE_URL` | | `https://generativelanguage.googleapis.com/v1beta/openai/` | OpenAI-compatible base URL. |
| `LLAMA_MODEL` | | `models/gemini-flash-latest` | Model id. |
| `THINKING_LEVEL` | | `minimal` | Gemini thinking level: `minimal` \| `low` \| `medium` \| `high`. |
| `PORT` | | `3002` | Port the server listens on. |
| `ADMIN_PASSWORD` | ✅ | — | Password for the `/admin` dashboard. **Change it.** |
| `CORS_ORIGINS` | | (allow all) | Comma-separated allowed origins for production. |

> **Note on naming:** the `LLAMA_*` variables are named that way for legacy reasons, but
> the server speaks the OpenAI-compatible protocol and currently points at Google Gemini.
> You can repoint it at any OpenAI-compatible endpoint by changing these three variables.

---

## Embedding the widget on a website

The widget is plain JS/CSS — drop it into any page and point it at your server:

```html
<link rel="stylesheet" href="https://your-server.com/widget/widget.css">
<script>
  window.NCPMI_CHAT_API_URL = 'https://your-server.com';
</script>
<script src="https://your-server.com/widget/widget.js"></script>
```

For production, set `CORS_ORIGINS` in `.env` to the site(s) that will embed the widget.

---

## Project structure

```
ncpmi-chatbot/
├── index.html              # Demo page that loads the widget
├── ncpmicontent.txt        # Knowledge base (RAG source content)
├── widget/
│   ├── widget.js           # Embeddable chat widget
│   └── widget.css          # Widget styles (NCPMI purple theme)
├── server/
│   ├── server.js           # Express app: chat, email, feedback, staff, admin APIs
│   ├── llmClient.js        # LLM calls (Gemini, OpenAI-compatible; streaming + sync)
│   ├── knowledgeBase.js    # Loads & searches ncpmicontent.txt
│   ├── db.js               # SQLite persistence (node:sqlite)
│   └── admin/
│       └── dashboard.html  # Password-protected admin dashboard
├── tests/benchmark.js      # Knowledge-base retrieval benchmark
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

Collected data is stored in `data/ncpmi.db` (created on first run; gitignored).

---

## Admin dashboard

Visit `/admin` and log in with `ADMIN_PASSWORD`. Tabs:

- **Conversations** — every chat, grouped by visitor; click a row for the full transcript.
- **Feedback** — thumbs up/down with the question and answer that was rated.
- **Staff Requests** — callback requests; update status (new → contacted → resolved).
- **Emails** — every collected email and newsletter opt-in.

---

## Notes & roadmap

- The **"Connect with NCPMI staff"** button currently records a request and shows the visitor a
  "we'll get back to you in 2–3 days" message — it does **not** send an email yet. Wiring up an
  email/SMTP integration is the natural next step.
- Secrets live only in `.env` (gitignored). The server blocks `/data/*` and dotfiles from the
  static root, so the database and `.env` are never downloadable.

## License

Internal project for NCPMI. All rights reserved.
