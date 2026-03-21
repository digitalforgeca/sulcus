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

Copy `extensions.conf` to the Dionysus nginx config directory
(e.g., `/opt/forge/services/dionysus/conf.d/extensions.conf`).

Then reload Dionysus:
```bash
docker exec dionysus nginx -s reload
```

## How the Server Uses This

The sulcus-server Container App fetches binaries from this URL when a subscriber
requests an extension download. Set this env var on the Container App:

```bash
az containerapp update --name sulcus-server --resource-group sulcus-rg \
    --set-env-vars EXTENSION_STORAGE_URL=https://extensions.technocraftonline.com
```

The server caches fetched binaries in-memory, so restarts clear the cache.

## Staging New Versions

```bash
# From the repo root:
./scripts/build-and-stage-sync.sh v0.2.0
```

Or manually:
```bash
scp libsulcus_sync.dylib root@66.209.181.97:/opt/forge/services/dionysus/sites/extensions/v0.2.0/darwin-arm64/
ssh root@66.209.181.97 "cd /opt/forge/services/dionysus/sites/extensions && ln -sfn v0.2.0 latest"
```

## Verifying

```bash
curl -I https://extensions.technocraftonline.com/v0.1.0/darwin-arm64/libsulcus_sync.dylib
# Should return 200 with Content-Type: application/octet-stream
```
