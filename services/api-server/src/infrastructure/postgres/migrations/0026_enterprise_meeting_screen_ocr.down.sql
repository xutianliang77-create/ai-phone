DO $$
DECLARE tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'meeting_screen_ocr_runs', 'meeting_screen_ocr_subscriptions',
    'meeting_screen_ocr_commands', 'meeting_screen_ocr_frames',
    'meeting_screen_ocr_blocks'
  ] LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS tenant_isolation ON enterprise.%I', tenant_table
    );
  END LOOP;
END
$$;

DROP TRIGGER IF EXISTS meeting_screen_ocr_blocks_append_only
  ON enterprise.meeting_screen_ocr_blocks;
DROP TRIGGER IF EXISTS meeting_screen_ocr_commands_append_only
  ON enterprise.meeting_screen_ocr_commands;
DROP TRIGGER IF EXISTS meeting_screen_ocr_frames_guard
  ON enterprise.meeting_screen_ocr_frames;
DROP FUNCTION IF EXISTS enterprise.guard_meeting_screen_ocr_frame_mutation();
DROP FUNCTION IF EXISTS enterprise.reject_meeting_screen_ocr_append_mutation();

DROP TABLE IF EXISTS enterprise.meeting_screen_ocr_blocks;
DROP TABLE IF EXISTS enterprise.meeting_screen_ocr_frames;
DROP TABLE IF EXISTS enterprise.meeting_screen_ocr_commands;
DROP TABLE IF EXISTS enterprise.meeting_screen_ocr_subscriptions;
DROP TABLE IF EXISTS enterprise.meeting_screen_ocr_runs;
