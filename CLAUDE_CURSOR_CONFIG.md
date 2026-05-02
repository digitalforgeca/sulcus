# 1-Click Integration: Claude Desktop & Cursor

Sulcus is a standard MCP (Model Context Protocol) server. You can add infinite memory to your favorite tools in seconds.

## 1. Claude Desktop

1.  Open your Claude Desktop configuration file:
    *   **MacOS**: `~/Library/Application\ Support/Claude/claude_desktop_config.json`
    *   **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
2.  Add Sulcus to the `mcpServers` list:

```json
{
  "mcpServers": {
    "sulcus": {
      "command": "/Users/dv00003-00/dev/sulcus/target/release/sulcus",
      "args": ["stdio"]
    }
  }
}
```
*(Replace the path with your actual install location)*

3.  Restart Claude Desktop. You will see a 🔌 icon indicating Sulcus is active.

---

## 2. Cursor IDE / Cline / Windsurf

1.  Open **Settings** > **Features** > **MCP Servers**.
2.  Click **+ Add New MCP Server**.
3.  Fill in the details:
    *   **Name**: `sulcus`
    *   **Type**: `command`
    *   **Command**: `/Users/dv00003-00/dev/sulcus/target/release/sulcus`
    *   **Args**: `stdio`
4.  Click **Save**. Cursor now has access to your long-term memory graph.

---

## 3. Hosted Sulcus (Pro/Enterprise)

If you are using the hosted **Sulcus Cloud**, use the SSE connection type:

*   **Type**: `sse`
*   **URL**: `https://api.sulcus.dev/api/v1/mcp/sse`
*   **Headers**: 
    *   `Authorization`: `Bearer YOUR_API_KEY`

---

### Why use Sulcus instead of default history?
Standard history is expensive and eventually "forgets" the beginning of your chat. Sulcus uses **Thermodynamic Heat** to ensure the most important context is always paged into your prompt, no matter how long your session lasts.
