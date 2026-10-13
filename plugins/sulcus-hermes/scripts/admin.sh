#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# hermes-sulcus — Admin CLI
# Usage:
#   ./scripts/admin.sh stats              # Memory stats
#   ./scripts/admin.sh search "query"     # Search memories
#   ./scripts/admin.sh hot [limit]         # Hot nodes
#   ./scripts/admin.sh get <node_id>       # Get node by ID
#   ./scripts/admin.sh store "content"     # Store a memory
#   ./scripts/admin.sh export [file]       # Export all memories to JSON
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

# Load env
if [[ -f /opt/data/.env ]]; then
  source /opt/data/.env 2>/dev/null || true
elif [[ -f ~/.hermes/.env ]]; then
  source ~/.hermes/.env 2>/dev/null || true
fi

API_URL="${SULCUS_SERVER_URL:-https://api.sulcus.ca}"
API_KEY="${SULCUS_API_KEY:-}"
NAMESPACE="${SULCUS_NAMESPACE:-}"

if [[ -z "$API_KEY" || -z "$NAMESPACE" ]]; then
  echo -e "${RED}Error: SULCUS_API_KEY and SULCUS_NAMESPACE must be set${NC}"
  exit 1
fi

api_get() {
  curl -s -H "Authorization: Bearer $API_KEY" -H "X-Namespace: $NAMESPACE"     "${API_URL}$1" --connect-timeout 5 --max-time 15
}

api_post() {
  curl -s -H "Authorization: Bearer $API_KEY" -H "X-Namespace: $NAMESPACE"     -H "Content-Type: application/json" -d "$2"     "${API_URL}$1" --connect-timeout 5 --max-time 15
}

CMD="${1:-help}"
shift 2>/dev/null || true

case "$CMD" in
  stats)
    echo -e "${CYAN}Memory Stats${NC}"
    NODES=$(api_get "/api/v1/agent/hot_nodes?namespace=${NAMESPACE}&limit=200")
    python3 -c "
import json, sys
nodes = json.loads(sys.stdin.read())
if not isinstance(nodes, list): nodes = nodes.get('nodes', [])
total = len(nodes)
types = {}
pinned = 0
avg_heat = 0
for n in nodes:
    t = n.get('memory_type', 'unknown')
    types[t] = types.get(t, 0) + 1
    if n.get('is_pinned'): pinned += 1
    avg_heat += n.get('current_heat', n.get('heat', 0))
avg_heat = avg_heat / total if total else 0
print(f'  Total nodes:    {total}')
print(f'  Pinned:         {pinned}')
print(f'  Avg heat:       {avg_heat:.3f}')
print(f'  By type:')
for t, c in sorted(types.items(), key=lambda x: -x[1]):
    print(f'    {t}: {c}')
" <<< "$NODES"
    ;;

  search)
    QUERY="${1:?Usage: admin.sh search \"query\"}"
    LIMIT="${2:-10}"
    BODY=$(python3 -c "import json,sys; print(json.dumps({'query':sys.argv[1],'limit':int(sys.argv[2]),'namespace':sys.argv[3]}))" "$QUERY" "$LIMIT" "$NAMESPACE")
    RESULT=$(api_post "/api/v1/agent/search" "$BODY")
    python3 -c "
import json, sys
data = json.loads(sys.stdin.read())
nodes = data if isinstance(data, list) else data.get('results', data.get('nodes', []))
if not nodes:
    print('  No results')
else:
    for n in nodes:
        nid = n.get('node_id', n.get('id', '?'))[:12]
        label = n.get('pointer_summary', n.get('label', '?'))[:80]
        heat = n.get('current_heat', n.get('heat', 0))
        mtype = n.get('memory_type', '?')
        print(f'  [{nid}] ({mtype}, heat:{heat:.2f}) {label}')
" <<< "$RESULT"
    ;;

  hot)
    LIMIT="${1:-20}"
    RESULT=$(api_get "/api/v1/agent/hot_nodes?namespace=${NAMESPACE}&limit=${LIMIT}")
    python3 -c "
import json, sys
nodes = json.loads(sys.stdin.read())
if not isinstance(nodes, list): nodes = nodes.get('nodes', [])
if not nodes:
    print('  No hot nodes')
else:
    for n in nodes:
        nid = n.get('id', n.get('node_id', '?'))[:12]
        label = n.get('pointer_summary', n.get('label', '?'))[:60]
        heat = n.get('current_heat', n.get('heat', 0))
        mtype = n.get('memory_type', '?')
        pin = ' 📌' if n.get('is_pinned') else ''
        print(f'  [{nid}] heat:{heat:.3f} ({mtype}{pin}) {label}')
" <<< "$RESULT"
    ;;

  get)
    NODE_ID="${1:?Usage: admin.sh get <node_id>}"
    RESULT=$(api_get "/api/v1/agent/nodes/$NODE_ID")
    python3 -c "
import json, sys
n = json.loads(sys.stdin.read())
if 'error' in n:
    print(f'  Error: {n["error"]}')
else:
    print(json.dumps(n, indent=2))
" <<< "$RESULT"
    ;;

  store)
    CONTENT="${1:?Usage: admin.sh store \"content\" [type]}"
    MTYPE="${2:-semantic}"
    BODY=$(python3 -c "import json,sys; print(json.dumps({'label':sys.argv[1][:100],'pointer_summary':sys.argv[1],'namespace':sys.argv[2],'memory_type':sys.argv[3]}))" "$CONTENT" "$NAMESPACE" "$MTYPE")
    RESULT=$(api_post "/api/v1/agent/nodes" "$BODY")
    python3 -c "
import json, sys
r = json.loads(sys.stdin.read())
if r.get('status') == 'rejected':
    print(f'  Rejected: {r.get("reason", "quality gate")}')
elif 'node_id' in r or 'id' in r:
    nid = r.get('node_id', r.get('id', '?'))
    print(f'  ✓ Stored: {nid}')
else:
    print(f'  Response: {json.dumps(r)}')
" <<< "$RESULT"
    ;;

  export)
    OUTFILE="${1:-hermes-sulcus-export.json}"
    echo -e "${CYAN}Exporting all memories to $OUTFILE...${NC}"
    RESULT=$(api_get "/api/v1/agent/hot_nodes?namespace=${NAMESPACE}&limit=500")
    python3 -c "
import json, sys
nodes = json.loads(sys.stdin.read())
if not isinstance(nodes, list): nodes = nodes.get('nodes', [])
with open('$OUTFILE', 'w') as f:
    json.dump({'namespace': '$NAMESPACE', 'count': len(nodes), 'nodes': nodes}, f, indent=2)
print(f'  ✓ Exported {len(nodes)} nodes to $OUTFILE')
" <<< "$RESULT"
    ;;

  help|--help|-h)
    echo "Usage: $0 <command> [args]"
    echo ""
    echo "Commands:"
    echo "  stats              Memory statistics"
    echo "  search "query"     Search memories"
    echo "  hot [limit]        Show hottest nodes"
    echo "  get <node_id>      Get node details"
    echo "  store "text" [type] Store a memory (type: semantic|episodic|preference|procedural)"
    echo "  export [file]      Export all memories to JSON"
    ;;

  *)
    echo -e "${RED}Unknown command: $CMD${NC}"
    echo "Run '$0 help' for usage"
    exit 1
    ;;
esac
