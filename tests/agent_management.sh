#!/bin/bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════════
# Sulcus Agent Management Test Harness
# Tests: namespace sanitization, agent listing, merge, delete
#
# Prerequisites:
#   - Running sulcus-server (local or remote)
#   - Valid API key with admin access
#
# Usage:
#   SULCUS_URL=http://localhost:8080 SULCUS_API_KEY=your-key ./tests/agent_management.sh
#   SULCUS_URL=https://api.sulcus.ca SULCUS_API_KEY=your-key ./tests/agent_management.sh
# ═══════════════════════════════════════════════════════════════════

SULCUS_URL="${SULCUS_URL:-http://localhost:8080}"
API_KEY="${SULCUS_API_KEY:-}"
VERBOSE="${VERBOSE:-0}"

if [ -z "$API_KEY" ]; then
  echo "ERROR: SULCUS_API_KEY must be set"
  exit 1
fi

AUTH_HEADER="Authorization: Bearer $API_KEY"
CONTENT_TYPE="Content-Type: application/json"
PASS=0
FAIL=0
TOTAL=0

# Unique test namespace prefix (avoid collisions with real data)
TEST_PREFIX="test-harness-$(date +%s)"
NS_A="${TEST_PREFIX}-alpha"
NS_B="${TEST_PREFIX}-beta"
NS_UPPER="${TEST_PREFIX}-MiXeD-CaSe"
NS_SPACES="${TEST_PREFIX} with spaces"
NS_UNDERSCORES="${TEST_PREFIX}_under_scores"

# ─── Helpers ──────────────────────────────────────────────────────

log() { echo "  $*"; }
pass() { PASS=$((PASS + 1)); TOTAL=$((TOTAL + 1)); echo "  ✅ $*"; }
fail() { FAIL=$((FAIL + 1)); TOTAL=$((TOTAL + 1)); echo "  ❌ $*"; }

api() {
  local method="$1"
  local path="$2"
  shift 2
  local url="${SULCUS_URL}${path}"
  
  if [ "$VERBOSE" = "1" ]; then
    echo "    → $method $url" >&2
  fi
  
  curl -sf -X "$method" "$url" \
    -H "$AUTH_HEADER" \
    -H "$CONTENT_TYPE" \
    "$@" 2>/dev/null
}

store_memory() {
  local namespace="$1"
  local content="$2"
  local type="${3:-episodic}"
  api POST "/api/v1/agent/sync" \
    -d "{\"content\":\"$content\",\"namespace\":\"$namespace\",\"memory_type\":\"$type\",\"heat\":0.8}"
}

count_memories() {
  local namespace="$1"
  api GET "/api/v1/agent/memory/list?namespace=${namespace}&page_size=1" | \
    python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('total',d.get('count',len(d.get('memories',[])))))" 2>/dev/null || echo "0"
}

# ─── Health Check ─────────────────────────────────────────────────

echo "═══ Sulcus Agent Management Tests ═══"
echo "Server: $SULCUS_URL"
echo ""

