#!/usr/bin/env node
/**
 * Deterministic scraper for ncpmi.org -> ncpmicontent.txt
 *
 * Crawls every internal HTML page reachable from the homepage (breadth-first),
 * extracts the page title + main content area (no header/footer/sidebars/cookie
 * banner), pulls text out of linked PDFs with `pdftotext` (poppler), and writes
 * one block per URL in the format server/knowledgeBase.js expects:
 *
 *     https://ncpmi.org/some/page
 *
 *     # Page Title
 *     page text...
 *
 * Determinism: URLs are normalized (https://ncpmi.org, no query/fragment, no
 * trailing slash), links are visited in sorted order, the output is sorted by
 * URL (homepage first) and contains no timestamps. Running it twice against an
 * unchanged site produces a byte-identical file.
 *
 * Usage:  node scripts/scrape.mjs [--out ncpmicontent.txt] [--max-pages 1500] [--no-pdfs]
 */

import { load } from 'cheerio';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ORIGIN = 'https://ncpmi.org';
const ROOT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// The site's WAF 403s any user agent containing "bot", so keep this name bot-free.
const USER_AGENT = 'NCPMI-Knowledge-Sync/1.0 (+https://ncpmi.org)';

const args = process.argv.slice(2);
const argValue = (flag, fallback) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : fallback;
};
const OUT_FILE = path.resolve(ROOT_DIR, argValue('--out', 'ncpmicontent.txt'));
const MAX_PAGES = Number(argValue('--max-pages', 1500));
const INCLUDE_PDFS = !args.includes('--no-pdfs');
const CONCURRENCY = 4;

// Paths that are never knowledge-base content (logins, form endpoints, tokenized
// download links, Joomla internals). robots.txt Disallow rules are added at runtime.
const EXCLUDED_PREFIXES = ['/member-login', '/component/', '/doclink/', '/index.php', '/media/', '/templates/'];
const SKIP_EXTENSIONS = /\.(png|jpe?g|gif|svg|webp|ico|css|js|zip|docx?|xlsx?|pptx?|mp4|mp3|mov|ics|xml|json|txt)$/i;

// Elements inside the main content area that are not content.
const STRIP_SELECTORS = [
    // Joomla wraps list views (board, jobs, events) in <form>, so drop the controls, not the form.
    'script', 'style', 'noscript', 'iframe', 'svg', 'select', 'input', 'textarea', 'button', 'label',
    '.addtoany_container', '.a2a_kit', '.pagenav', '.pagination', '.article-footer-wrap',
    '.sp-module', '#sp-cookie-consent', '.visually-hidden', '.sr-only'
].join(',');

const BLOCK_TAGS = new Set([
    'address', 'article', 'aside', 'blockquote', 'br', 'dd', 'div', 'dl', 'dt', 'figcaption',
    'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main',
    'nav', 'ol', 'p', 'pre', 'section', 'table', 'tbody', 'thead', 'tr', 'ul'
]);

/** Canonical form of an internal URL, or null if it should not be crawled. */
function normalizeUrl(href, base, disallowed) {
    let url;
    try {
        url = new URL(href, base);
    } catch {
        return null;
    }
    if (!/^https?:$/.test(url.protocol)) return null;
    if (!['ncpmi.org', 'www.ncpmi.org'].includes(url.hostname)) return null;

    let pathname = decodeURI(url.pathname).replace(/\/{2,}/g, '/');
    if (pathname.length > 1) pathname = pathname.replace(/\/+$/, '');
    const isPdf = /\.pdf$/i.test(pathname);
    if (!isPdf && SKIP_EXTENSIONS.test(pathname)) return null;
    if (!isPdf && [...EXCLUDED_PREFIXES, ...disallowed].some(p => pathname.startsWith(p))) return null;
    return encodeURI(ORIGIN + pathname);
}

/**
 * Fetch and fully read a URL. The body read is inside the retry: the site sometimes
 * drops connections mid-body ("terminated"), and a silently missing page would make
 * the output differ between runs.
 */
async function fetchWithRetry(url, attempts = 4) {
    for (let i = 1; ; i++) {
        try {
            const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' });
            if (res.status >= 500 && i < attempts) throw new Error(`HTTP ${res.status}`);
            return {
                ok: res.ok,
                status: res.status,
                type: res.headers.get('content-type') || '',
                body: Buffer.from(await res.arrayBuffer())
            };
        } catch (err) {
            if (i >= attempts) throw err;
            await new Promise(r => setTimeout(r, 1000 * i));
        }
    }
}

