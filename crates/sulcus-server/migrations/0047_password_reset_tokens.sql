-- Password reset tokens for self-service forgot-password flow.
-- Tokens are SHA-256 hashed (same pattern as api_keys/invitations).
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id          BIGSERIAL PRIMARY KEY,
    email       TEXT NOT NULL,
    token_hash  TEXT NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prt_token_hash ON password_reset_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_prt_email ON password_reset_tokens (email);
