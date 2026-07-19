DROP POLICY IF EXISTS tenant_isolation
  ON enterprise.meeting_calendar_syncs;
DROP TRIGGER IF EXISTS meeting_calendar_syncs_guard
  ON enterprise.meeting_calendar_syncs;
DROP FUNCTION IF EXISTS enterprise.guard_meeting_calendar_sync_mutation();
DROP TABLE IF EXISTS enterprise.meeting_calendar_syncs;
