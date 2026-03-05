#!/bin/bash
set -e

RG="sulcus-enterprise-rg"
LOCATION="eastus"
VM_NAME="sulcus-vm"
ADMIN_USER="sulcusadmin"

echo "Creating Resource Group..."
az group create --name $RG --location $LOCATION --output none

echo "Creating VM..."
az vm create \
  --resource-group $RG \
  --name $VM_NAME \
  --image Ubuntu2204 \
  --admin-username $ADMIN_USER \
  --generate-ssh-keys \
  --public-ip-sku Standard \
  --output json > vm_info.json

# Fallback extraction method
IP=$(grep -o '"publicIpAddress": "[^"]*' vm_info.json | cut -d'"' -f4)
echo "VM IP: $IP"

echo "Opening port 3000..."
az vm open-port --port 3000 --resource-group $RG --name $VM_NAME --output none
echo "Opening port 80..."
az vm open-port --port 80 --resource-group $RG --name $VM_NAME --output none

echo "Creating archive..."
tar -czf sulcus.tar.gz --exclude=target --exclude=.git --exclude=.fastembed_cache .

echo "Waiting for SSH..."
sleep 15
until ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 $ADMIN_USER@$IP "echo OK"; do
    echo "Retrying SSH..."
    sleep 5
done

echo "Copying archive..."
scp -o StrictHostKeyChecking=no sulcus.tar.gz $ADMIN_USER@$IP:~

echo "Running setup script on remote..."
ssh -o StrictHostKeyChecking=no $ADMIN_USER@$IP << 'EOF'
set -e
mkdir -p sulcus
tar -xzf sulcus.tar.gz -C sulcus
cd sulcus

sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y build-essential pkg-config libssl-dev docker.io docker-compose-v2 screen

curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source $HOME/.cargo/env

sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker $USER
sudo chmod 666 /var/run/docker.sock || true

# Start DB
docker compose -f docker-compose.postgres.yml up -d

# Wait for DB
sleep 15

# Build and start server using screen so it continues running
# Using cargo build then running the binary
source $HOME/.cargo/env
cargo build --release -p sulcus-server --features server-bin
echo "Backend build finished."

DOMAIN="sulcus.dforge.ca"

screen -dmS sulcus-server bash -c "SULCUS_BIND_ADDR=0.0.0.0:3000 SULCUS_PUBLIC_URL=http://\$DOMAIN SULCUS_DATABASE_URL=\$SULCUS_DATABASE_URL ./target/release/sulcus-server"
echo "Backend server started in screen session."

# Build and start Next.js frontend
echo "Building frontend..."
docker build -t sulcus-web --build-arg NEXT_PUBLIC_SULCUS_SERVER_URL=http://\$DOMAIN:3000 packages/sulcus-web

echo "Starting frontend..."
docker run -d --name sulcus-web-container -p 80:8080 --restart unless-stopped sulcus-web

EOF

echo "Deployment complete! Backend listening at http://\$DOMAIN:3000, Frontend at http://\$DOMAIN"
