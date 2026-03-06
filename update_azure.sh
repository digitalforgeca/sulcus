#!/bin/bash
set -e

IP=$(grep -o '"publicIpAddress": "[^"]*' vm_info.json | cut -d'"' -f4)
echo "VM IP: $IP"

ADMIN_USER="sulcusadmin"

echo "Creating archive..."
tar -czf sulcus.tar.gz --exclude=target --exclude=.git --exclude=.fastembed_cache .

echo "Copying archive..."
scp -o StrictHostKeyChecking=no sulcus.tar.gz $ADMIN_USER@$IP:~

echo "Running setup script on remote..."
ssh -o StrictHostKeyChecking=no $ADMIN_USER@$IP << 'EOF'
set -e
mkdir -p sulcus
tar -xzf sulcus.tar.gz -C sulcus
cd sulcus

sudo chmod 666 /var/run/docker.sock || true

# Start DB
docker compose -f docker-compose.postgres.yml build
docker compose -f docker-compose.postgres.yml up -d

# Wait for DB
sleep 15

# Build and start server using screen so it continues running
source $HOME/.cargo/env
cargo build --release -p sulcus-server --features server-bin
echo "Backend build finished."

DOMAIN="sulcus.dforge.ca"

screen -S sulcus-server -X quit || true
screen -dmS sulcus-server bash -c "SULCUS_BIND_ADDR=0.0.0.0:3000 SULCUS_PUBLIC_URL=http://$DOMAIN SULCUS_DATABASE_URL=\${SULCUS_DATABASE_URL:-postgres://sulcus:sulcus@127.0.0.1:5432/sulcus_test} ./target/release/sulcus-server"
echo "Backend server started in screen session."

# Build and start Next.js frontend
echo "Building frontend..."
docker build -t sulcus-web \
  --build-arg NEXT_PUBLIC_SULCUS_SERVER_URL=https://$DOMAIN \
  --build-arg NEXT_PUBLIC_SULCUS_API_KEY="${SULCUS_API_KEY:-test_token}" \
  packages/sulcus-web

echo "Starting frontend..."
docker stop sulcus-web-container || true
docker rm sulcus-web-container || true
docker run -d --name sulcus-web-container -p 127.0.0.1:8080:8080 --restart unless-stopped sulcus-web

echo "Update complete! Backend listening at http://$DOMAIN:3000, Frontend at http://$DOMAIN"