DO $$
DECLARE
  tenant_table text;
BEGIN
  FOREACH tenant_table IN ARRAY ARRAY[
    'meeting_material_runs', 'meeting_material_segments',
    'meeting_material_segment_translations', 'meeting_material_speaker_labels',
    'meeting_material_conclusions', 'meeting_material_conclusion_evidence',
    'meeting_action_item_evidence'
  ]
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS tenant_isolation ON enterprise.%I', tenant_table
    );
  END LOOP;
END
$$;

DROP TRIGGER IF EXISTS meeting_action_item_evidence_immutable
  ON enterprise.meeting_action_item_evidence;
DROP TRIGGER IF EXISTS meeting_material_conclusion_evidence_immutable
  ON enterprise.meeting_material_conclusion_evidence;
DROP TRIGGER IF EXISTS meeting_material_conclusions_immutable
  ON enterprise.meeting_material_conclusions;
DROP TRIGGER IF EXISTS meeting_material_translations_immutable
  ON enterprise.meeting_material_segment_translations;
DROP TRIGGER IF EXISTS meeting_material_segments_immutable
  ON enterprise.meeting_material_segments;
DROP FUNCTION IF EXISTS enterprise.reject_meeting_material_mutation();

DROP TABLE IF EXISTS enterprise.meeting_action_item_evidence;
DROP INDEX IF EXISTS enterprise.meeting_action_items_material_ordinal_idx;
ALTER TABLE enterprise.meeting_action_items
  DROP CONSTRAINT IF EXISTS meeting_action_items_time_check,
  DROP CONSTRAINT IF EXISTS meeting_action_items_text_check,
  DROP CONSTRAINT IF EXISTS meeting_action_items_ordinal_check,
  DROP CONSTRAINT IF EXISTS meeting_action_items_priority_check,
  DROP CONSTRAINT IF EXISTS meeting_action_items_status_check,
  DROP CONSTRAINT IF EXISTS meeting_action_items_scoped_owner_fk,
  DROP CONSTRAINT IF EXISTS meeting_action_items_material_scope_key,
  DROP CONSTRAINT IF EXISTS meeting_action_items_material_run_fk,
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS created_at,
  DROP COLUMN IF EXISTS priority,
  DROP COLUMN IF EXISTS ordinal,
  DROP COLUMN IF EXISTS material_run_id;

DROP TABLE IF EXISTS enterprise.meeting_material_conclusion_evidence;
DROP TABLE IF EXISTS enterprise.meeting_material_conclusions;
DROP TABLE IF EXISTS enterprise.meeting_material_speaker_labels;
DROP TABLE IF EXISTS enterprise.meeting_material_segment_translations;
DROP TABLE IF EXISTS enterprise.meeting_material_segments;
DROP TABLE IF EXISTS enterprise.meeting_material_runs;
