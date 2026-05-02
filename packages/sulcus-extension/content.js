// SULCUS Content Script
// Injects the Active Index into the LLM's context window.

console.log('[Sulcus] Content script loaded. Listening for agent queries...');

// Simple observer to intercept queries typed into standard chat interfaces.
document.addEventListener('keydown', (e) => {
    // Check if the user hits Enter inside a chat input
    if (e.key === 'Enter' && (e.target.tagName === 'TEXTAREA' || e.target.getAttribute('contenteditable') === 'true')) {
        const isContentEditable = e.target.getAttribute('contenteditable') === 'true';
        const query = isContentEditable ? e.target.innerText : e.target.value;
        if (!query || !query.trim()) return;

        // Perform semantic search via the background service worker
        chrome.runtime.sendMessage({ action: 'searchMemory', query }, (response) => {
            if (response.status === 'success' && response.data && response.data.length > 0) {
                console.log('[Sulcus] Relevant memories found:', response.data);
                
                // Format the memories
                const memoryContext = response.data.map(m => `[Memory (Heat ${parseFloat(m.heat).toFixed(2)}): ${m.text}]`).join('\n');
                const fullText = `${memoryContext}\n\n${query}`;

                // Inject back into the DOM after a slight delay to avoid race conditions with the UI's own Enter handler
                setTimeout(() => {
                    if (isContentEditable) {
                        e.target.innerText = fullText;
                    } else {
                        e.target.value = fullText;
                    }
                    // Dispatch an input event so React/Vue picks up the change
                    e.target.dispatchEvent(new Event('input', { bubbles: true }));
                }, 100);
            }
        });

        // Autonomously record the user's query as an episodic memory
        chrome.runtime.sendMessage({ action: 'addMemory', text: query, type: 'episodic' });
    }
});
