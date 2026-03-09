-- 0013_teams.sql — Cross-tenant team read sharing
CREATE TABLE IF NOT EXISTS teams (
    team_id    VARCHAR(64) PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_memberships (
    team_id   VARCHAR(64) NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
    tenant_id VARCHAR(64) NOT NULL,
    role      TEXT NOT NULL DEFAULT 'member',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_team_memberships_tenant ON team_memberships(tenant_id);

-- Seed: Icarus + Daedalus in team 'dooley'
INSERT INTO teams (team_id) VALUES ('dooley') ON CONFLICT DO NOTHING;
INSERT INTO team_memberships (team_id, tenant_id, role) VALUES
  ('dooley', 'icarus-sulcus-2026', 'owner'),
  ('dooley', 'daedalus-sulcus-2026', 'member')
ON CONFLICT DO NOTHING;
