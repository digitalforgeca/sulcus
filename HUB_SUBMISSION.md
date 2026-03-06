# SULCUS OpenClaw Hub Submission Guide

This document outlines the process for submitting SULCUS offerings to the OpenClaw and ClawHub ecosystems.

## 1. The SULCUS Memory Skill (ClawHub)

**Slug:** `sulcus-memory`
**Path:** `skills/sulcus-memory`

### Submission Steps:
1. Ensure `clawhub` CLI is installed and authenticated:
   ```bash
   clawhub login
   ```
2. Validate the skill metadata:
   ```bash
   clawhub inspect ./skills/sulcus-memory
   ```
3. Publish to the global registry:
   ```bash
   clawhub publish ./skills/sulcus-memory
   ```

---

## 2. The SULCUS vMMU Plugin (OpenClaw Plugins)

**Name:** `@sulcus/memory-sulcus`
**Path:** `packages/openclaw-sulcus`

### Submission Steps:
1. **NPM Publication:** Since OpenClaw plugins are distributed via NPM, we must first publish the package:
   ```bash
   cd packages/openclaw-sulcus
   npm run build
   npm publish --access public
   ```
2. **Registry Registration:** Submit the NPM package name to the official OpenClaw plugin catalogue (usually via a PR to the `openclaw/plugins` repository or the developer portal at `openclaw.ai`).

---

## 3. Co-existence (Skill + Plugin)

SULCUS is designed to work in two modes:

### Mode A: Plugin Active (Recommended)
The plugin automatically manages the `sulcus-local` sidecar and handles context injection. The agent uses high-level tools like `memory_recall`.

### Mode B: Skill Only
The agent acts as a direct MCP client. It assumes `sulcus-local` is running and communicates via the standard MCP JSON-RPC protocol using tools like `search_memory`.

Both modes are supported and documented in the `SKILL.md`.
