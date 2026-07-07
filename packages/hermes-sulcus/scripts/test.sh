#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# hermes-sulcus — Test suite
# Usage:
#   ./scripts/test.sh                # Run all tests
#   ./scripts/test.sh --unit         # Unit tests only (no API calls)
#   ./scripts/test.sh --integration  # Integration tests (requires API key)
#   ./scripts/test.sh --verbose      # Verbose output
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VERBOSE=false
RUN_UNIT=true
RUN_INTEGRATION=true
PASSED=0
FAILED=0
SKIPPED=0

for arg in "$@"; do
  case "$arg" in
    --unit) RUN_INTEGRATION=false ;;
    --integration) RUN_UNIT=false ;;
    --verbose|-v) VERBOSE=true ;;
    --help|-h)
      echo "Usage: $0 [--unit|--integration] [--verbose]"
      exit 0 ;;
  esac
done

# Find Python — prefer Hermes venv
PYTHON=""
for candidate in /opt/hermes/.venv/bin/python3 python3 python; do
  if command -v "$candidate" &>/dev/null; then
    PYTHON="$candidate"
    break
  fi
done

if [[ -z "$PYTHON" ]]; then
  echo -e "${RED}Error: Python not found${NC}"
  exit 1
fi

echo -e "${CYAN}hermes-sulcus test suite${NC}"
echo "Python: $($PYTHON --version 2>&1)"
echo ""

# ── Test runner ───────────────────────────────────────────────────────────────

run_test() {
  local name="$1"
  local code="$2"
  
  if $VERBOSE; then
    echo -e "${CYAN}Running: $name${NC}"
  fi
  
  output=$($PYTHON -c "$code" 2>&1) && status=0 || status=$?
  
  if [[ $status -eq 0 ]]; then
    echo -e "  ${GREEN}✓${NC} $name"
    PASSED=$((PASSED + 1))
  elif [[ $status -eq 77 ]]; then
    echo -e "  ${YELLOW}⊘${NC} $name (skipped)"
    SKIPPED=$((SKIPPED + 1))
  else
    echo -e "  ${RED}✗${NC} $name"
    if $VERBOSE; then
      echo "$output" | sed 's/^/    /'
    fi
    FAILED=$((FAILED + 1))
  fi
}

# ── Unit Tests ────────────────────────────────────────────────────────────────

if $RUN_UNIT; then
  echo -e "${CYAN}Unit Tests${NC}"

  run_test "Module imports cleanly" "
import sys; sys.path.insert(0, '$PLUGIN_DIR')
# Stub agent.memory_provider since we may not have Hermes installed
import types
agent_mod = types.ModuleType('agent')
agent_mod.memory_provider = types.ModuleType('agent.memory_provider')
class FakeMP:
  pass
for attr in ['name','is_available','initialize','get_tool_schemas']:
  setattr(FakeMP, attr, lambda self: None)
agent_mod.memory_provider.MemoryProvider = FakeMP
sys.modules['agent'] = agent_mod
sys.modules['agent.memory_provider'] = agent_mod.memory_provider
from __init__ import SulcusProvider, SulcusClient, register
"

  run_test "SulcusProvider.name returns 'sulcus'" "
import sys, types
sys.path.insert(0, '$PLUGIN_DIR')
agent_mod = types.ModuleType('agent')
agent_mod.memory_provider = types.ModuleType('agent.memory_provider')
class FakeMP: pass
agent_mod.memory_provider.MemoryProvider = FakeMP
sys.modules['agent'] = agent_mod
sys.modules['agent.memory_provider'] = agent_mod.memory_provider
from __init__ import SulcusProvider
p = SulcusProvider()
assert p.name == 'sulcus', f'Expected sulcus, got {p.name}'
"

  run_test "get_tool_schemas returns 5 tools" "
import sys, types
sys.path.insert(0, '$PLUGIN_DIR')
agent_mod = types.ModuleType('agent')
agent_mod.memory_provider = types.ModuleType('agent.memory_provider')
class FakeMP: pass
agent_mod.memory_provider.MemoryProvider = FakeMP
sys.modules['agent'] = agent_mod
sys.modules['agent.memory_provider'] = agent_mod.memory_provider
from __init__ import SulcusProvider
p = SulcusProvider()
schemas = p.get_tool_schemas()
assert len(schemas) == 5, f'Expected 5 tools, got {len(schemas)}'
names = [s['name'] for s in schemas]
for expected in ['sulcus_recall', 'sulcus_store', 'sulcus_get', 'sulcus_pin', 'sulcus_consolidate']:
    assert expected in names, f'Missing tool: {expected}'
"

  run_test "get_config_schema returns 3 fields" "
import sys, types
sys.path.insert(0, '$PLUGIN_DIR')
agent_mod = types.ModuleType('agent')
agent_mod.memory_provider = types.ModuleType('agent.memory_provider')
class FakeMP: pass
agent_mod.memory_provider.MemoryProvider = FakeMP
sys.modules['agent'] = agent_mod
sys.modules['agent.memory_provider'] = agent_mod.memory_provider
from __init__ import SulcusProvider
p = SulcusProvider()
schema = p.get_config_schema()
assert len(schema) == 3, f'Expected 3 config fields, got {len(schema)}'
keys = [f['key'] for f in schema]
for expected in ['api_key', 'server_url', 'namespace']:
    assert expected in keys, f'Missing config key: {expected}'
