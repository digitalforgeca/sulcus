use anyhow::Result;

use crate::McpTransport;

pub async fn run(transport: McpTransport) -> Result<()> {
    match transport {
        McpTransport::Stdio => {
            eprintln!("sulcus mcp stdio — not yet wired (Task 2.2)");
            Ok(())
        }
        McpTransport::Http { host, port } => {
            eprintln!(
                "sulcus mcp http — not yet wired (Task 2.2) [would bind {}:{}]",
                host, port
            );
            Ok(())
        }
    }
}
