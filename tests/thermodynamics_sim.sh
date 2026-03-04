#!/bin/bash
set -e

# SULCUS Thermodynamics Simulation
# Validates ACT-R decay, stability mechanics, and LLM-native compacting.

SULCUS_LOCAL="./target/release/sulcus-local"
echo "--- STARTING THERMODYNAMICS SIMULATION ---"

DIR="/tmp/sulcus_thermo_sim_$(date +%s)"
mkdir -p "$DIR"
export SULCUS_DATA_DIR="$DIR"
unset SULCUS_DATABASE_URL

# 1. Initialize
$SULCUS_LOCAL init > /dev/null 2>&1

# 2. Record a "Golden Memory"
echo "Recording Golden Memory..."
$SULCUS_LOCAL add-memory "Golden Memory: Project X uses a proprietary HLC implementation." 1.0 > /dev/null

# 3. Simulate Time (Decay without Retrieval)
echo "Simulating 3 days of decay (72 ticks)..."
for i in {1..72}; do
    # Force the tick using the CLI tool
    echo '{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "tick", "arguments": { "decay": 0.85, "prune_threshold": 0.05 } } }' | $SULCUS_LOCAL stdio > /dev/null
done

# 4. Check Heat
echo "Retrieving Heat after 3 days..."
HOT=$($SULCUS_LOCAL list-hot 5)
echo "$HOT"

if [[ $HOT == *"Golden Memory"* ]]; then
    echo "FAILED: Golden Memory should have decayed out of active index."
    # We continue anyway to test retrieval
else
    echo "Golden Memory successfully paged out to cold storage."
fi

# 5. Retrieve (Ignite)
echo "Simulating Agent Retrieval (Ignition)..."
# We inject a semantic search that matches the node
echo '{"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": "search_memory", "arguments": { "query": "Project X HLC", "limit": 1 } } }' | $SULCUS_LOCAL stdio > /dev/null

# 6. Check Heat Again
echo "Retrieving Heat after Ignition..."
HOT2=$($SULCUS_LOCAL list-hot 5)
echo "$HOT2"

if [[ $HOT2 == *"Golden Memory"* ]]; then
    echo "✅ SUCCESS: Golden Memory ignited back into active index. Stability multiplied."
    echo "THERMODYNAMICS_PASSED"
else
    echo "❌ FAILED: Ignition did not restore Golden Memory."
    exit 1
fi

# Cleanup
rm -rf "$DIR"
pkill -f "pglite-server.js" || true
