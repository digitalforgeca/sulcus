#!/usr/bin/env node
// Minimal "OpenClaw-style" example showing how an agent can augment prompts
// with Sulcus `active_index` before generation and then record the result.

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  const { connectSulcus } = await import('./openclaw-plugin.mjs');
  const client = await connectSulcus({ cwd: process.cwd(), autoSpawn: true });


  // helpers that mimic how an OpenClaw agent would use Sulcus (via plugin)
  async function addMemory(content) {
    return client.addMemory(content);
  }

  async function getActiveIndex(limit = 3) {
    return client.getActiveIndex(limit);
  }

  // 1) Wait for manifest (describe_tools)
  await client.describeTools();

  // Simulate an agent session that remembers dialogue and uses Sulcus to augment the prompt.
  const userMessage = 'How do I deploy the login fix to production?';
  console.log('\n[agent] user ->', userMessage);

  // record the user utterance as memory
  await addMemory(`user: ${userMessage}`);

  // Fetch top-3 hot memories from Sulcus
  const hot = await getActiveIndex(3);
  console.log('\n[agent] sulcus active_index (top)', hot.map(h => h.summary));

  // Build augmented prompt for the LLM (OpenClaw would insert this into the workspace/context)
  const augmentedPrompt = buildPrompt(hot, userMessage);
  console.log('\n[agent] augmented prompt:\n---\n' + augmentedPrompt + '\n---');

  // Simulated model response (replace with real OpenClaw call in production)
  const assistantReply = `Plan: 1) run the test suite 2) deploy to staging 3) run smoke test 4) deploy to prod. Related memory: ${hot.map(h=>h.summary).join('; ')}`;
  console.log('\n[agent] assistant ->', assistantReply);

  // Add assistant's reply to Sulcus as memory
  await addMemory(`assistant: ${assistantReply}`);

  // Done — shutdown the plugin (and the spawned sidecar)
  await client.close();
  console.log('\n[done] example finished');
}

function buildPrompt(memories, question) {
  const memText = memories.length
    ? memories.map((m, i) => `${i + 1}. ${m.summary}`).join('\n')
    : 'No prior memories.';

  return `You are an assistant. Use the following relevant memories from Sulcus to answer the user's question.\n\nRelevant memories:\n${memText}\n\nUser question:\n${question}\n\nAnswer concisely and cite memory items when relevant.`;
}

run().catch(err => {
  console.error('example failed:', err);
  process.exit(1);
});
