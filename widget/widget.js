/**
 * NCPMI Chat Widget
 * A support chatbot widget for ncpmi.org
 */

(function() {
    'use strict';

    // Configuration
    const CONFIG = {
        apiUrl: window.NCPMI_CHAT_API_URL || `http://localhost:${window.NCPMI_CHAT_PORT || 3002}`,
        storageKey: 'ncpmi_chat_email',
        conversationKey: 'ncpmi_chat_cid'
    };

    /**
     * Get (or create) a stable conversation id so the backend can group
     * all messages, feedback, and staff requests from this visitor.
     */
    function getConversationId() {
        let cid = localStorage.getItem(CONFIG.conversationKey);
        if (!cid) {
            cid = (window.crypto && crypto.randomUUID)
                ? crypto.randomUUID()
                : 'cid-' + Math.random().toString(36).slice(2) + '-' + Date.now();
            localStorage.setItem(CONFIG.conversationKey, cid);
        }
        return cid;
    }

    function newConversationId() {
        localStorage.removeItem(CONFIG.conversationKey);
        state.conversationId = getConversationId();
    }

    // State
    let state = {
        isOpen: false,
        isExpanded: false,
        currentTab: 'home',
        email: localStorage.getItem(CONFIG.storageKey) || null,
        newsletter: false,
        messages: [],
        isLoading: false,
        pendingMessage: null,
        pendingStaffConnect: false,
        lastQuestion: null,
        conversationId: getConversationId(),
        menuOpen: false
    };

    // Inline SVG icons (no external icon library is loaded)
    const ICONS = {
        chat: `<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/><path d="M7 9h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z"/></svg>`,
        send: `<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`,
        close: `<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
        expand: `<svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>`,
        collapse: `<svg viewBox="0 0 24 24"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>`,
        home: `<svg viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>`,
        chatTab: `<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>`,
        thumbUp: `<svg viewBox="0 0 24 24"><path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/></svg>`,
        thumbDown: `<svg viewBox="0 0 24 24"><path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"/></svg>`,
        menu: `<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>`,
        refresh: `<svg viewBox="0 0 24 24"><path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>`,
        clear: `<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`,
        // Quick-link tile icons
        people: `<svg viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>`,
        calendar: `<svg viewBox="0 0 24 24"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z"/></svg>`,
        school: `<svg viewBox="0 0 24 24"><path d="M12 3L1 9l11 6 9-4.91V17h2V9L12 3zm-6 9.18v3.82l6 3.27 6-3.27v-3.82l-6 3.27-6-3.27z"/></svg>`,
        heart: `<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`,
        mail: `<svg viewBox="0 0 24 24"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>`,
        chevron: `<svg viewBox="0 0 24 24"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>`
    };

    /** Wrap bot reply content in a chat bubble. */
    function botBubbleRow(innerHtml) {
        return `<div class="ncpmi-message-bubble">${innerHtml}</div>`;
    }

    /**
     * Create the widget HTML structure
     */
    function createWidget() {
        // Create container
        const container = document.createElement('div');
        container.className = 'ncpmi-widget';
        container.innerHTML = `
            <!-- Chat Bubble -->
            <div class="ncpmi-chat-bubble has-notification" id="ncpmi-bubble">
                ${ICONS.chat}
            </div>

            <!-- Chat Window -->
            <div class="ncpmi-chat-window" id="ncpmi-window">
                <!-- Header -->
                <div class="ncpmi-chat-header">
                    <div class="ncpmi-header-actions">
                        <button class="ncpmi-header-btn ncpmi-expand-btn" id="ncpmi-expand-btn" title="Expand">
                            ${ICONS.expand}
                        </button>
                        <button class="ncpmi-header-btn ncpmi-menu-btn" id="ncpmi-menu-btn" title="Menu">
                            ${ICONS.menu}
                        </button>
                        <button class="ncpmi-header-btn ncpmi-close-btn" id="ncpmi-close-btn" title="Close">
                            ${ICONS.close}
                        </button>
                    </div>
                    <!-- Dropdown Menu -->
                    <div class="ncpmi-dropdown-menu" id="ncpmi-dropdown-menu">
                        <button class="ncpmi-dropdown-item" id="ncpmi-refresh-btn">
                            ${ICONS.refresh}
                            <span>Refresh chat</span>
                        </button>
                        <button class="ncpmi-dropdown-item" id="ncpmi-clear-btn">
                            ${ICONS.clear}
                            <span>Clear history</span>
                        </button>
                    </div>
                    <div class="ncpmi-header-title">Hi there</div>
                    <div class="ncpmi-header-subtitle">Welcome to NCPMI. Ask us anything.</div>
                </div>

                <!-- PMI NC tri-color brand divider -->
                <div class="ncpmi-accent-bar"><span></span><span></span><span></span></div>

                <!-- Home Tab Content -->
                <div class="ncpmi-tab-content active" id="ncpmi-home-tab">
                    <div class="ncpmi-home-content">
                        <div class="ncpmi-home-hero">
                            <div class="ncpmi-home-hero-title">How can we help?</div>
                            <div class="ncpmi-home-hero-sub">Find quick links below or start a chat with NCPMI support.</div>
                        </div>
                        <div class="ncpmi-home-section">
                            <h3>Quick Links</h3>
                            <div class="ncpmi-quick-links">
                                <a href="https://ncpmi.org/membership/membership-information" target="_blank" class="ncpmi-quick-link">
                                    <span class="ncpmi-quick-link-icon is-purple">${ICONS.people}</span>
                                    <span class="ncpmi-quick-link-text">Membership</span>
                                    <span class="ncpmi-quick-link-chevron">${ICONS.chevron}</span>
                                </a>
                                <a href="https://ncpmi.org/events/events-calendar" target="_blank" class="ncpmi-quick-link">
                                    <span class="ncpmi-quick-link-icon is-orange">${ICONS.calendar}</span>
                                    <span class="ncpmi-quick-link-text">Events</span>
                                    <span class="ncpmi-quick-link-chevron">${ICONS.chevron}</span>
                                </a>
                                <a href="https://ncpmi.org/education/pdu-information" target="_blank" class="ncpmi-quick-link">
                                    <span class="ncpmi-quick-link-icon is-cyan">${ICONS.school}</span>
                                    <span class="ncpmi-quick-link-text">PDU Info</span>
                                    <span class="ncpmi-quick-link-chevron">${ICONS.chevron}</span>
                                </a>
                                <a href="https://ncpmi.org/membership/volunteer-opportunities" target="_blank" class="ncpmi-quick-link">
                                    <span class="ncpmi-quick-link-icon is-orange">${ICONS.heart}</span>
                                    <span class="ncpmi-quick-link-text">Volunteer</span>
                                    <span class="ncpmi-quick-link-chevron">${ICONS.chevron}</span>
                                </a>
                            </div>
                        </div>
                        <div class="ncpmi-home-section">
                            <h3>Contact Us</h3>
                            <a href="mailto:support@ncpmi.org" class="ncpmi-contact-link">
                                ${ICONS.mail}
                                <span>support@ncpmi.org</span>
                            </a>
                        </div>
                    </div>
                    <div class="ncpmi-home-cta">
                        <button class="ncpmi-start-chat-btn" id="ncpmi-start-chat-btn">
                            ${ICONS.chatTab}
                            <span>Start a conversation</span>
                        </button>
                    </div>
                </div>

                <!-- Chat Tab Content -->
                <div class="ncpmi-tab-content" id="ncpmi-chat-tab">
                    <div class="ncpmi-chat-body" id="ncpmi-messages">
                        <!-- Messages will be inserted here -->
                    </div>
                    <div class="ncpmi-chat-footer">
                        <div class="ncpmi-input-container">
                            <input type="text" class="ncpmi-chat-input" id="ncpmi-input" placeholder="Enter your message..." />
                            <button class="ncpmi-send-btn" id="ncpmi-send-btn">
                                ${ICONS.send}
                            </button>
                        </div>
                        <div class="ncpmi-footer-links">
                            <span>Powered by NCPMI Support</span>
                        </div>
                    </div>
                </div>

                <!-- Bottom Tabs -->
                <div class="ncpmi-tabs">
                    <div class="ncpmi-tab active" data-tab="home" id="ncpmi-tab-home">
                        ${ICONS.home}
                        <span>Home</span>
                    </div>
                    <div class="ncpmi-tab" data-tab="chat" id="ncpmi-tab-chat">
                        ${ICONS.chatTab}
                        <span>Chat</span>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(container);

        // Bind events
        bindEvents();
    }

    /**
     * Bind event listeners
     */
    function bindEvents() {
        // Toggle chat window
        document.getElementById('ncpmi-bubble').addEventListener('click', toggleChat);

        // Close button
        document.getElementById('ncpmi-close-btn').addEventListener('click', toggleChat);

        // Expand button
        document.getElementById('ncpmi-expand-btn').addEventListener('click', toggleExpand);

        // Menu button
        document.getElementById('ncpmi-menu-btn').addEventListener('click', toggleMenu);

        // Menu items
        document.getElementById('ncpmi-refresh-btn').addEventListener('click', refreshChat);
        document.getElementById('ncpmi-clear-btn').addEventListener('click', clearHistory);

        // Send message
        document.getElementById('ncpmi-send-btn').addEventListener('click', handleSend);

        // Enter key to send
        document.getElementById('ncpmi-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleSend();
        });

        // Tab switching
        document.getElementById('ncpmi-tab-home').addEventListener('click', () => switchTab('home'));
        document.getElementById('ncpmi-tab-chat').addEventListener('click', () => switchTab('chat'));

        // Start chat button on home
        document.getElementById('ncpmi-start-chat-btn').addEventListener('click', () => {
            switchTab('chat');
            initChat();
        });

        // Close menu when clicking outside
        document.addEventListener('click', (e) => {
            const menu = document.getElementById('ncpmi-dropdown-menu');
            const menuBtn = document.getElementById('ncpmi-menu-btn');
            if (state.menuOpen && !menu.contains(e.target) && !menuBtn.contains(e.target)) {
                closeMenu();
            }
        });
    }

    /**
     * Switch between tabs
     */
    function switchTab(tabName) {
        state.currentTab = tabName;

        // Update tab buttons
        document.querySelectorAll('.ncpmi-tab').forEach(t => t.classList.remove('active'));
        document.getElementById(`ncpmi-tab-${tabName}`).classList.add('active');

        // Update tab content
        document.querySelectorAll('.ncpmi-tab-content').forEach(c => c.classList.remove('active'));
        document.getElementById(`ncpmi-${tabName}-tab`).classList.add('active');

        // Initialize chat if switching to chat tab for first time
        if (tabName === 'chat' && state.messages.length === 0) {
            initChat();
        }

        // Focus input when switching to chat
        if (tabName === 'chat') {
            setTimeout(() => document.getElementById('ncpmi-input').focus(), 100);
        }
    }

    /**
     * Initialize chat with welcome message
     */
    function initChat() {
        if (state.messages.length === 0) {
            addBotMessage("Hello, Would you like to learn about membership?\n\nPlease note as a new or renewed member it may take up to 3 business days to access NCPMI.ORG.", [
                { text: 'YES', action: () => handleQuickReply('Tell me about NCPMI membership') },
                { text: 'NO', action: () => showEmailFormIfNeeded() }
            ]);
        }
    }

    /**
     * Toggle dropdown menu
     */
    function toggleMenu() {
        state.menuOpen = !state.menuOpen;
        const menu = document.getElementById('ncpmi-dropdown-menu');
        menu.classList.toggle('open', state.menuOpen);
    }

    /**
     * Close dropdown menu
     */
    function closeMenu() {
        state.menuOpen = false;
        document.getElementById('ncpmi-dropdown-menu').classList.remove('open');
    }

    /**
     * Refresh chat
     */
    function refreshChat() {
        closeMenu();
        clearMessages();
        initChat();
    }

    /**
     * Clear chat history
     */
    function clearHistory() {
        closeMenu();
        clearMessages();
        // Clear stored email too
        localStorage.removeItem(CONFIG.storageKey);
        state.email = null;
        state.lastQuestion = null;
        // Start a brand-new conversation thread
        newConversationId();
        initChat();
    }

    /**
     * Clear messages from UI
     */
    function clearMessages() {
        state.messages = [];
        const messagesContainer = document.getElementById('ncpmi-messages');
        if (messagesContainer) {
            messagesContainer.innerHTML = '';
        }
    }

    /**
     * Toggle chat window open/close
     */
    function toggleChat() {
        state.isOpen = !state.isOpen;
        const chatWindow = document.getElementById('ncpmi-window');
        const bubble = document.getElementById('ncpmi-bubble');

        if (state.isOpen) {
            chatWindow.classList.add('open');
            bubble.classList.remove('has-notification');
            bubble.style.display = 'none';
            if (state.currentTab === 'chat') {
                document.getElementById('ncpmi-input').focus();
            }
        } else {
            chatWindow.classList.remove('open');
            chatWindow.classList.remove('expanded');
            state.isExpanded = false;
            bubble.style.display = 'flex';
            updateExpandButton();
            closeMenu();
        }
    }

    /**
     * Toggle expanded view
     */
    function toggleExpand() {
        state.isExpanded = !state.isExpanded;
        const chatWindow = document.getElementById('ncpmi-window');

        if (state.isExpanded) {
            chatWindow.classList.add('expanded');
        } else {
            chatWindow.classList.remove('expanded');
        }

        updateExpandButton();
        scrollToBottom();
    }

    /**
     * Update expand button icon
     */
    function updateExpandButton() {
        const expandBtn = document.getElementById('ncpmi-expand-btn');
        if (expandBtn) {
            expandBtn.innerHTML = state.isExpanded ? ICONS.collapse : ICONS.expand;
            expandBtn.title = state.isExpanded ? 'Collapse' : 'Expand';
        }
    }

    /**
     * Handle send button click
     */
    function handleSend() {
        const input = document.getElementById('ncpmi-input');
        const message = input.value.trim();

        if (!message || state.isLoading) return;

        // Check if email is collected
        if (!state.email) {
            state.pendingMessage = message;
            showEmailForm();
            input.value = '';
            return;
        }

        // Send message
        sendMessage(message);
        input.value = '';
    }

    /**
     * Handle quick reply button click
     */
    function handleQuickReply(message) {
        if (!state.email) {
            state.pendingMessage = message;
            showEmailForm();
            return;
        }
        sendMessage(message);
    }

    /**
     * Show email form if email not collected
     */
    function showEmailFormIfNeeded() {
        if (!state.email) {
            showEmailForm();
        } else {
            addBotMessage("How can I help you today?\n\nIf you are renewing or a new member, please allow up to 3 business days to log in to NCPMI. Please use the same email address you signed up with on PMI.ORG\n\nPlease select one of the items below or type your question.", [
                { text: 'Membership Info', action: () => handleQuickReply('Tell me about membership') },
                { text: 'PDU Information', action: () => handleQuickReply('How do I earn PDUs?') },
                { text: 'Events', action: () => handleQuickReply('What events are coming up?') },
                { text: 'Volunteer', action: () => handleQuickReply('How can I volunteer?') },
                { text: 'Connect with NCPMI staff', action: () => handleStaffConnect() }
            ]);
        }
    }

    /**
     * Show email collection form
     */
    function showEmailForm() {
        const messagesContainer = document.getElementById('ncpmi-messages');

        const emailForm = document.createElement('div');
        emailForm.className = 'ncpmi-email-form';
        emailForm.innerHTML = `
            <div class="ncpmi-email-form-title">Please introduce yourself:</div>
            <input type="email" class="ncpmi-email-input" id="ncpmi-email-input" placeholder="Enter your email..." />
            <label class="ncpmi-newsletter-checkbox">
                <input type="checkbox" id="ncpmi-newsletter" />
                Sign up for our newsletter
            </label>
            <button class="ncpmi-email-submit" id="ncpmi-email-submit">Send</button>
        `;

        messagesContainer.appendChild(emailForm);
        scrollToBottom();

        // Bind email form events
        document.getElementById('ncpmi-email-submit').addEventListener('click', submitEmail);
        document.getElementById('ncpmi-email-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') submitEmail();
        });

        document.getElementById('ncpmi-email-input').focus();
    }

    /**
     * Submit email
     */
    async function submitEmail() {
        const emailInput = document.getElementById('ncpmi-email-input');
        const newsletterCheckbox = document.getElementById('ncpmi-newsletter');
        const email = emailInput.value.trim();

        if (!isValidEmail(email)) {
            emailInput.style.borderColor = '#ef4444';
            return;
        }

        state.email = email;
        state.newsletter = newsletterCheckbox.checked;

        // Save to localStorage
        localStorage.setItem(CONFIG.storageKey, email);

        // Send to server
        try {
            await fetch(`${CONFIG.apiUrl}/api/email`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, newsletter: state.newsletter, conversationId: state.conversationId })
            });
        } catch (err) {
            console.warn('Failed to register email:', err);
        }

        // Remove email form
        const emailForm = document.querySelector('.ncpmi-email-form');
        if (emailForm) emailForm.remove();

        // If the email was collected to connect with staff, do that now.
        if (state.pendingStaffConnect) {
            state.pendingStaffConnect = false;
            doStaffConnect();
            return;
        }

        // Add confirmation message
        addBotMessage(`Thanks! How can I help you today?\n\nPlease select one of the items below or type your question.`, [
            { text: 'Membership Info', action: () => handleQuickReply('Tell me about membership') },
            { text: 'PDU Information', action: () => handleQuickReply('How do I earn PDUs?') },
            { text: 'Events', action: () => handleQuickReply('What events are coming up?') },
            { text: 'Volunteer', action: () => handleQuickReply('How can I volunteer?') },
            { text: 'Connect with NCPMI staff', action: () => handleStaffConnect() }
        ]);

        // Send pending message if any
        if (state.pendingMessage) {
            sendMessage(state.pendingMessage);
            state.pendingMessage = null;
        }
    }

    /**
     * Send message to API
     */
    async function sendMessage(message) {
        // Add user message
        addUserMessage(message);
        state.lastQuestion = message;

        // Show loading
        state.isLoading = true;

        // Create streaming bot message
        const messageEl = createStreamingBotMessage();
        let fullText = '';

        try {
            const response = await fetch(`${CONFIG.apiUrl}/api/chat/stream`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, email: state.email, conversationId: state.conversationId })
            });

            if (!response.ok) {
                throw new Error('Failed to connect');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));

                            if (data.type === 'chunk') {
                                fullText += data.content;
                                updateStreamingMessage(messageEl, fullText);
                            } else if (data.type === 'done') {
                                // Finalize message with feedback (tied to the question asked)
                                finalizeStreamingMessage(messageEl, fullText, message);
                                state.messages.push({ role: 'bot', text: fullText });
                            } else if (data.type === 'error') {
                                updateStreamingMessage(messageEl, "I'm sorry, I encountered an error. Please try again or contact [support@ncpmi.org](mailto:support@ncpmi.org)");
                                finalizeStreamingMessage(messageEl, "Error");
                            }
                        } catch (e) {
                            // Skip invalid JSON
                        }
                    }
                }
            }

            state.isLoading = false;
        } catch (error) {
            console.error('Chat API Error:', error);
            state.isLoading = false;
            updateStreamingMessage(messageEl, "I'm sorry, I couldn't connect to the server. Please try again later or contact [support@ncpmi.org](mailto:support@ncpmi.org)");
            finalizeStreamingMessage(messageEl, "Error");
        }
    }

    /**
     * Create a streaming bot message element
     */
    function createStreamingBotMessage() {
        const messagesContainer = document.getElementById('ncpmi-messages');
        const messageEl = document.createElement('div');
        messageEl.className = 'ncpmi-message bot';
        messageEl.innerHTML = botBubbleRow('<span class="ncpmi-streaming-cursor"></span>');
        messagesContainer.appendChild(messageEl);
        scrollToBottom();
        return messageEl;
    }

    /**
     * Update streaming message content
     */
    function updateStreamingMessage(messageEl, text) {
        const bubble = messageEl.querySelector('.ncpmi-message-bubble');
        bubble.innerHTML = parseMarkdown(text) + '<span class="ncpmi-streaming-cursor"></span>';
        scrollToBottom();
    }

    /**
     * Finalize streaming message with feedback buttons
     */
    function finalizeStreamingMessage(messageEl, text, question) {
        const bubble = messageEl.querySelector('.ncpmi-message-bubble');
        bubble.innerHTML = parseMarkdown(text);

        // Add feedback buttons
        const feedbackEl = document.createElement('div');
        feedbackEl.className = 'ncpmi-feedback';
        feedbackEl.innerHTML = `
            <span>Was this helpful?</span>
            <button class="ncpmi-feedback-btn" data-helpful="true">${ICONS.thumbUp}</button>
            <button class="ncpmi-feedback-btn" data-helpful="false">${ICONS.thumbDown}</button>
        `;
        messageEl.appendChild(feedbackEl);

        // Bind feedback events (tied to this exact question + answer)
        feedbackEl.querySelectorAll('.ncpmi-feedback-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const helpful = btn.dataset.helpful === 'true';
                submitFeedback(helpful, question, text);
                feedbackEl.querySelectorAll('.ncpmi-feedback-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
            });
        });

        scrollToBottom();
    }

    /**
     * Parse markdown to HTML - SIMPLE NON-REGEX APPROACH
     * Only handles markdown links [text](url) - no auto-linking plain text
     * This prevents all the double-parsing bugs
     */
    function parseMarkdown(text) {
        let result = '';
        let i = 0;

        while (i < text.length) {
            // Check for markdown link: [text](url)
            if (text[i] === '[') {
                const linkEnd = findMarkdownLink(text, i);
                if (linkEnd) {
                    const linkText = text.slice(i + 1, linkEnd.closeBracket);
                    const url = text.slice(linkEnd.openParen + 1, linkEnd.closeParen);
                    // Escape the text, keep URL as-is for href
                    result += `<a href="${url.replace(/"/g, '&quot;')}" target="_blank">${escapeHtml(linkText)}</a>`;
                    i = linkEnd.closeParen + 1;
                    continue;
                }
            }

            // Check for bold: **text**
            if (text[i] === '*' && text[i + 1] === '*') {
                const endBold = text.indexOf('**', i + 2);
                if (endBold !== -1) {
                    const boldText = text.slice(i + 2, endBold);
                    result += `<strong>${escapeHtml(boldText)}</strong>`;
                    i = endBold + 2;
                    continue;
                }
            }

            // Check for newline
            if (text[i] === '\n') {
                result += '<br>';
                i++;
                continue;
            }

            // Regular character - escape it
            const char = text[i];
            if (char === '<') result += '&lt;';
            else if (char === '>') result += '&gt;';
            else if (char === '&') result += '&amp;';
            else if (char === '"') result += '&quot;';
            else result += char;

            i++;
        }

        return result;
    }

    /**
     * Find a complete markdown link starting at position i
     * Returns {closeBracket, openParen, closeParen} or null
     */
    function findMarkdownLink(text, i) {
        if (text[i] !== '[') return null;

        // Find closing bracket, handling nested brackets
        let depth = 1;
        let j = i + 1;
        while (j < text.length && depth > 0) {
            if (text[j] === '[') depth++;
            else if (text[j] === ']') depth--;
            j++;
        }
        if (depth !== 0) return null;

        const closeBracket = j - 1;

        // Must be followed by (
        if (text[closeBracket + 1] !== '(') return null;

        const openParen = closeBracket + 1;

        // Find closing paren, handling nested parens
        depth = 1;
        j = openParen + 1;
        while (j < text.length && depth > 0) {
            if (text[j] === '(') depth++;
            else if (text[j] === ')') depth--;
            j++;
        }
        if (depth !== 0) return null;

        const closeParen = j - 1;

        return { closeBracket, openParen, closeParen };
    }

    /**
     * Add a bot message to the chat
     */
    function addBotMessage(text, quickReplies = null, showFeedback = false) {
        const messagesContainer = document.getElementById('ncpmi-messages');

        const messageEl = document.createElement('div');
        messageEl.className = 'ncpmi-message bot';

        // Parse markdown and links
        const parsedText = parseMarkdown(text);

        let html = botBubbleRow(parsedText);

        // Add feedback buttons
        if (showFeedback) {
            html += `
                <div class="ncpmi-feedback">
                    <span>Was this helpful?</span>
                    <button class="ncpmi-feedback-btn" data-helpful="true">${ICONS.thumbUp}</button>
                    <button class="ncpmi-feedback-btn" data-helpful="false">${ICONS.thumbDown}</button>
                </div>
            `;
        }

        // Add quick reply buttons
        if (quickReplies && quickReplies.length > 0) {
            html += `<div class="ncpmi-quick-replies">
                ${quickReplies.map((qr, idx) => `<button class="ncpmi-quick-reply-btn" data-idx="${idx}">${qr.text}</button>`).join('')}
            </div>`;
        }

        messageEl.innerHTML = html;
        messagesContainer.appendChild(messageEl);

        // Bind quick reply events
        if (quickReplies) {
            messageEl.querySelectorAll('.ncpmi-quick-reply-btn').forEach((btn, idx) => {
                btn.addEventListener('click', () => {
                    quickReplies[idx].action();
                    // Remove quick replies after click
                    const qrContainer = btn.parentElement;
                    if (qrContainer) qrContainer.remove();
                });
            });
        }

        // Bind feedback events
        if (showFeedback) {
            messageEl.querySelectorAll('.ncpmi-feedback-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const helpful = btn.dataset.helpful === 'true';
                    submitFeedback(helpful);
                    // Mark as selected
                    messageEl.querySelectorAll('.ncpmi-feedback-btn').forEach(b => b.classList.remove('selected'));
                    btn.classList.add('selected');
                });
            });
        }

        state.messages.push({ role: 'bot', text });
        scrollToBottom();
    }

    /**
     * Add a user message to the chat
     */
    function addUserMessage(text) {
        const messagesContainer = document.getElementById('ncpmi-messages');

        const messageEl = document.createElement('div');
        messageEl.className = 'ncpmi-message user';
        messageEl.innerHTML = `<div class="ncpmi-message-bubble">${escapeHtml(text)}</div>`;

        messagesContainer.appendChild(messageEl);
        state.messages.push({ role: 'user', text });
        scrollToBottom();
    }

    /**
     * Show typing indicator
     */
    function showTypingIndicator() {
        const messagesContainer = document.getElementById('ncpmi-messages');

        const typingEl = document.createElement('div');
        typingEl.className = 'ncpmi-message bot';
        typingEl.id = 'ncpmi-typing';
        typingEl.innerHTML = botBubbleRow(`
            <div class="ncpmi-typing">
                <div class="ncpmi-typing-dot"></div>
                <div class="ncpmi-typing-dot"></div>
                <div class="ncpmi-typing-dot"></div>
            </div>
        `);

        messagesContainer.appendChild(typingEl);
        scrollToBottom();
    }

    /**
     * Remove typing indicator
     */
    function removeTypingIndicator() {
        const typingEl = document.getElementById('ncpmi-typing');
        if (typingEl) typingEl.remove();
    }

    /**
     * Submit feedback
     */
    async function submitFeedback(helpful, question, answer) {
        try {
            await fetch(`${CONFIG.apiUrl}/api/feedback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: state.email,
                    conversationId: state.conversationId,
                    question: question || null,
                    answer: answer || null,
                    helpful
                })
            });
        } catch (err) {
            console.warn('Failed to submit feedback:', err);
        }
    }

    /**
     * Handle "Connect with NCPMI staff" click.
     * Uses the email already collected; if none yet, collect it first.
     */
    function handleStaffConnect() {
        if (state.isLoading) return;

        if (!state.email) {
            state.pendingStaffConnect = true;
            switchTab('chat');
            addBotMessage("Sure, please share your email and we'll connect you with NCPMI staff.");
            showEmailForm();
            return;
        }

        doStaffConnect();
    }

    async function doStaffConnect() {
        try {
            const response = await fetch(`${CONFIG.apiUrl}/api/staff-connect`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: state.email,
                    conversationId: state.conversationId,
                    lastQuestion: state.lastQuestion
                })
            });
            const data = await response.json();

            if (response.ok) {
                addBotMessage(data.message || "We've reached out to them with your email. They'll get back to you in 2-3 days.");
            } else {
                addBotMessage("Sorry, something went wrong sending your request. Please try again or email [support@ncpmi.org](mailto:support@ncpmi.org).");
            }
        } catch (err) {
            console.warn('Failed to submit staff request:', err);
            addBotMessage("Sorry, I couldn't reach the server. Please try again or email [support@ncpmi.org](mailto:support@ncpmi.org).");
        }
    }

    /**
     * Scroll chat to bottom
     */
    function scrollToBottom() {
        const messagesContainer = document.getElementById('ncpmi-messages');
        if (messagesContainer) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }

    /**
     * Validate email format
     */
    function isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    /**
     * Escape HTML to prevent XSS
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Initialize widget when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createWidget);
    } else {
        createWidget();
    }
})();
