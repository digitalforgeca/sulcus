#!/bin/bash
set -e

URL="https://sulcus.dforge.ca/api/v1/agent/sync"
TOKEN="test_token"
ITERATIONS=50
CONCURRENCY=1

echo "Starting benchmark: $ITERATIONS iterations..."

# We'll use a temp file to store results
TIMINGS_FILE=$(mktemp)

for i in $(seq 1 $ITERATIONS); do
    # Simple JSON payload
    PAYLOAD=$(cat <<EOF
{
  "ops": [
    {
      "op": "Add",
      "payload": {
        "id": "$(uuidgen | tr '[:upper:]' '[:lower:]')",
        "label": "perf_test_$i",
        "pointer_summary": "perf_test_summary_$i",
        "base_utility": 0.5,
        "current_heat": 0.5,
        "is_pinned": false,
        "memory_type": "episodic"
      },
      "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    }
  ],
  "last_cursor": null
}
EOF
)

    START=$(date +%s%N)
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST $URL \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD")
    END=$(date +%s%N)
    
    if [ "$HTTP_CODE" -eq "200" ]; then
        DIFF=$(( (END - START) / 1000000 ))
        echo "$DIFF" >> "$TIMINGS_FILE"
        echo "Iteration $i: ${DIFF}ms"
    else
        echo "Iteration $i: FAILED (HTTP $HTTP_CODE)"
    fi
done

# Calculate stats
echo "--- Results ---"
sort -n "$TIMINGS_FILE" > sorted_timings.txt
COUNT=$(wc -l < sorted_timings.txt)
AVG=$(awk '{ sum += $1 } END { if (NR > 0) print sum / NR }' sorted_timings.txt)
MIN=$(head -n 1 sorted_timings.txt)
MAX=$(tail -n 1 sorted_timings.txt)
P95_IDX=$(( COUNT * 95 / 100 ))
[ "$P95_IDX" -eq 0 ] && P95_IDX=1
P95=$(sed -n "${P95_IDX}p" sorted_timings.txt)

echo "Total: $COUNT successful requests"
echo "Min:   ${MIN}ms"
echo "Max:   ${MAX}ms"
echo "Avg:   ${AVG}ms"
echo "P95:   ${P95}ms"

rm "$TIMINGS_FILE" sorted_timings.txt
