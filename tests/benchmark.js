/**
 * NCPMI Chatbot Benchmark Tests
 *
 * Tests the chatbot with the three benchmark questions
 * to verify it returns grounded answers with correct source URLs.
 *
 * Usage:
 *   1. Start the server: cd server && npm start
 *   2. Run tests: node tests/benchmark.js
 */

const API_URL = process.env.API_URL || 'http://localhost:3002';

const BENCHMARK_TESTS = [
    {
        name: 'PDU Information',
        query: 'Where can I find information about PDUs?',
        expectedUrl: 'https://ncpmi.org/education/pdu-information',
        expectedKeywords: ['PDU', 'Professional Development', 'certification', 'CCR']
    },
    {
        name: 'Volunteer Opportunities',
        query: 'Where can I find the link to volunteer?',
        expectedUrl: 'https://ncpmi.org/membership/volunteer-opportunities',
        expectedKeywords: ['volunteer', 'opportunities', 'VRMS', 'volunteers@ncpmi.org']
    },
    {
        name: 'Chapter Meeting Recordings',
        query: 'How do I find chapter meeting recordings?',
        expectedUrl: 'https://ncpmi.org/events/monthly-chapter-meeting/chapter-meeting-recordings',
        expectedKeywords: ['recording', 'Programs', 'Member Documents', 'speaker']
    }
];

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
                    email: 'benchmark-test@example.com'
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

            // Check if expected URL is in sources or answer
            const hasExpectedUrl =
                (data.sources && data.sources.some(url => url.includes(test.expectedUrl.replace('https://ncpmi.org', '')))) ||
                data.answer.includes(test.expectedUrl) ||
                data.answer.toLowerCase().includes(test.expectedUrl.split('/').pop().replace(/-/g, ' '));

            // Check if expected keywords are present
            const answerLower = data.answer.toLowerCase();
            const keywordsFound = test.expectedKeywords.filter(kw =>
                answerLower.includes(kw.toLowerCase())
            );

            console.log('Validation:');
            console.log(`  Expected URL mentioned: ${hasExpectedUrl ? '✅ YES' : '❌ NO'}`);
            console.log(`  Keywords found: ${keywordsFound.length}/${test.expectedKeywords.length} (${keywordsFound.join(', ')})`);

            if (hasExpectedUrl && keywordsFound.length > 0) {
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
