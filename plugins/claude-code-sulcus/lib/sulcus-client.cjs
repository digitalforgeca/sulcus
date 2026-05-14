/**
 * Sulcus REST API client for Claude Code plugin hooks.
 * Uses the REST API directly (not MCP) for performance in hooks.
 */
'use strict';

const https = require('node:https');
const http = require('node:http');
const { URL } = require('node:url');

const DEFAULT_SERVER = 'https://api.sulcus.ca';
const MAX_TIMEOUT_MS = 10000;

function getConfig() {
  const serverUrl = process.env.SULCUS_SERVER_URL || DEFAULT_SERVER;
  const apiKey = process.env.SULCUS_API_KEY || '';
  const namespace = process.env.SULCUS_NAMESPACE || process.env.USER || 'default';
  return { serverUrl, apiKey, namespace };
}

function request(method, path, body, timeoutMs = MAX_TIMEOUT_MS) {
  const { serverUrl, apiKey } = getConfig();
  if (!apiKey) return Promise.resolve(null);

  const url = new URL(path, serverUrl);
  const mod = url.protocol === 'https:' ? https : http;

  const payload = body ? JSON.stringify(body) : null;

  return new Promise((resolve) => {
    const req = mod.request(url, {
      method,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
      timeout: timeoutMs,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });

    if (payload) req.write(payload);
    req.end();
  });
}

async function searchMemories(query, limit = 5) {
  return request('POST', '/api/v1/agent/search', {
    query,
    limit,
    threshold: 0.3,
  });
}

async function storeMemory(content, memoryType = 'episodic', metadata = {}) {
  return request('POST', '/api/v1/agent/memory', {
    content,
    memory_type: memoryType,
    metadata,
  });
}

async function getStatus() {
  return request('GET', '/api/v1/agent/memory/status', null, 3000);
}

async function getHotNodes(limit = 10) {
  return request('GET', `/api/v1/agent/hot_nodes?limit=${limit}`, null, 5000);
}

async function getGraphNeighbors(memoryId, limit = 6) {
  return request('GET', `/api/v1/agent/graph/neighbors/${encodeURIComponent(memoryId)}?limit=${limit}`, null, 3000);
}

/**
 * List memories filtered by type (for profile injection).
 * GET /api/v1/agent/nodes?memory_type=<type>&page_size=<limit>&sort_by=current_heat&sort_order=desc
 */
async function listMemoriesByType(memoryType, limit = 10) {
  return request('GET', `/api/v1/agent/nodes?memory_type=${encodeURIComponent(memoryType)}&page_size=${limit}&sort_by=current_heat&sort_order=desc`, null, 5000);
}

/**
 * Classify text via SIU v2 — returns quality gate + memory type.
 * POST /api/v2/siu/label
 * Response: { quality: "store"|"reject", quality_confidence: float,
 *            memory_type: string, type_confidence: float,
 *            model_version: string, engine: string }
 */
async function classifyMemory(text) {
  return request('POST', '/api/v2/siu/label', { text }, 5000);
}

/**
 * Update a memory's heat value (for correction boosting).
 * PATCH /api/v1/agent/memory/:id
 */
async function updateMemoryHeat(memoryId, heat) {
  return request('PATCH', `/api/v1/agent/memory/${encodeURIComponent(memoryId)}`, {
    current_heat: heat,
  }, 3000);
}

module.exports = { getConfig, searchMemories, storeMemory, getStatus, getHotNodes, getGraphNeighbors, classifyMemory, updateMemoryHeat, listMemoriesByType };
