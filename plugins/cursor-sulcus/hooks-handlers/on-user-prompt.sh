#!/usr/bin/env bash
# Sulcus Memory — UserPromptSubmit hook
# Multi-signal recall: semantic search + hot-context + entity-context.
# Injects relevant memories as additionalContext.
# Logs recall session for SIRU training data.
# Supports cloud mode (SULCUS_API_KEY) and local mode (sulcus binary).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_sulcus-lib.sh
source "${SCRIPT_DIR}/_sulcus-lib.sh"

if [ "$SULCUS_MODE" = "none" ]; then
  exit 0
fi

INPUT=$(cat)

PROMPT=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    print(data.get('prompt', ''))
except:
    print('')
" 2>/dev/null)

if [ -z "$PROMPT" ]; then
  exit 0
fi

# ---------------------------------------------------------------------------
# Cloud mode — multi-signal recall
# ---------------------------------------------------------------------------
if [ "$SULCUS_MODE" = "cloud" ]; then

  # Signal 1: Semantic search
  SEMANTIC=$(echo "$PROMPT" | python3 -c "
import json, sys
q = sys.stdin.read().strip()
print(json.dumps({'query': q, 'limit': 5}))
" 2>/dev/null | curl -sf -X POST "${SULCUS_URL}/api/v1/agent/search" \
    -H "Authorization: Bearer ${SULCUS_KEY}" \
    -H "Content-Type: application/json" \
    -d @- 2>/dev/null)

  # Signal 2: Hot context (highest-heat memories)
  HOT=$(curl -sf "${SULCUS_URL}/api/v1/agent/hot_nodes?limit=3" \
    -H "Authorization: Bearer ${SULCUS_KEY}" 2>/dev/null)

  # Signal 3: Entity context (extract entity hints from prompt)
  ENTITY_HINTS=$(echo "$PROMPT" | python3 -c "
import sys, re
text = sys.stdin.read().strip()
# Simple entity extraction: capitalized words, quoted terms, technical terms
caps = re.findall(r'\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b', text)
quoted = re.findall(r'[\"'\''](.*?)[\"'\'']\`', text)
hints = list(set(caps + quoted))[:5]
import json
print(json.dumps(hints))
" 2>/dev/null)

  ENTITY=""
  if [ -n "$ENTITY_HINTS" ] && [ "$ENTITY_HINTS" != "[]" ]; then
    ENTITY=$(echo "$ENTITY_HINTS" | python3 -c "
import json, sys
hints = json.load(sys.stdin)
print(json.dumps({'entity_names': hints, 'limit': 3}))
" 2>/dev/null | curl -sf -X POST "${SULCUS_URL}/api/v1/agent/entity-context" \
      -H "Authorization: Bearer ${SULCUS_KEY}" \
      -H "Content-Type: application/json" \
      -d @- 2>/dev/null)
  fi

  # Merge all signals into a single context block
  MEMORY_BLOCK=$(python3 -c "
import json, sys

semantic_raw = '''${SEMANTIC}'''
hot_raw = '''${HOT}'''
entity_raw = '''${ENTITY}'''

parts = []
seen_ids = set()
candidates = 0
selected = 0
semantic_count = 0
hot_count = 0
entity_count = 0

def add_nodes(raw, source, fallback_heat=0.3):
    global candidates, selected, semantic_count, hot_count, entity_count
    if not raw:
        return
    try:
        data = json.loads(raw)
        nodes = data.get('results', data.get('nodes', data.get('hot_nodes', [])))
        if isinstance(data, list):
            nodes = data
        for n in nodes:
            nid = n.get('id', '')
            if nid in seen_ids:
                continue
            seen_ids.add(nid)
            candidates += 1
            content = n.get('pointer_summary', n.get('content', n.get('label', '')))
            mtype = n.get('memory_type', 'unknown')
            heat = n.get('current_heat', n.get('heat', fallback_heat))
            if content:
                band = 'high' if heat > 0.7 else 'mid' if heat > 0.3 else 'low'
                parts.append(f'- [{band}] {content[:300]}')
                selected += 1
                if source == 'semantic': semantic_count += 1
                elif source == 'hot': hot_count += 1
                elif source == 'entity': entity_count += 1
    except:
        pass

# Process entities — they have a nested structure
def add_entity_nodes(raw):
    global candidates, selected, entity_count
    if not raw:
        return
    try:
        data = json.loads(raw)
        for entity in data.get('entities', []):
            for n in entity.get('related_memories', []):
                nid = n.get('id', '')
                if nid in seen_ids:
                    continue
                seen_ids.add(nid)
                candidates += 1
                content = n.get('pointer_summary', n.get('content', n.get('label', '')))
                if content:
                    parts.append(f'- [mid] {content[:300]}')
                    selected += 1
                    entity_count += 1
    except:
        pass

add_nodes(semantic_raw, 'semantic')
add_nodes(hot_raw, 'hot', 0.5)
add_entity_nodes(entity_raw)

if parts:
    print('\n'.join(parts[:10]))
else:
    print('')
" 2>/dev/null)

  # Fire-and-forget: log recall session for SIRU training
  if [ -n "$MEMORY_BLOCK" ]; then
    echo "$PROMPT" | python3 -c "
import json, sys
q = sys.stdin.read().strip()
print(json.dumps({
    'query_text': q,
    'memory_ids': [],
    'memory_scores': [],
    'memory_sources': [],
    'token_budget': 2000,
    'tokens_used': len(q) // 4,
    'candidates_total': 0,
    'candidates_selected': 0,
    'semantic_count': 0,
    'hot_count': 0,
    'entity_count': 0,
    'entity_hints': []
}))
" 2>/dev/null | curl -sf -X POST "${SULCUS_URL}/api/v1/agent/recall-log" \
      -H "Authorization: Bearer ${SULCUS_KEY}" \
      -H "Content-Type: application/json" \
      -d @- > /dev/null 2>&1 &
  fi
fi

# ---------------------------------------------------------------------------
# Local mode — semantic search only (hot-context/entity not available locally)
# ---------------------------------------------------------------------------
if [ "$SULCUS_MODE" = "local" ]; then
  SEARCH_ARGS=$(echo "$PROMPT" | python3 -c "
import sys, json
q = sys.stdin.read().strip()
print(json.dumps({'query': q, 'limit': 5}))
" 2>/dev/null)

  RAW=$(sulcus_local_call "search_memory" "$SEARCH_ARGS")
  MEMORY_BLOCK="$RAW"
fi

if [ -z "$MEMORY_BLOCK" ]; then
  exit 0
fi

ESCAPED=$(printf '%s' "$MEMORY_BLOCK" | python3 -c "
import sys, json
text = sys.stdin.read().rstrip()
print(json.dumps(text)[1:-1])
" 2>/dev/null)

cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "## Sulcus — Relevant Memories\\n\\n${ESCAPED}"
  }
}
EOF

exit 0
