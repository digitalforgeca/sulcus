// SULCUS Popup script
console.log('[Sulcus] Popup script starting...');

async function updateStats() {
  try {
    // We send a message to the background script to get metrics
    chrome.runtime.sendMessage({ action: 'getMetrics' }, (response) => {
      if (response && response.status === 'success') {
        const stats = response.data;
        document.getElementById('hot-count').textContent = stats.active_index_size || 0;
      }
    });
  } catch (e) {
    console.error('[Sulcus] Failed to update stats:', e);
  }
}

document.getElementById('sync-now').addEventListener('click', () => {
    const btn = document.getElementById('sync-now');
    btn.textContent = 'Syncing...';
    btn.disabled = true;
    
    // Simulate sync or redirect to billing if no key
    chrome.storage.local.get(['apiKey'], (result) => {
      if (!result.apiKey) {
        alert('Cloud Sync requires a SULCUS Pro subscription. Redirecting to dashboard...');
        window.open('http://40.87.99.178:3000/dashboard/billing', '_blank');
        btn.textContent = 'Sync to Cloud';
        btn.disabled = false;
      } else {
        // Trigger background sync
        chrome.runtime.sendMessage({ action: 'syncNow' }, (response) => {
          btn.textContent = 'Sync complete!';
          setTimeout(() => {
            btn.textContent = 'Sync to Cloud';
            btn.disabled = false;
          }, 2000);
        });
      }
    });
});

// Initial update
updateStats();
// Periodic update
setInterval(updateStats, 5000);
