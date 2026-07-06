//! sulcus-mcp-impl — MCP server handler for Sulcus.
//!
//! Implements the full MCP tool surface (18 tools) using `rmcp` macros.
//! Routes all tool calls through `sulcus-cloud::SulcusClient`.

mod server;

pub use server::SulcusMcp;
