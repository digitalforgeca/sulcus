# Sulcus Plugin for Antigravity CLI

**Author:** [Digital Forge Studios](https://sulcus.ca)  
**License:** MIT  
**Version:** 1.0.0  
**Links:** [sulcus.ca](https://sulcus.ca) · [GitHub](https://github.com/digitalforgeca/sulcus)

---

Persistent, thermodynamic memory for the **Antigravity CLI** (`agy`) - decisions, patterns, and learnings survive across sessions.

## What It Does

This plugin wires two Antigravity lifecycle hooks into Sulcus:

- **PreInvocation (`recall.js`)**: Automatically queries the Sulcus server with your current prompt before model execution and injects relevant historical memories as an ephemeral context block.
- **Stop (`capture.js`)**: Captures significant decisions, user preferences, and learnings from your response at the end of the execution turn.

---

## Setup

### 1. Set environment variables

```bash
export SULCUS_API_KEY="your-api-key"
export SULCUS_SERVER_URL="https://api.sulcus.ca"  # optional, this is the default
export SULCUS_NAMESPACE="your-namespace"           # optional, defaults to 'default'
```

Get your API key at [sulcus.ca](https://sulcus.ca).

### 2. Install the plugin

```bash
# Install the plugin in Antigravity CLI using the local path
agy plugin install /path/to/sulcus/plugins/antigravity-cli-sulcus
```

---

## License

MIT — [Digital Forge Studios Inc.](https://dforge.ca)
