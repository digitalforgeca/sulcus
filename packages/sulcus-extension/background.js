import { SulcusMem } from '@sulcus/mem';
import { pipeline } from '@xenova/transformers';
import { PGlite } from '@electric-sql/pglite';

let memInstance = null;

// Initialize the Sulcus WASM module with PGlite and transformers.js
async function initSulcus() {
  if (memInstance) return memInstance;
  console.log('[Sulcus] Initializing vMMU...');

  const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  const pglite = await PGlite.create('idb://sulcus');

  memInstance = await SulcusMem.create(
    async (sql, params) => (await pglite.query(sql, params)).rows,
    async (text) => {
      const out = await embedder(text, { pooling: 'mean', normalize: true });
      return out.data; // Float32Array
    }
  );

  console.log('[Sulcus] vMMU initialized successfully.');
  return memInstance;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'addMemory') {
    initSulcus().then(mem => {
      mem.add_memory(request.text, request.type || null)
         .then(res => sendResponse({ status: 'success', data: res }))
         .catch(err => sendResponse({ status: 'error', error: err.toString() }));
    });
    return true; // Keep message channel open
  }
  
  if (request.action === 'searchMemory') {
    initSulcus().then(mem => {
      mem.search_memory(request.query, request.limit || 5)
         .then(res => sendResponse({ status: 'success', data: res }))
         .catch(err => sendResponse({ status: 'error', error: err.toString() }));
    });
    return true;
  }
});
