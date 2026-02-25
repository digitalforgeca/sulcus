OpenClaw → Sulcus MCP integration example

## Purpose

Install `openclaw` locally and run an end-to-end MCP validation against `sulcus-local stdio`. This example demonstrates how an OpenClaw-installed environment can be used to validate the MCP contract.

## Usage

1. Install dependencies (this will install `openclaw` locally):

   cd tools/openclaw-integration
   npm install

2. Run the example test (Rust-backed, deterministic):

   npm test

3. Run the Node/OpenClaw harness:

   npm run test:node

4. Run the OpenClaw example (demonstrates prompt augmentation using `active_index`):

   npm run example:openclaw

The `mcp-test.mjs` harness validates `tools/list` → `tools/call(record_memory)` → `resources/read(memory://active_index)` over stdio. `openclaw-example.mjs` demonstrates prompt augmentation from active memory and persisting responses back into Sulcus.

## Notes

- The harness will build `sulcus-local` if the binary is not present at `target/debug/sulcus-local`.
- You can override which `sulcus-local` binary is used by setting `SULCUS_LOCAL_BIN`.
- This is a local/dev-only integration — you asked not to add CI coverage for this.
