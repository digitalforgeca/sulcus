# Extension Delivery — Forge VPS Setup

Serves sulcus-sync dylib binaries via Dionysus (nginx) on the Forge VPS.

## Directory Structure on VPS

```
/opt/forge/services/dionysus/sites/extensions/
├── v0.1.0/
│   ├── darwin-arm64/
│   │   └── libsulcus_sync.dylib
│   ├── darwin-x86_64/
│   │   └── libsulcus_sync.dylib
│   ├── linux-x86_64/
│   │   └── libsulcus_sync.so
│   └── linux-aarch64/
│       └── libsulcus_sync.so
└── latest -> v0.1.0
```

## Nginx Config

The config is at `/opt/forge/services/dionysus/config/sites/extensions.conf`.
Source copy is at `deploy/extensions/extensions.conf` in this repo.

Reload after changes:
```bash
ssh dforge-vps "sudo docker exec dionysus nginx -t && sudo docker exec dionysus nginx -s reload"
```

## How the Server Uses This

The sulcus-server (Azure Container App) fetches binaries from this URL when
a subscriber requests an extension download. Set:

```bash
az containerapp update --name sulcus-server --resource-group sulcus-rg \
    --set-env-vars EXTENSION_STORAGE_URL=https://extensions.technocraftonline.com
```

The server caches fetched binaries in-memory. Restarts clear the cache.

## Staging New Versions

### Automated (build + stage)
```bash
./scripts/build-and-stage-sync.sh v0.2.0
```

### From GitHub Release artifacts
```bash
./scripts/stage-sync-extensions.sh sync-v0.2.0
```

### Manual
```bash
scp libsulcus_sync.dylib dforge-vps:/tmp/
ssh dforge-vps "sudo cp /tmp/libsulcus_sync.dylib /opt/forge/services/dionysus/sites/extensions/v0.2.0/darwin-arm64/"
ssh dforge-vps "cd /opt/forge/services/dionysus/sites/extensions && sudo ln -sfn v0.2.0 latest"
```

## Verifying

```bash
# Check binary is downloadable
curl -I https://extensions.technocraftonline.com/v0.1.0/darwin-arm64/libsulcus_sync.dylib

# Check caching headers
curl -sI https://extensions.technocraftonline.com/v0.1.0/darwin-x86_64/libsulcus_sync.dylib | grep cache-control

# Health check
curl https://extensions.technocraftonline.com/health
```

## SSH Access

Uses the `dforge-vps` SSH config alias (user: `technocraft`, key: `~/.ssh/dforge_vps`).
User has full sudo access.
