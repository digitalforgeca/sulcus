-- 0032_platform_invites.sql
-- Add invite_type to invitations table to distinguish org invites from platform invites.
-- 'org' = join the inviter's workspace. 'platform' = create your own fresh account.

ALTER TABLE invitations ADD COLUMN IF NOT EXISTS invite_type TEXT NOT NULL DEFAULT 'org';
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ;
