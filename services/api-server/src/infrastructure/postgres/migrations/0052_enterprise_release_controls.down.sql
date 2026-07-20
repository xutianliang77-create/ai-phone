DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM enterprise.release_control_events) THEN
    RAISE EXCEPTION 'cannot roll back enterprise release control evidence'
      USING ERRCODE = '55000';
  END IF;
END
$$;

DROP TRIGGER IF EXISTS enterprise_release_control_events_append_only
  ON enterprise.release_control_events;
DROP FUNCTION IF EXISTS enterprise.reject_release_control_event_mutation();
DROP TRIGGER IF EXISTS enterprise_release_control_guard
  ON enterprise.release_controls;
DROP FUNCTION IF EXISTS enterprise.guard_release_control_mutation();
DROP TABLE enterprise.release_control_events;
DROP TABLE enterprise.release_controls;
