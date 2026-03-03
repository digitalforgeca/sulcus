#!/bin/bash
set -e

# Update remote Azure server with the latest API Keys middleware and search features
echo "Triggering Azure deployment of hardened sulcus-server..."
chmod +x update_azure.sh
./update_azure.sh
