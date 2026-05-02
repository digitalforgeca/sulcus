#!/bin/bash
# auto-deploy.sh — Check if ACR images are newer than running revisions and deploy
# Runs as cron every 10 minutes. Uses --no-wait to avoid timeout zombies.
# Tracks consecutive failures to prevent infinite retry loops.

set -euo pipefail

REGISTRY="guardrailimages.azurecr.io"
RG="sulcus-rg"
STATE_FILE="/tmp/sulcus-deploy-state.json"
MAX_RETRIES=3

# Convert ISO timestamp to epoch (macOS compatible)
iso_to_epoch() {
  local ts="$1"
  local clean="${ts%%.*}"
  clean="${clean%%+*}"
  clean="${clean%%Z*}"
  date -j -f "%Y-%m-%dT%H:%M:%S" "$clean" "+%s" 2>/dev/null || echo 0
}

# Read/write retry counter from state file
get_retry_count() {
  local app="$1"
  if [ -f "$STATE_FILE" ]; then
    python3 -c "import json; d=json.load(open('$STATE_FILE')); print(d.get('$app',0))" 2>/dev/null || echo 0
  else
    echo 0
  fi
}

set_retry_count() {
  local app="$1"
  local count="$2"
  if [ -f "$STATE_FILE" ]; then
    python3 -c "
import json
d=json.load(open('$STATE_FILE'))
d['$app']=$count
json.dump(d,open('$STATE_FILE','w'))
" 2>/dev/null
  else
    echo "{\"$app\":$count}" > "$STATE_FILE"
  fi
}

deploy_if_needed() {
  local app="$1"
  local image="$2"

  local prov_state
  prov_state=$(az containerapp show --name "$app" --resource-group "$RG" \
    --query "properties.provisioningState" -o tsv 2>/dev/null || echo "Unknown")

  local retries
  retries=$(get_retry_count "$app")

  case "$prov_state" in
    Succeeded)
      # Reset retry counter on success
      set_retry_count "$app" 0
      ;;
    Failed)
      if [ "$retries" -ge "$MAX_RETRIES" ]; then
        echo "[$app] Failed (retry $retries/$MAX_RETRIES) — MAX RETRIES HIT. Giving up. Manual fix needed."
        return
      fi
      echo "[$app] Failed (retry $((retries+1))/$MAX_RETRIES) — will retry."
      ;;
    InProgress)
      echo "[$app] InProgress — skipping"
      return
      ;;
    *)
      echo "[$app] Unknown state: $prov_state — skipping"
      return
      ;;
  esac

  # Get timestamps
  local latest_created
  latest_created=$(az acr repository show-manifests --name guardrailimages \
    --repository "$image" --top 1 --orderby time_desc \
    --query "[0].timestamp" -o tsv 2>/dev/null || echo "")

  local revision_created
  revision_created=$(az containerapp revision list --name "$app" --resource-group "$RG" \
    --query "[0].properties.createdTime" -o tsv 2>/dev/null || echo "")

  if [ -z "$revision_created" ] || [ -z "$latest_created" ]; then
    echo "[$app] Could not compare timestamps, skipping"
    return
  fi

  local img_epoch rev_epoch
  img_epoch=$(iso_to_epoch "$latest_created")
  rev_epoch=$(iso_to_epoch "$revision_created")

  if [ "$img_epoch" -gt "$rev_epoch" ] || [ "$prov_state" = "Failed" ]; then
    echo "[$app] Deploying... (image: $latest_created, revision: $revision_created, state: $prov_state)"
    az containerapp update --name "$app" --resource-group "$RG" \
      --image "$REGISTRY/$image:latest" \
      --revision-suffix "auto-$(date +%s)" \
      --no-wait 2>&1 || {
        echo "[$app] Deploy command failed"
        return
    }
    # Increment retry counter for Failed states
    if [ "$prov_state" = "Failed" ]; then
      set_retry_count "$app" "$((retries+1))"
    fi
    echo "[$app] Deploy initiated (async)"
  else
    echo "[$app] Up to date"
  fi
}

deploy_if_needed "sulcus-server" "sulcus/sulcus-server"
deploy_if_needed "sulcus-web" "sulcus/sulcus-web"
