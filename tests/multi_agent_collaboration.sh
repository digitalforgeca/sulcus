#!/bin/bash
set -e

# SULCUS Collaborative Agent Test
# Validates that memory shared via the Golden Index is retrieved by distinct agents.

SULCUS_LOCAL="./target/release/sulcus"
SERVER_URL="https://api.sulcus.ca"
API_KEY="test_token"

echo "--- STARTING COLLECTIVE BRAIN TEST ---"

# Pre-flight
if [ ! -f "$SULCUS_LOCAL" ]; then
    echo "Error: sulcus binary not found. Run cargo build --release."
    exit 1
fi

# 2. Profile A: Record Memory (uses integral embedded PG — no external DB needed)
echo "Profile A: Recording architecture decision..."
unset SULCUS_DATABASE_URL
$SULCUS_LOCAL init
$SULCUS_LOCAL add-memory "Architecture Decision: Use EdDSA for all payload signing." 1.0

# 3. Profile A: Sync to Azure
echo "Profile A: Syncing to Golden Index..."
SULCUS_SERVER_URL=$SERVER_URL SULCUS_API_KEY=$API_KEY $SULCUS_LOCAL sync-now

# 4. Profile B: Sync from Azure
echo "Profile B: Pulling from Golden Index..."
unset SULCUS_DATABASE_URL
$SULCUS_LOCAL init
SULCUS_SERVER_URL=$SERVER_URL SULCUS_API_KEY=$API_KEY $SULCUS_LOCAL sync-now

# 5. Profile B: Search for the decision
echo "Profile B: Searching memory..."
RESULT=$(HOME=$DIR_B $SULCUS_LOCAL list-hot 10)

if [[ $RESULT == *"EdDSA"* ]]; then
    echo "✅ SUCCESS: Profile B retrieved Profile A's memory."
    echo "COLLECTIVE_BRAIN_PASSED"
else
    echo "❌ FAILED: Memory not found in Profile B."
    echo "Result was: $RESULT"
    exit 1
fi
