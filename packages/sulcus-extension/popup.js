// SULCUS Popup script
console.log('[Sulcus] Popup loaded.');

document.getElementById('sync-now').addEventListener('click', () => {
    alert('Cloud Sync requires a SULCUS Pro subscription. Redirecting to sulcus.io...');
    window.open('https://sulcus.io', '_blank');
});
