// SULCUS Content Script
// Injects the Active Index into the LLM's context window.

console.log('[Sulcus] Content script loaded. Listening for agent queries...');

// Simple observer to intercept queries typed into standard chat interfaces.
// This is a placeholder for actual DOM scraping logic tailored to specific sites.
document.addEventListener('keydown', (e) => {
    // Check if the user hits Enter inside a chat input
    if (e.key === 'Enter' && e.target.tagName === 'TEXTAREA') {
        const query = e.target.value;
        if (!query.trim()) return;

        // Perform semantic search via the background service worker
        chrome.runtime.sendMessage({ action: 'searchMemory', query }, (response) => {
            if (response.status === 'success' && response.data.results.length > 0) {
                console.log('[Sulcus] Relevant memories found:', response.data.results);
                // Here we would ideally augment the prompt or inject a system message
                // before the LLM processes it.
            }
        });

        // Autonomously record the user's query as an episodic memory
        chrome.runtime.sendMessage({ action: 'addMemory', text: query, type: 'episodic' });
    }
});
