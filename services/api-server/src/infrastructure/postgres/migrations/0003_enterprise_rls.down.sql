DO $$
DECLARE
  tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'members', 'api_credentials', 'entitlements', 'subscriptions',
    'knowledge_sources', 'knowledge_versions', 'term_packs',
    'policy_decisions', 'audit_events', 'usage_ledger',
    'idempotency_keys', 'inbox_events', 'outbox_events',
    'marketing_campaigns', 'marketing_leads', 'contact_consents',
    'suppression_entries', 'marketing_call_tasks', 'marketing_outcomes',
    'support_channels', 'customer_profiles', 'support_sessions',
    'support_cases', 'tool_executions', 'meetings', 'meeting_participants',
    'meeting_screen_shares', 'meeting_artifacts', 'meeting_action_items'
  ]
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS tenant_isolation ON enterprise.%I', tenant_table
    );
    EXECUTE format(
      'ALTER TABLE enterprise.%I NO FORCE ROW LEVEL SECURITY', tenant_table
    );
    EXECUTE format(
      'ALTER TABLE enterprise.%I DISABLE ROW LEVEL SECURITY', tenant_table
    );
  END LOOP;
END
$$;

DROP FUNCTION IF EXISTS enterprise.current_tenant_id();
