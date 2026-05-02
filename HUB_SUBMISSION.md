# Sulcus — ClawHub & npm Publishing Guide

## Published Artifacts

| Artifact | Type | URL |
|---|---|---|
| **Skill** | ClawHub Skill | [clawhub.ai/devuser/openclaw-sulcus-skill](https://clawhub.ai/devuser/openclaw-sulcus-skill) |
| **Plugin** | ClawHub Code Plugin | [clawhub.ai/packages/devuser/@digitalforgestudios/openclaw-sulcus](https://clawhub.ai/packages/devuser/@digitalforgestudios/openclaw-sulcus) |
| **npm** | npm Package | [npmjs.com/package/@digitalforgestudios/openclaw-sulcus](https://www.npmjs.com/package/@digitalforgestudios/openclaw-sulcus) |
| **Source** | GitHub | [github.com/digitalforgeca/sulcus/packages/openclaw-sulcus](https://github.com/digitalforgeca/sulcus/tree/master/packages/openclaw-sulcus) |

## Publish Process

### 1. Bump version in `packages/openclaw-sulcus/package.json`

Single source of truth for version. All other version references must match.

### 2. Publish npm

```bash
cd packages/openclaw-sulcus
npm publish --access public
```

### 3. Publish ClawHub Plugin

```bash
COMMIT=$(git rev-parse HEAD)
clawhub package publish packages/openclaw-sulcus \
  --family code-plugin \
  --name "@digitalforgestudios/openclaw-sulcus" \
  --display-name "Sulcus" \
  --version <VERSION> \
  --changelog "<CHANGELOG>" \
  --source-repo "digitalforgeca/sulcus" \
  --source-commit "$COMMIT" \
  --source-path "packages/openclaw-sulcus"
```

### 4. Publish ClawHub Skill

Update SKILL.md version in `/tmp/clawhub-review/openclaw-sulcus/SKILL.md` (or wherever the staging dir is), then:

```bash
clawhub publish /path/to/skill-dir \
  --slug openclaw-sulcus-skill \
  --name "Sulcus" \
  --version <VERSION> \
  --changelog "<CHANGELOG>"
```

### 5. Commit & push

```bash
git add -A && git commit -m "release: openclaw-sulcus v<VERSION>" && git push
```

## Required package.json Fields (for ClawHub code-plugin)

```json
{
  "openclaw": {
    "extensions": ["./index.ts"],
    "compat": {
      "pluginApi": ">=1.0.0"
    },
    "build": {
      "openclawVersion": "2026.3.28"
    }
  }
}
```

## Co-existence (Skill + Plugin)

Sulcus works in two modes:

### Mode A: Plugin Active (Recommended)
The plugin handles context injection, auto-recall, auto-capture, and lifecycle hooks. Agent uses `memory_store`, `memory_recall`, `memory_status`.

### Mode B: Skill Only (MCP Direct)
The agent connects directly to sulcus or sulcus-server via MCP. Uses raw tools: `record_memory`, `search_memory`, `build_context`, `create_trigger`, etc.

Both modes are documented in the SKILL.md.
