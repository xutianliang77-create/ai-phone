DROP TRIGGER IF EXISTS enterprise_knowledge_chunk_guard
  ON enterprise.knowledge_chunks;
DROP TRIGGER IF EXISTS enterprise_knowledge_version_guard
  ON enterprise.knowledge_versions;
DROP FUNCTION IF EXISTS enterprise.guard_knowledge_chunk_mutation();
DROP FUNCTION IF EXISTS enterprise.guard_knowledge_version_mutation();

DROP TABLE IF EXISTS enterprise.knowledge_chunks;
DROP INDEX IF EXISTS enterprise.knowledge_versions_retrieval_idx;
DROP INDEX IF EXISTS enterprise.knowledge_sources_tenant_name_active_idx;

ALTER TABLE enterprise.knowledge_versions
  DROP CONSTRAINT IF EXISTS knowledge_versions_published_by_check,
  DROP CONSTRAINT IF EXISTS knowledge_versions_reviewed_by_check,
  DROP CONSTRAINT IF EXISTS knowledge_versions_product_check,
  DROP CONSTRAINT IF EXISTS knowledge_versions_country_check,
  DROP CONSTRAINT IF EXISTS knowledge_versions_locale_check,
  DROP COLUMN IF EXISTS published_by,
  DROP COLUMN IF EXISTS reviewed_at,
  DROP COLUMN IF EXISTS reviewed_by,
  DROP COLUMN IF EXISTS effective_from,
  DROP COLUMN IF EXISTS product_code,
  DROP COLUMN IF EXISTS country_code,
  DROP COLUMN IF EXISTS locale;
