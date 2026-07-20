DROP POLICY IF EXISTS marketing_handoffs_tenant_isolation
  ON enterprise.marketing_handoffs;
DROP POLICY IF EXISTS marketing_handoff_policies_tenant_isolation
  ON enterprise.marketing_handoff_policies;
DROP TRIGGER IF EXISTS marketing_handoffs_guard ON enterprise.marketing_handoffs;
DROP FUNCTION IF EXISTS enterprise.guard_marketing_handoff();
DROP TRIGGER IF EXISTS marketing_campaigns_handoff_policy_guard
  ON enterprise.marketing_campaigns;
DROP FUNCTION IF EXISTS enterprise.guard_marketing_campaign_handoff_policy();
DROP FUNCTION IF EXISTS enterprise.marketing_handoff_policy_is_ready(uuid);
DROP TRIGGER IF EXISTS marketing_handoff_policies_guard
  ON enterprise.marketing_handoff_policies;
DROP FUNCTION IF EXISTS enterprise.guard_marketing_handoff_policy();
DROP TABLE IF EXISTS enterprise.marketing_handoffs;
DROP TABLE IF EXISTS enterprise.marketing_handoff_policies;
