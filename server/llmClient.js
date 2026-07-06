/**
 * LLM Client for Llama API (OpenAI-compatible)
 */

const SYSTEM_PROMPT = `You are the NCPMI Support Assistant for the PMI North Carolina Chapter website.

CRITICAL RULES:
1. Answer questions ONLY based on the provided context below
2. ALWAYS include source links using markdown format: [Link Text](URL) - for example: [Learn more about PDUs](https://ncpmi.org/education/pdu-information)
3. Naturally embed the source links within your answer text, don't list them separately at the end
4. ONLY use the fallback "I don't have specific information about that" if you truly cannot find ANY relevant information in the context. If you found useful information and answered the question, do NOT add this fallback.
5. Be helpful, friendly, and concise
6. Use the exact URLs provided in the context - do not make up URLs
7. For email addresses, use markdown mailto links: [email@example.com](mailto:email@example.com)
8. NEVER output raw HTML tags like <a href="...">, target="_blank", or any HTML attributes. ONLY use markdown syntax.
9. NEVER use emojis, emoticons, or other decorative symbols anywhere in your responses. Keep the tone professional and text-only.
10. NEVER use em dashes (—) or en dashes (–). Use a comma, a period, parentheses, or a colon instead. Use a normal hyphen only inside ranges like "2-3 days".

You can engage in friendly conversation, tell jokes, and be personable while still being helpful for NCPMI-related questions. Even the jokes should be ncpmi related, and must not contain emojis.

Remember: Use ONLY markdown link syntax [text](url). Never output HTML. Never use emojis. Never use em dashes or en dashes. If you answered the question, don't add a disclaimer saying you couldn't find information.`;

/**
 * Call the Llama API with context and user question (non-streaming)
 * @param {string} context - Retrieved knowledge base context with URLs
 * @param {string} userMessage - User's question
 * @returns {Promise<string>} - LLM response
 */
async function chat(context, userMessage) {
    const apiKey = process.env.LLAMA_API_KEY;
    const baseUrl = process.env.LLAMA_BASE_URL || 'https://api.llama.com/compat/v1/';
    const model = process.env.LLAMA_MODEL || 'Llama-4-Maverick-17B-128E-Instruct-FP8';
    const thinkingLevel = process.env.THINKING_LEVEL || 'minimal';

    try {
        const response = await fetch(`${baseUrl}chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: model,
                // Gemini "thinking" control via the OpenAI-compat layer's extra_body.
                // gemini-flash-latest (Gemini 3) can't fully disable thinking; "minimal" is the floor.
                extra_body: { google: { thinking_config: { thinking_level: thinkingLevel } } },
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: `Context:\n${context}\n\nQuestion: ${userMessage}` }
                ],
                temperature: 0.3,
                max_tokens: 2000
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('LLM API Error:', response.status, errorText);
            throw new Error(`LLM API error: ${response.status}`);
        }

        const data = await response.json();
        return data.choices[0].message.content;
    } catch (error) {
        console.error('LLM Client Error:', error);
        throw error;
    }
}

/**
 * Stream response from Llama API
 * @param {string} context - Retrieved knowledge base context
 * @param {string} userMessage - User's question
 * @param {Function} onChunk - Callback for each text chunk
 * @param {Function} onDone - Callback when streaming is complete
 * @param {Function} onError - Callback for errors
 */
async function chatStream(context, userMessage, onChunk, onDone, onError) {
    const apiKey = process.env.LLAMA_API_KEY;
    const baseUrl = process.env.LLAMA_BASE_URL || 'https://api.llama.com/compat/v1/';
    const model = process.env.LLAMA_MODEL || 'Llama-4-Maverick-17B-128E-Instruct-FP8';
    const thinkingLevel = process.env.THINKING_LEVEL || 'minimal';

    try {
        const response = await fetch(`${baseUrl}chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: model,
                // Gemini "thinking" control via the OpenAI-compat layer's extra_body.
                // gemini-flash-latest (Gemini 3) can't fully disable thinking; "minimal" is the floor.
                extra_body: { google: { thinking_config: { thinking_level: thinkingLevel } } },
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: `Context:\n${context}\n\nQuestion: ${userMessage}` }
                ],
                temperature: 0.3,
                max_tokens: 2000,
                stream: true
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('LLM API Error:', response.status, errorText);
            onError(new Error(`LLM API error: ${response.status}`));
            return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep incomplete line in buffer

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') {
                        onDone(fullText);
                        return;
                    }
                    try {
                        const parsed = JSON.parse(data);
                        const content = parsed.choices?.[0]?.delta?.content;
                        if (content) {
                            fullText += content;
                            onChunk(content);
                        }
                    } catch (e) {
                        // Skip invalid JSON lines
                    }
                }
            }
        }

        onDone(fullText);
    } catch (error) {
        console.error('LLM Stream Error:', error);
        onError(error);
    }
}

module.exports = { chat, chatStream };
