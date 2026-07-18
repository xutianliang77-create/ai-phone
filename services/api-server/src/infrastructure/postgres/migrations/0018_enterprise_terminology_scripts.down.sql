DROP TRIGGER IF EXISTS enterprise_script_template_version_guard
  ON enterprise.script_template_versions;
DROP TRIGGER IF EXISTS enterprise_term_pack_version_guard
  ON enterprise.term_pack_versions;
DROP FUNCTION IF EXISTS enterprise.guard_script_template_version_mutation();
DROP FUNCTION IF EXISTS enterprise.guard_term_pack_version_mutation();

LOCK TABLE enterprise.term_packs, enterprise.term_pack_versions
  IN ACCESS EXCLUSIVE MODE;
ALTER TABLE enterprise.term_packs DISABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.term_pack_versions DISABLE ROW LEVEL SECURITY;

ALTER TABLE enterprise.term_packs
  ADD COLUMN locale text,
  ADD COLUMN terms jsonb;
UPDATE enterprise.term_packs pack
SET locale = COALESCE((
      SELECT version_record.source_locale
      FROM enterprise.term_pack_versions version_record
      WHERE version_record.tenant_id = pack.tenant_id
        AND version_record.term_pack_id = pack.id
      ORDER BY version_record.revision DESC, version_record.id
      LIMIT 1
    ), 'und'),
    terms = COALESCE((
      SELECT version_record.terms
      FROM enterprise.term_pack_versions version_record
      WHERE version_record.tenant_id = pack.tenant_id
        AND version_record.term_pack_id = pack.id
      ORDER BY version_record.revision DESC, version_record.id
      LIMIT 1
    ), '[]'::jsonb);
ALTER TABLE enterprise.term_packs
  ALTER COLUMN locale SET NOT NULL,
  ALTER COLUMN terms SET NOT NULL,
  ALTER COLUMN terms SET DEFAULT '[]'::jsonb;

DROP TABLE IF EXISTS enterprise.script_template_versions;
DROP TABLE IF EXISTS enterprise.script_templates;
DROP TABLE IF EXISTS enterprise.term_pack_versions;
DROP INDEX IF EXISTS enterprise.term_packs_tenant_name_active_idx;
ALTER TABLE enterprise.term_packs
  DROP CONSTRAINT IF EXISTS term_packs_created_by_check,
  DROP CONSTRAINT IF EXISTS term_packs_status_check,
  DROP COLUMN IF EXISTS created_by;
ALTER TABLE enterprise.term_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.term_packs FORCE ROW LEVEL SECURITY;