echo "▸ Health check"
STATUS=$(api GET "/api/v1/status" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','unknown'))" 2>/dev/null || echo "unreachable")
if [ "$STATUS" = "operational" ]; then
  pass "Server healthy ($STATUS)"
else
  fail "Server unhealthy or unreachable ($STATUS)"
  echo "Cannot continue — server must be running."
  exit 1
fi

# ─── Test 1: Namespace Sanitization ───────────────────────────────

echo ""
echo "▸ Test 1: Namespace Sanitization"

# Store with mixed case — should be normalized to lowercase
store_memory "$NS_UPPER" "Test memory with mixed case namespace" "fact" > /dev/null
SANITIZED=$(echo "$NS_UPPER" | tr '[:upper:]' '[:lower:]' | sed 's/ /-/g')
COUNT=$(count_memories "$SANITIZED")
if [ "$COUNT" -ge 1 ]; then
  pass "Mixed case normalized: '$NS_UPPER' → '$SANITIZED' ($COUNT memories)"
else
  fail "Mixed case not normalized: expected memories in '$SANITIZED', found $COUNT"
fi

# Store with spaces — should become hyphens
store_memory "$NS_SPACES" "Test memory with spaces in namespace" "fact" > /dev/null
SANITIZED_SPACES=$(echo "$NS_SPACES" | tr '[:upper:]' '[:lower:]' | sed 's/ /-/g')
COUNT=$(count_memories "$SANITIZED_SPACES")
if [ "$COUNT" -ge 1 ]; then
  pass "Spaces normalized: '$NS_SPACES' → '$SANITIZED_SPACES' ($COUNT memories)"
else
  fail "Spaces not normalized: expected memories in '$SANITIZED_SPACES', found $COUNT"
fi

# Store with underscores — should become hyphens
store_memory "$NS_UNDERSCORES" "Test memory with underscores" "fact" > /dev/null
SANITIZED_UNDER=$(echo "$NS_UNDERSCORES" | tr '[:upper:]' '[:lower:]' | sed 's/_/-/g')
COUNT=$(count_memories "$SANITIZED_UNDER")
if [ "$COUNT" -ge 1 ]; then
  pass "Underscores normalized: '$NS_UNDERSCORES' → '$SANITIZED_UNDER' ($COUNT memories)"
else
  fail "Underscores not normalized: expected memories in '$SANITIZED_UNDER', found $COUNT"
fi

# ─── Test 2: Store Test Data ──────────────────────────────────────

echo ""
echo "▸ Test 2: Creating test namespaces"

for i in $(seq 1 5); do
  store_memory "$NS_A" "Alpha memory $i — test data for merge/delete" "episodic" > /dev/null
done
for i in $(seq 1 3); do
  store_memory "$NS_B" "Beta memory $i — target for merge" "semantic" > /dev/null
done

COUNT_A=$(count_memories "$NS_A")
COUNT_B=$(count_memories "$NS_B")

if [ "$COUNT_A" -ge 5 ]; then
  pass "Created $COUNT_A memories in '$NS_A'"
else
  fail "Expected ≥5 memories in '$NS_A', got $COUNT_A"
fi

if [ "$COUNT_B" -ge 3 ]; then
  pass "Created $COUNT_B memories in '$NS_B'"
else
  fail "Expected ≥3 memories in '$NS_B', got $COUNT_B"
fi

# ─── Test 3: List Agents ─────────────────────────────────────────

echo ""
echo "▸ Test 3: List agents endpoint"

AGENTS_JSON=$(api GET "/api/v1/admin/agents" || echo '{"agents":[]}')
AGENT_COUNT=$(echo "$AGENTS_JSON" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('agents',[])))" 2>/dev/null || echo "0")

if [ "$AGENT_COUNT" -ge 2 ]; then
  pass "Listed $AGENT_COUNT agent namespaces"
else
  fail "Expected ≥2 agents, got $AGENT_COUNT"
fi