/** Disallow rules from the `User-agent: *` group of robots.txt. */
async function robotsDisallowed() {
    const res = await fetchWithRetry(`${ORIGIN}/robots.txt`);
    if (!res.ok) return [];
    const rules = [];
    let inStarGroup = false;
    for (const raw of res.body.toString('utf-8').split('\n')) {
        const line = raw.replace(/#.*/, '').trim();
        const [key, ...rest] = line.split(':');
        const value = rest.join(':').trim();
        if (/^user-agent$/i.test(key)) inStarGroup = value === '*';
        else if (inStarGroup && /^disallow$/i.test(key) && value) rules.push(value);
    }
    return rules;
}

/** Plain text of a cheerio node with block structure preserved as newlines. */
function nodeText($, node) {
    const parts = [];
    const walk = (el) => {
        if (el.type === 'text') {
            parts.push(el.data.replace(/\s+/g, ' '));
            return;
        }
        if (el.type !== 'tag') return;
        const tag = el.name.toLowerCase();
        const block = BLOCK_TAGS.has(tag);
        if (block) parts.push('\n');
        if (tag === 'li') parts.push('- ');
        if (tag === 'td' || tag === 'th') parts.push(' | ');
        for (const child of el.children || []) walk(child);
        if (block) parts.push('\n');
    };
    walk(node);

    const lines = parts.join('').split('\n').map(l => l.replace(/\s+/g, ' ').replace(/^ ?\| /, '').trim());
    const out = [];
    for (const line of lines) {
        if (!line || line === '-') {
            if (out.length && out[out.length - 1] !== '') out.push('');
        } else {
            out.push(line);
        }
    }
    return out.join('\n').trim();
}

function extractPage(html, pageUrl, disallowed) {
    const $ = load(html);

    const links = new Set();
    $('a[href]').each((_, a) => {
        const u = normalizeUrl($(a).attr('href'), pageUrl, disallowed);
        if (u) links.add(u);
    });

    const title = ($('#sp-page-title h1, #sp-page-title h2').first().text() || $('title').text())
        .replace(/\s+/g, ' ').trim();

    const main = $('#sp-component').first().length ? $('#sp-component').first() : $('body');
    main.find(STRIP_SELECTORS).remove();
    // Main content area must not be mistaken for a chunk boundary by the KB loader.
    const text = nodeText($, main.get(0)).replace(/^https:\/\/ncpmi\.org/gm, 'ncpmi.org');

    return { title, text, links: [...links].sort() };
}

function pdfText(buffer) {
    const dir = mkdtempSync(path.join(tmpdir(), 'ncpmi-pdf-'));
    try {
        const file = path.join(dir, 'doc.pdf');
        writeFileSync(file, buffer);
        const raw = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], { maxBuffer: 64 * 1024 * 1024 }).toString();
        return raw.split('\n').map(l => l.replace(/\s+/g, ' ').trim())
            .join('\n').replace(/\n{3,}/g, '\n\n').replace(/^https:\/\/ncpmi\.org/gm, 'ncpmi.org').trim();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

async function main() {
    const disallowed = await robotsDisallowed();
    if (INCLUDE_PDFS) {
        try {
            execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
        } catch {
            throw new Error('pdftotext not found (brew install poppler), or pass --no-pdfs');
        }
    }

    const pages = new Map();          // url -> { title, text }
    const seen = new Set([`${ORIGIN}/`]);
    let frontier = [`${ORIGIN}/`];
    const failures = [];              // HTTP errors (broken links on the site): reported
    const networkErrors = [];         // still failing after retries: abort, output would be incomplete

    // Level-by-level BFS: each level is fetched in parallel, the next level is the
    // sorted set of new links, so the visited set is independent of fetch timing.
    while (frontier.length && pages.size < MAX_PAGES) {
        const level = frontier.slice(0, MAX_PAGES - pages.size);
        const found = new Set();
        let cursor = 0;

        const worker = async () => {
            while (cursor < level.length) {
                const url = level[cursor++];
                try {
                    const res = await fetchWithRetry(url);
                    if (!res.ok) {
                        failures.push(`${res.status} ${url}`);
                        continue;
                    }
                    const { type } = res;
                    if (/\.pdf$/i.test(url) || type.includes('application/pdf')) {
                        if (!INCLUDE_PDFS) continue;
                        const text = pdfText(res.body);
                        const name = decodeURI(url.split('/').pop()).replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ');
                        if (text) pages.set(url, { title: `${name} (PDF)`, text });
                        continue;
                    }
                    if (!type.includes('text/html')) continue;
                    const page = extractPage(res.body.toString('utf-8'), url, disallowed);
                    if (page.text) pages.set(url, page);
                    for (const link of page.links) {
                        if (/\.pdf$/i.test(link) && !INCLUDE_PDFS) continue;
                        found.add(link);
                    }
                } catch (err) {
                    networkErrors.push(`${err.message} ${url}`);
                }
            }
        };
        await Promise.all(Array.from({ length: CONCURRENCY }, worker));
        process.stderr.write(`level done: ${level.length} fetched, ${pages.size} pages kept\n`);

        frontier = [...found].filter(u => !seen.has(u)).sort();
        frontier.forEach(u => seen.add(u));
    }

    if (networkErrors.length) {
        throw new Error(`${networkErrors.length} pages failed after retries; not writing ${path.basename(OUT_FILE)}:\n  ${networkErrors.sort().join('\n  ')}`);
    }

    // Identical pages under different URLs (Joomla aliases) are kept once, under the shortest URL.
    // Title is part of the key: different menu items can share a body (e.g. the same event list).
    const byBody = new Map();
    for (const url of [...pages.keys()].sort((a, b) => a.length - b.length || (a < b ? -1 : 1))) {
        const body = `${pages.get(url).title}\n${pages.get(url).text}`;
        if (!byBody.has(body)) byBody.set(body, url);
    }
    const urls = [...byBody.values()].sort((a, b) =>
        a === `${ORIGIN}/` ? -1 : b === `${ORIGIN}/` ? 1 : a < b ? -1 : a > b ? 1 : 0);

    const blocks = urls.map(url => {
        const { title, text } = pages.get(url);
        return `${url}\n\n${title ? `# ${title}\n` : ''}${text}\n`;
    });
    writeFileSync(OUT_FILE, blocks.join('\n'));

    process.stderr.write(`\nWrote ${urls.length} pages (${pages.size - urls.length} duplicates dropped) to ${path.relative(ROOT_DIR, OUT_FILE)}\n`);
    if (pages.size >= MAX_PAGES) process.stderr.write(`WARNING: hit --max-pages ${MAX_PAGES}; crawl is incomplete\n`);
    if (failures.length) process.stderr.write(`${failures.length} failed:\n  ${failures.sort().join('\n  ')}\n`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
