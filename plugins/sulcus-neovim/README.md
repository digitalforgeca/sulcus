# Sulcus Neovim Plugin (`v1.2.0`)

[![Version](https://img.shields.io/badge/version-1.2.0-blue.svg)](https://github.com/digitalforgeca/sulcus/releases)
[![License](https://img.shields.io/badge/license-Apache--2.0-emerald.svg)](../../LICENSE)
[![Platform](https://img.shields.io/badge/platform-Neovim-cyan.svg)](https://neovim.io)
[![Runtime](https://img.shields.io/badge/runtime-LuaJIT-orange.svg)](https://luajit.org)
[![Engine](https://img.shields.io/badge/engine-Semantic%20VMMU-cyan.svg)](https://sulcus.ca)

Persistent thermodynamic memory and Activity Ledger undo plugin for Neovim (compatible with Avante.nvim, CodeCompanion.nvim, and MCPHub.nvim).

---

> **Prerequisite**: Local endpoint (`http://127.0.0.1:4203`) is served by the single-binary `sulcus` workstation daemon (`sulcus serve`), configured via `sulcus init` / `sulcus login` (`~/.config/sulcus/sulcus.ini`).

## Commands (`require("sulcus").setup()`)

| Command | Execution Objective |
| --- | --- |
| `:SulcusRecall [query]` | Query `/api/v1/agent/search` for thermodynamic memories |
| `:SulcusIngest <summary>` | Distill notes or assistant output through `/api/v1/agent/ingest` (System 1 VCR) |
| `:SulcusUndo [n]` | Rewind `n` Activity Ledger turns (`/api/v1/agent/ledger/undo`) |