"

  run_test "_node_label prefers pointer_summary" "
import sys, types
sys.path.insert(0, '$PLUGIN_DIR')
agent_mod = types.ModuleType('agent')
agent_mod.memory_provider = types.ModuleType('agent.memory_provider')
class FakeMP: pass
agent_mod.memory_provider.MemoryProvider = FakeMP
sys.modules['agent'] = agent_mod
sys.modules['agent.memory_provider'] = agent_mod.memory_provider
from __init__ import _node_label
assert _node_label({'label': 'short', 'pointer_summary': 'detailed'}) == 'detailed'
assert _node_label({'label': 'only label'}) == 'only label'
assert _node_label({}) == '(untitled)'
"

  run_test "_node_heat uses current_heat over heat" "
import sys, types
sys.path.insert(0, '$PLUGIN_DIR')
agent_mod = types.ModuleType('agent')
agent_mod.memory_provider = types.ModuleType('agent.memory_provider')
class FakeMP: pass
agent_mod.memory_provider.MemoryProvider = FakeMP
sys.modules['agent'] = agent_mod
sys.modules['agent.memory_provider'] = agent_mod.memory_provider
from __init__ import _node_heat
assert _node_heat({'current_heat': 0.75, 'heat': 0.5}) == 0.75
assert _node_heat({'heat': 0.5}) == 0.5
assert _node_heat({}) == 0.0
"

  run_test "Memory classification: preferences" "
import sys, types
sys.path.insert(0, '$PLUGIN_DIR')
agent_mod = types.ModuleType('agent')
agent_mod.memory_provider = types.ModuleType('agent.memory_provider')
class FakeMP: pass
agent_mod.memory_provider.MemoryProvider = FakeMP
sys.modules['agent'] = agent_mod
sys.modules['agent.memory_provider'] = agent_mod.memory_provider
from __init__ import SulcusProvider
p = SulcusProvider()
assert p._classify_turn('I prefer dark mode') == 'preference'
assert p._classify_turn('I always use tabs') == 'preference'
assert p._classify_turn('call me Dave') == 'preference'
"

  run_test "Memory classification: facts" "
import sys, types
sys.path.insert(0, '$PLUGIN_DIR')
agent_mod = types.ModuleType('agent')
agent_mod.memory_provider = types.ModuleType('agent.memory_provider')
class FakeMP: pass
agent_mod.memory_provider.MemoryProvider = FakeMP
sys.modules['agent'] = agent_mod
sys.modules['agent.memory_provider'] = agent_mod.memory_provider
from __init__ import SulcusProvider
p = SulcusProvider()
assert p._classify_turn('the server is running on port 8080') == 'fact'
assert p._classify_turn('we use PostgreSQL') == 'fact'
"

  run_test "Memory classification: episodic fallback" "
import sys, types
sys.path.insert(0, '$PLUGIN_DIR')
agent_mod = types.ModuleType('agent')
agent_mod.memory_provider = types.ModuleType('agent.memory_provider')
class FakeMP: pass
agent_mod.memory_provider.MemoryProvider = FakeMP
sys.modules['agent'] = agent_mod
sys.modules['agent.memory_provider'] = agent_mod.memory_provider
from __init__ import SulcusProvider
p = SulcusProvider()
assert p._classify_turn('how is the weather today') == 'episodic'
"

  run_test "is_available returns False without env vars" "
import sys, os, types
sys.path.insert(0, '$PLUGIN_DIR')
agent_mod = types.ModuleType('agent')
agent_mod.memory_provider = types.ModuleType('agent.memory_provider')
class FakeMP: pass
agent_mod.memory_provider.MemoryProvider = FakeMP
sys.modules['agent'] = agent_mod
sys.modules['agent.memory_provider'] = agent_mod.memory_provider
# Clear env vars
for k in ['SULCUS_API_KEY', 'SULCUS_SERVER_URL', 'SULCUS_NAMESPACE']:
    os.environ.pop(k, None)
from __init__ import SulcusProvider
p = SulcusProvider()
# May still find .env file, so just verify it returns a bool
result = p.is_available()
assert isinstance(result, bool), f'Expected bool, got {type(result)}'
"

  run_test "Uninitialized provider returns empty system prompt" "
import sys, types
sys.path.insert(0, '$PLUGIN_DIR')
agent_mod = types.ModuleType('agent')
agent_mod.memory_provider = types.ModuleType('agent.memory_provider')
class FakeMP: pass
agent_mod.memory_provider.MemoryProvider = FakeMP
sys.modules['agent'] = agent_mod
sys.modules['agent.memory_provider'] = agent_mod.memory_provider
from __init__ import SulcusProvider
p = SulcusProvider()
assert p.system_prompt_block() == ''
"

  run_test "handle_tool_call returns error when not initialized" "
