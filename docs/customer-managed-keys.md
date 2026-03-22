# Customer-Managed Keys (CMK) — Enterprise Encryption

Sulcus encrypts all data at rest by default using Azure platform-managed keys (AES-256). Enterprise customers can bring their own encryption keys via Azure Key Vault for full control over data encryption.

## How It Works

1. **You create a Key Vault** in your Azure subscription
2. **You create an RSA encryption key** (2048, 3072, or 4096-bit)
3. **You grant Sulcus's managed identity** `Get`, `WrapKey`, and `UnwrapKey` permissions on the key
4. **You configure the key reference** via the Sulcus API
5. **Azure handles the rest** — all disk encryption uses your key transparently

Your data, your key, your control. If you revoke Sulcus's access to the key, the data becomes unreadable — that's the point.

## API Reference

All endpoints require authentication and an Enterprise plan tier.

### Get Encryption Config

```
GET /api/v1/settings/encryption
Authorization: Bearer <api-key>
```

**Response (not configured):**
```json
{
  "status": "not_configured",
  "message": "No customer-managed key configured. Data is encrypted with Azure platform-managed keys."
}
```

**Response (configured):**
```json
{
  "status": "configured",
  "config": {
    "key_vault_uri": "https://contoso-vault.vault.azure.net",
    "key_name": "sulcus-data-key",
    "key_version": null,
    "status": "active",
    "status_message": null,
    "enabled_at": "2026-03-22T06:00:00Z",
    "last_validated": "2026-03-22T06:01:00Z"
  }
}
```

### Configure CMK

```
PUT /api/v1/settings/encryption
Authorization: Bearer <api-key>
Content-Type: application/json

{
  "key_vault_uri": "https://contoso-vault.vault.azure.net",
  "key_name": "sulcus-data-key",
  "key_version": null
}
```

**Response:**
```json
{
  "status": "pending",
  "config": {
    "key_vault_uri": "https://contoso-vault.vault.azure.net",
    "key_name": "sulcus-data-key",
    "status": "pending"
  },
  "message": "CMK configuration saved. Run POST /api/v1/settings/encryption/validate to verify key access and activate."
}
```

### Validate Key Access

After configuring, validate that Sulcus can access your key:

```
POST /api/v1/settings/encryption/validate
Authorization: Bearer <api-key>
```

**Response:**
```json
{
  "valid": true,
  "key_vault_reachable": true,
  "key_accessible": true,
  "key_operations_available": true,
  "status": "active"
}
```

### Revoke CMK

Reverts to Azure platform-managed keys:

```
DELETE /api/v1/settings/encryption
Authorization: Bearer <api-key>
```

**Response:**
```json
{
  "status": "revoked",
  "message": "CMK revoked. Data encryption will revert to Azure platform-managed keys."
}
```

### Audit Log

```
GET /api/v1/settings/encryption/audit
Authorization: Bearer <api-key>
```

Returns the last 100 encryption configuration events (configured, validated, rotated, revoked).

## Key Rotation

Azure Key Vault supports automatic key rotation. When you create a new key version:

1. Update the configuration with the new `key_version` (or omit to use latest)
2. Run the validation endpoint
3. Azure re-encrypts the data encryption key with your new key version

The data itself is never re-encrypted — Azure uses envelope encryption. Only the data encryption key (DEK) is re-wrapped with your new key version.

## Emergency Key Revocation

If you revoke Sulcus's access in your Key Vault access policies, the database becomes unreadable immediately. This is your kill switch.

To restore access:
1. Re-grant the `Get`, `WrapKey`, `UnwrapKey` permissions
2. Run the validation endpoint to confirm

## Pricing

CMK is available on the **Enterprise** plan. Key Vault costs are billed by Azure directly to your subscription (~$0.03 per 10,000 key operations).

## Setup Guide

### Step 1: Create a Key Vault

```bash
az keyvault create \
  --name your-vault-name \
  --resource-group your-rg \
  --location canadacentral \
  --sku standard
```

### Step 2: Create an RSA Key

```bash
az keyvault key create \
  --vault-name your-vault-name \
  --name sulcus-data-key \
  --kty RSA \
  --size 2048
```

### Step 3: Grant Sulcus Access

```bash
az keyvault set-policy \
  --name your-vault-name \
  --object-id <sulcus-managed-identity-object-id> \
  --key-permissions get wrapKey unwrapKey
```

### Step 4: Configure via API

```bash
curl -X PUT https://api.sulcus.ca/api/v1/settings/encryption \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "key_vault_uri": "https://your-vault-name.vault.azure.net",
    "key_name": "sulcus-data-key"
  }'
```

### Step 5: Validate

```bash
curl -X POST https://api.sulcus.ca/api/v1/settings/encryption/validate \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

**Author:** Digital Forge Studios — dooley@sulcus.ca
