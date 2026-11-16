# Sulcus Aider Plugin

[![Version](https://img.shields.io/badge/version-1.2.0-blue.svg)](https://github.com/digitalforgeca/sulcus/releases)
[![License](https://img.shields.io/badge/license-MIT-emerald.svg)](../../LICENSE)
[![Platform](https://img.shields.io/badge/platform-Aider%20CLI-cyan.svg)](https://aider.chat)
[![Runtime](https://img.shields.io/badge/runtime-Rust%20Single--Binary-orange.svg)](https://sulcus.ca)
[![Engine](https://img.shields.io/badge/engine-Semantic%20VMMU-cyan.svg)](https://sulcus.ca)

Persistent thermodynamic memory knowledge graph, System 1 (`VCR`) ingestion, and Synapse pre-execution recall wrapper for Aider CLI.

---

## Integration Architecture

Aider CLI does not expose background lifecycle hooks; `sulcus-aider` integrates via:
1. **`scripts/aider-sulcus.sh` Wrapper**: Queries `sulcus hook --harness aider recall` at launch and passes `.aider.sulcus-context.md` via `aider --read`.
2. **`CONVENTIONS.md` (`/run` Commands)**: Teaches Aider to recall memories (`sulcus hook --harness aider recall`) and capture decisions (`sulcus hook --harness aider ingest`).