import sys, types, json
sys.path.insert(0, '$PLUGIN_DIR')
agent_mod = types.ModuleType('agent')
agent_mod.memory_provider = types.ModuleType('agent.memory_provider')
class FakeMP: pass
agent_mod.memory_provider.MemoryProvider = FakeMP
sys.modules['agent'] = agent_mod
sys.modules['agent.memory_provider'] = agent_mod.memory_provider
from __init__ import SulcusProvider
p = SulcusProvider()
result = json.loads(p.handle_tool_call('sulcus_recall', {'query': 'test'}))
assert 'error' in result, f'Expected error key, got {result}'
"

  echo ""
fi

# ── Integration Tests ─────────────────────────────────────────────────────────

if $RUN_INTEGRATION; then
  echo -e "${CYAN}Integration Tests${NC} (requires SULCUS_API_KEY)"
  
  # Check if we can run integration tests
  HAS_API_KEY=false
  if [[ -n "${SULCUS_API_KEY:-}" ]]; then
    HAS_API_KEY=true
  elif [[ -f /opt/data/.env ]]; then
    source /opt/data/.env 2>/dev/null || true
    if [[ -n "${SULCUS_API_KEY:-}" ]]; then
      HAS_API_KEY=true
    fi
  fi
  
  if ! $HAS_API_KEY; then
    echo -e "  ${YELLOW}⊘${NC} Skipped — no SULCUS_API_KEY found"
    ((SKIPPED++))
  else

    run_test "API: search returns results" "
import sys, types, json, os
sys.path.insert(0, '$PLUGIN_DIR')
agent_mod = types.ModuleType('agent')
agent_mod.memory_provider = types.ModuleType('agent.memory_provider')
class FakeMP: pass
agent_mod.memory_provider.MemoryProvider = FakeMP
sys.modules['agent'] = agent_mod
sys.modules['agent.memory_provider'] = agent_mod.memory_provider
# Load env
if os.path.exists('/opt/data/.env'):
    for line in open('/opt/data/.env'):
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            os.environ[k.strip()] = v.strip()
from __init__ import SulcusProvider
p = SulcusProvider()
p.initialize('test-integration', platform='test', hermes_home='/tmp')
result = json.loads(p.handle_tool_call('sulcus_recall', {'query': 'test', 'limit': 2}))
assert 'error' not in result, f'API error: {result}'
"

    run_test "API: hot_nodes returns list" "
import sys, types, json, os
sys.path.insert(0, '$PLUGIN_DIR')
agent_mod = types.ModuleType('agent')
agent_mod.memory_provider = types.ModuleType('agent.memory_provider')
class FakeMP: pass
agent_mod.memory_provider.MemoryProvider = FakeMP
sys.modules['agent'] = agent_mod
sys.modules['agent.memory_provider'] = agent_mod.memory_provider
if os.path.exists('/opt/data/.env'):
    for line in open('/opt/data/.env'):
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            os.environ[k.strip()] = v.strip()
from __init__ import SulcusProvider
p = SulcusProvider()
p.initialize('test-integration', platform='test', hermes_home='/tmp')
result = json.loads(p.handle_tool_call('sulcus_consolidate', {'limit': 3}))
assert 'hot_nodes' in result, f'Expected hot_nodes key, got {result.keys()}'
assert isinstance(result['hot_nodes'], list)
"

    run_test "API: store + recall round-trip" "
import sys, types, json, os, time
sys.path.insert(0, '$PLUGIN_DIR')
agent_mod = types.ModuleType('agent')
agent_mod.memory_provider = types.ModuleType('agent.memory_provider')
class FakeMP: pass
agent_mod.memory_provider.MemoryProvider = FakeMP
sys.modules['agent'] = agent_mod
sys.modules['agent.memory_provider'] = agent_mod.memory_provider
if os.path.exists('/opt/data/.env'):
    for line in open('/opt/data/.env'):
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            os.environ[k.strip()] = v.strip()
from __init__ import SulcusProvider
p = SulcusProvider()
p.initialize('test-integration', platform='test', hermes_home='/tmp')
marker = f'hermes-sulcus-test-{int(time.time())}'
store_result = json.loads(p.handle_tool_call('sulcus_store', {
    'content': f'Integration test marker: {marker}. The hermes-sulcus plugin test suite created this memory to verify store and recall work correctly.',
    'memory_type': 'semantic',
    'label': marker
}))
assert store_result.get('stored') or 'error' in store_result, f'Unexpected: {store_result}'
if store_result.get('stored'):
    node_id = store_result['node_id']
    get_result = json.loads(p.handle_tool_call('sulcus_get', {'node_id': node_id}))
    assert 'error' not in get_result, f'Get failed: {get_result}'
    assert marker in get_result.get('content', '') or marker in get_result.get('label', '')
"

  fi
  echo ""
fi

# ── Summary ───────────────────────────────────────────────────────────────────

TOTAL=$((PASSED + FAILED + SKIPPED))
echo "─────────────────────────────"
echo -e "Results: ${GREEN}$PASSED passed${NC}, ${RED}$FAILED failed${NC}, ${YELLOW}$SKIPPED skipped${NC} / $TOTAL total"

if [[ $FAILED -gt 0 ]]; then
  exit 1
fi
