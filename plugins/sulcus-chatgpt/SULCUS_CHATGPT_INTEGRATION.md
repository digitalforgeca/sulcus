# ChatGPT Integration Contract

This package intentionally uses the modern MCP/App integration rather than the legacy
`ai-plugin.json` OpenAPI plugin format.

## Remote Server

`https://api.sulcus.ca/mcp`

## Required Tools

- `search_memories`
- `store_memory`
- `get_memory`
- `update_memory`
- `delete_memory`
- `list_hot_memories`
- `get_user_profile`
- `list_namespaces`

## Structured Settings

The SULCUS MCP server must advertise:

`capabilities.extensions["openai/settings"]`

with:

- `readTool: "settings.read"`
- `updateTool: "settings.update"`

`settings.read` must return a native settings schema containing an `api_key` string
property and its current effective value.

`settings.update` receives:

```json
{"set":{"api_key":"..."}}
```

and must persist the key for the current plugin user.

## Architecture Rationale

The plugin package can declare the MCP server and onboarding skill, but the native
ChatGPT settings field is rendered from the MCP server's Structured Settings
capability. The server therefore owns the secure credential persistence and must
never return the secret in ordinary model-visible tool output.

## Context Lifecycle

The MCP App/server should use OpenAI's model-context lifecycle extension when an app
view needs to attach or update user-visible/model-visible context. Memory retrieval
itself remains ordinary MCP tool usage unless the SULCUS server exposes an MCP App
view that needs to push selected context into the conversation.
