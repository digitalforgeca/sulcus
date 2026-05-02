# SULCUS Social Launch Plan

## Overview
Launch cadence: 3-day build-up starting Tuesday, March 10th.
Goal: Establish SULCUS as the "vMMU for AI Agents" and drive developer waitlist signups.

## Day 1: The Problem (Hook)
**Channel:** X/Twitter
**Format:** Thread
- **Tweet 1:** Your AI agent doesn't have a memory problem. It has a context management problem. The context window is a CPU register, not a disk. We're building the first vMMU for agents. Launching in 48h. 🦀🚀
- **Tweet 2:** Every RAG system today is a "best guess" search. But agents need deterministic recall. They need to "page" memory in and out of the context window based on salience and heat.
- **Tweet 3:** SULCUS provides a thermodynamic graph for memory. Nodes gain heat on use and decay over time. 

## Day 2: The Tech (Depth)
**Channel:** X/Twitter + Reddit (r/LocalLLaMA)
- **Technical Highlight:** Zero-copy shared memory via `rkyv` and `mmap`. 
- **The Core:** Rust-based CRDTs for multi-device sync. No more conflicting chat histories.
- **WASM:** The same core running in your browser, managing memory for Claude.ai and ChatGPT without a server.

## Day 3: The Launch (CTA)
**Channel:** X/Twitter + LinkedIn + HN
- **HN (Show HN):** "SULCUS: A Virtual Memory Management Unit for AI Agents"
- **LinkedIn:** Enterprise-focused post on "The ROI of Agentic Memory." Focus on token savings and agent reliability.
- **Main Call to Action:** "Get early access at sulcus.io" (link to our new Next.js site).

## Post-Launch
- **Engagement:** Reply to every question about "How is this different from Pinecone?"
- **Answer:** Pinecone is a disk. SULCUS is the memory controller. We manage what goes *into* the context window, not just what's stored on the drive.