# Check that our test namespaces appear with correct counts
HAS_NS_A=$(echo "$AGENTS_JSON" | python3 -c "
import sys,json
agents = json.load(sys.stdin).get('agents',[])
found = [a for a in agents if a.get('namespace') == '$NS_A']
print(found[0].get('memory_count',0) if found else 0)
" 2>/dev/null || echo "0")

if [ "$HAS_NS_A" -ge 5 ]; then
  pass "Agent list shows '$NS_A' with $HAS_NS_A memories"
else
  fail "Agent list missing '$NS_A' or wrong count (got $HAS_NS_A)"
fi

# ─── Test 4: Agent Detail ────────────────────────────────────────

echo ""
echo "▸ Test 4: Agent detail endpoint"

DETAIL=$(api GET "/api/v1/admin/agents/$NS_A" || echo '{}')
DETAIL_TOTAL=$(echo "$DETAIL" | python3 -c "import sys,json; print(json.load(sys.stdin).get('stats',{}).get('total',0))" 2>/dev/null || echo "0")

if [ "$DETAIL_TOTAL" -ge 5 ]; then
  pass "Agent detail for '$NS_A': $DETAIL_TOTAL memories"
else
  fail "Agent detail wrong count: expected ≥5, got $DETAIL_TOTAL"
fi

# ─── Test 5: Merge ────────────────────────────────────────────────

echo ""
echo "▸ Test 5: Merge '$NS_A' → '$NS_B'"

BEFORE_A=$(count_memories "$NS_A")
BEFORE_B=$(count_memories "$NS_B")
EXPECTED_AFTER=$((BEFORE_A + BEFORE_B))

MERGE_RESULT=$(api POST "/api/v1/admin/agents/merge" \
  -d "{\"source\":\"$NS_A\",\"target\":\"$NS_B\"}" || echo '{"error":"failed"}')
MOVED=$(echo "$MERGE_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('memories_moved',0))" 2>/dev/null || echo "0")

if [ "$MOVED" -ge "$BEFORE_A" ]; then
  pass "Merged $MOVED memories from '$NS_A' → '$NS_B'"
else
  fail "Merge moved $MOVED memories, expected ≥$BEFORE_A"
fi

# Verify source is empty
AFTER_A=$(count_memories "$NS_A")
if [ "$AFTER_A" = "0" ]; then
  pass "Source namespace '$NS_A' is empty after merge"
else
  fail "Source namespace still has $AFTER_A memories (expected 0)"
fi

# Verify target has all memories
AFTER_B=$(count_memories "$NS_B")
if [ "$AFTER_B" -ge "$EXPECTED_AFTER" ]; then
  pass "Target '$NS_B' has $AFTER_B memories (expected ≥$EXPECTED_AFTER)"
else
  fail "Target has $AFTER_B memories, expected ≥$EXPECTED_AFTER"
fi

# ─── Test 6: Merge self (should fail) ────────────────────────────

echo ""
echo "▸ Test 6: Merge self-reference (should fail)"

SELF_MERGE=$(curl -sf -o /dev/null -w "%{http_code}" -X POST "${SULCUS_URL}/api/v1/admin/agents/merge" \
  -H "$AUTH_HEADER" -H "$CONTENT_TYPE" \
  -d "{\"source\":\"$NS_B\",\"target\":\"$NS_B\"}" 2>/dev/null || echo "000")

if [ "$SELF_MERGE" = "400" ]; then
  pass "Self-merge correctly rejected (HTTP 400)"
else
  fail "Self-merge returned HTTP $SELF_MERGE (expected 400)"
fi

# ─── Test 7: Delete without confirm (should fail) ────────────────

echo ""
echo "▸ Test 7: Delete without ?confirm=true (should fail)"

NO_CONFIRM=$(curl -sf -o /dev/null -w "%{http_code}" -X DELETE \
  "${SULCUS_URL}/api/v1/admin/agents/$NS_B" \
  -H "$AUTH_HEADER" -H "$CONTENT_TYPE" 2>/dev/null || echo "000")

if [ "$NO_CONFIRM" = "400" ]; then
  pass "Delete without confirm correctly rejected (HTTP 400)"
else
  fail "Delete without confirm returned HTTP $NO_CONFIRM (expected 400)"
fi

# ─── Test 8: Delete with confirm ─────────────────────────────────

echo ""
echo "▸ Test 8: Delete '$NS_B' with confirm"

DELETE_RESULT=$(api DELETE "/api/v1/admin/agents/${NS_B}?confirm=true" || echo '{"error":"failed"}')
DEL_COUNT=$(echo "$DELETE_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('memories_deleted',0))" 2>/dev/null || echo "0")

if [ "$DEL_COUNT" -ge "$EXPECTED_AFTER" ]; then
  pass "Deleted $DEL_COUNT memories from '$NS_B'"
else
  fail "Deleted $DEL_COUNT memories, expected ≥$EXPECTED_AFTER"
fi

# Verify namespace is gone
AFTER_DELETE=$(count_memories "$NS_B")
if [ "$AFTER_DELETE" = "0" ]; then
  pass "Namespace '$NS_B' fully deleted (0 memories remain)"
else
  fail "Namespace still has $AFTER_DELETE memories after delete"
fi

# ─── Test 9: Delete nonexistent (should 404) ─────────────────────

echo ""
echo "▸ Test 9: Delete nonexistent namespace (should 404)"

GHOST_DELETE=$(curl -sf -o /dev/null -w "%{http_code}" -X DELETE \
  "${SULCUS_URL}/api/v1/admin/agents/nonexistent-ghost-ns-12345?confirm=true" \
  -H "$AUTH_HEADER" -H "$CONTENT_TYPE" 2>/dev/null || echo "000")

if [ "$GHOST_DELETE" = "404" ]; then
  pass "Delete nonexistent namespace correctly returned 404"
else
  fail "Delete nonexistent returned HTTP $GHOST_DELETE (expected 404)"
fi

# ─── Cleanup: delete sanitization test data ───────────────────────

echo ""
echo "▸ Cleanup: removing test data"

for NS in "$SANITIZED" "$SANITIZED_SPACES" "$SANITIZED_UNDER"; do
  api DELETE "/api/v1/admin/agents/${NS}?confirm=true" > /dev/null 2>&1 || true
done
log "Cleaned up test namespaces"

# ─── Summary ──────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════"
echo "  Results: $PASS passed, $FAIL failed ($TOTAL total)"
echo "═══════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "⚠️  Some tests failed. Check output above."
  exit 1
else
  echo ""
  echo "✅ All tests passed!"
  exit 0
fi
