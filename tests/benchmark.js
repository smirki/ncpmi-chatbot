/**
 * NCPMI Chatbot Benchmark / Regression Tests
 *
 * Asks the chatbot a fixed set of questions and checks each answer is grounded:
 * the expected page is cited, expected keywords appear, and every ncpmi.org link
 * in the answer actually loads on the live site (no 404s). Run it after every
 * knowledge base refresh or prompt/config change.
 *
 * Usage:
 *   node tests/benchmark.js                                               # local server (http://localhost:3002)
 *   API_URL=https://ncpmi-chatbot.manavmaj2001.workers.dev node tests/benchmark.js
 */

const API_URL = process.env.API_URL || 'http://localhost:3002';
const CONTACT_PAGE = '/about-us/general-contact-us';

// expectedUrl: path that must be in the sources or the answer.
// expectedKeywords: at least one must appear in the answer (case-insensitive).
// expectedExact: the answer must equal this text.
const BENCHMARK_TESTS = [
    // The three benchmark queries listed on the demo page
    {
        name: 'PDU Information',
        query: 'Where can I find information about PDUs?',
        expectedUrl: '/education/pdu-information',
        expectedKeywords: ['PDU', 'Professional Development', 'CCR']
    },
    {
        name: 'Volunteer Opportunities',
        query: 'Where can I find the link to volunteer?',
        expectedUrl: '/membership/volunteer-opportunities',
        expectedKeywords: ['volunteer']
    },
    {
        name: 'Membership Renewal',
        query: 'How do I renew my NCPMI membership?',
        expectedUrl: '/membership/renew-transfer',
        expectedKeywords: ['renew']
    },
    // Coverage added after the Oct 15, 2026 test report (recommendation 4)
    {
        name: 'Job Board',
        query: 'Where can I find job postings?',
        expectedUrl: '/jobs',
        expectedKeywords: ['job']
    },
    {
        name: 'Mentoring',
        query: 'Does NCPMI have a mentoring program?',
        expectedKeywords: ['mentor']
    },
    {
        name: 'PMP Certification Prep',
        query: 'How can I prepare for the PMP certification exam?',
        expectedKeywords: ['PMP']
    },
    {
        name: 'Corporate Partnership',
        query: 'How can my company become a sponsor or corporate partner?',
        expectedUrl: '/sponsors',
        expectedKeywords: ['sponsor']
    },
    {
        name: 'Staff Contact',
        query: 'How do I contact NCPMI staff?',
        expectedUrl: CONTACT_PAGE,
        expectedKeywords: ['contact']
    },
    // Edge cases from the report (defects D001, D002)
    {
        name: 'Out of scope gets an escalation path',
        query: 'What is the weather in Raleigh today?',
        expectedUrl: CONTACT_PAGE,
        expectedKeywords: ['NCPMI']
    },
    {
        name: 'Gibberish asks to rephrase',
        query: 'asdfghjkl',
        expectedUrl: CONTACT_PAGE,
        expectedKeywords: ['rephrase']
    }
];

/** ncpmi.org links in an answer that do not load (404 etc.). */
async function deadLinks(answer) {
    const urls = [...new Set(answer.match(/https?:\/\/(?:www\.)?ncpmi\.org[^\s)\]]*/g) || [])]
        .map(u => u.replace(/[.,;:!?]+$/, ''));
    const dead = [];
    for (const url of urls) {
        // The site's firewall blocks user agents containing "bot".
        const res = await fetch(url, { headers: { 'User-Agent': 'NCPMI-Knowledge-Sync/1.0' } }).catch(() => null);
        if (!res || !res.ok) dead.push(`${res ? res.status : 'ERR'} ${url}`);
    }
    return dead;
}

async function runBenchmarks() {
    console.log('='.repeat(60));
    console.log('NCPMI Chatbot Benchmark Tests');
    console.log('='.repeat(60));
    console.log(`API URL: ${API_URL}`);
    console.log('');

    let passed = 0;
    let failed = 0;

    for (const test of BENCHMARK_TESTS) {
        console.log('-'.repeat(60));
        console.log(`Test: ${test.name}`);
        console.log(`Query: "${test.query}"`);
        console.log('');

        try {
            const response = await fetch(`${API_URL}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: test.query,
                    email: 'benchmark-test@example.com',
                    conversationId: 'benchmark'
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            console.log('Response:');
            console.log(data.answer);
            console.log('');
            console.log('Sources:', data.sources?.join(', ') || 'None');
            console.log('');

            const answerLower = data.answer.toLowerCase();
            const hasExpectedUrl = !test.expectedUrl ||
                (data.sources || []).some(url => url.includes(test.expectedUrl)) ||
                data.answer.includes(test.expectedUrl);
            const keywordsFound = test.expectedKeywords.filter(kw => answerLower.includes(kw.toLowerCase()));
            const dead = await deadLinks(data.answer);

            console.log('Validation:');
            if (test.expectedUrl) console.log(`  Expected page cited: ${hasExpectedUrl ? '✅ YES' : '❌ NO'} (${test.expectedUrl})`);
            console.log(`  Keywords found: ${keywordsFound.length}/${test.expectedKeywords.length} (${keywordsFound.join(', ')})`);
            console.log(`  Dead links: ${dead.length ? '❌ ' + dead.join(', ') : '✅ none'}`);

            if (hasExpectedUrl && keywordsFound.length > 0 && dead.length === 0) {
                console.log(`  Result: ✅ PASSED`);
                passed++;
            } else {
                console.log(`  Result: ❌ FAILED`);
                failed++;
            }

        } catch (error) {
            console.log(`Error: ${error.message}`);
            console.log(`Result: ❌ FAILED (Error)`);
            failed++;
        }

        console.log('');
    }

    console.log('='.repeat(60));
    console.log('Summary:');
    console.log(`  Passed: ${passed}/${BENCHMARK_TESTS.length}`);
    console.log(`  Failed: ${failed}/${BENCHMARK_TESTS.length}`);
    console.log('='.repeat(60));

    // Exit with error code if any tests failed
    process.exit(failed > 0 ? 1 : 0);
}

// Run the benchmarks
runBenchmarks();
