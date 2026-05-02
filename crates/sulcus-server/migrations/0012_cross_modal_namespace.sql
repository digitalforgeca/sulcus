-- 0012_cross_modal_namespace.sql
-- Add multi-modal and namespace columns to golden_index.

ALTER TABLE golden_index ADD COLUMN IF NOT EXISTS modality TEXT NOT NULL DEFAULT 'text';
ALTER TABLE golden_index ADD COLUMN IF NOT EXISTS source_mime TEXT;
ALTER TABLE golden_index ADD COLUMN IF NOT EXISTS namespace TEXT NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS idx_golden_modality ON golden_index(tenant_id, modality);
CREATE INDEX IF NOT EXISTS idx_golden_namespace ON golden_index(tenant_id, namespace);
