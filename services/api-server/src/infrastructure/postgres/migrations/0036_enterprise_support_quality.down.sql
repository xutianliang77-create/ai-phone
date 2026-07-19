DROP TRIGGER IF EXISTS support_quality_reviews_insert_guard
  ON enterprise.support_quality_reviews;
DROP FUNCTION IF EXISTS enterprise.guard_support_quality_review_insert();
DROP TRIGGER IF EXISTS support_quality_rule_versions_insert_guard
  ON enterprise.support_quality_rule_versions;
DROP FUNCTION IF EXISTS enterprise.guard_support_quality_rule_insert();
DROP TRIGGER IF EXISTS support_quality_findings_evidence_count_guard
  ON enterprise.support_quality_findings;
DROP TRIGGER IF EXISTS support_quality_reviews_evidence_count_guard
  ON enterprise.support_quality_reviews;
DROP FUNCTION IF EXISTS enterprise.guard_support_quality_evidence_counts();
DROP TRIGGER IF EXISTS support_quality_findings_immutable
  ON enterprise.support_quality_findings;
DROP TRIGGER IF EXISTS support_quality_reviews_immutable
  ON enterprise.support_quality_reviews;
DROP TRIGGER IF EXISTS support_quality_rule_versions_immutable
  ON enterprise.support_quality_rule_versions;
DROP FUNCTION IF EXISTS enterprise.reject_support_quality_mutation();

DROP TABLE IF EXISTS enterprise.support_quality_findings;
DROP TABLE IF EXISTS enterprise.support_quality_reviews;
DROP TABLE IF EXISTS enterprise.support_quality_rule_versions;

ALTER TABLE enterprise.support_agent_turns
  DROP CONSTRAINT IF EXISTS support_agent_turns_quality_binding_key;
ALTER TABLE enterprise.support_agent_runs
  DROP CONSTRAINT IF EXISTS support_agent_runs_quality_binding_key;
DROP FUNCTION IF EXISTS enterprise.is_support_quality_phrase_array(
  text[], integer, integer
);
