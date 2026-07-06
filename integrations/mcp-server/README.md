# sulcus-mcp (Deprecated)

> **⚠️ This crate has been superseded by the unified `sulcus` CLI binary.**
>
> All MCP server functionality is now part of the `sulcus` crate at [`crates/sulcus/`](../../crates/sulcus/).

## Migration

The `sulcus-mcp` binary is replaced by `sulcus mcp stdio` and `sulcus mcp http`:

```bash
# Old
sulcus-mcp
sulcus-mcp --http --port 3100

# New
sulcus mcp stdio
sulcus mcp http --port 3100
```

### Install the unified binary

```bash
# From crates.io
cargo install sulcus

# Or via npm (downloads prebuilt binary)
npm install -g @digitalforgestudios/sulcus

# Or from source
git clone https://github.com/digitalforgeca/sulcus
cd sulcus && cargo build --release -p sulcus
```

### Update your MCP config

Claude Desktop / Cursor:
```json
{
  "mcpServers": {
    "sulcus": {
      "command": "sulcus",
      "args": ["mcp", "stdio"],
      "env": {
        "SULCUS_API_KEY": "sk-your-api-key-here"
      }
    }
  }
}
```

VS Code:
```json
{
  "mcp": {
    "servers": {
      "sulcus": {
        "type": "stdio",
        "command": "sulcus",
        "args": ["mcp", "stdio"],
        "env": {
          "SULCUS_API_KEY": "sk-your-api-key-here"
        }
      }
    }
  }
}
```

### What you gain

The unified `sulcus` binary includes everything `sulcus-mcp` did, plus:

- `sulcus status` — connection and memory stats
- `sulcus search <query>` — CLI search
- `sulcus remember <text>` — CLI store
- `sulcus import <file>` — markdown import
- `sulcus export` — markdown export

One binary, everything integral.

## This crate will not receive further updates.

For documentation, see the [main README](../../README.md).

## License

MIT — [Digital Forge Studios](https://dforge.ca)
