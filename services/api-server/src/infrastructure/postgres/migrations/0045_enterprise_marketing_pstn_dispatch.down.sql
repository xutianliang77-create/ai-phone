DROP TRIGGER IF EXISTS marketing_call_tasks_pstn_update_guard
  ON enterprise.marketing_call_tasks;
DROP TRIGGER IF EXISTS marketing_call_tasks_scheduler_update_guard
  ON enterprise.marketing_call_tasks;
DROP TRIGGER IF EXISTS marketing_call_tasks_scheduler_delete_guard
  ON enterprise.marketing_call_tasks;
DROP TRIGGER IF EXISTS marketing_call_tasks_scheduler_insert_guard
  ON enterprise.marketing_call_tasks;
DROP FUNCTION IF EXISTS enterprise.guard_marketing_pstn_task_transition();

CREATE TRIGGER marketing_call_tasks_scheduler_guard
BEFORE INSERT OR UPDATE OR DELETE ON enterprise.marketing_call_tasks
FOR EACH ROW EXECUTE FUNCTION enterprise.guard_marketing_scheduler_task();

DROP TRIGGER IF EXISTS marketing_pstn_dispatches_guard
  ON enterprise.marketing_pstn_dispatches;
DROP FUNCTION IF EXISTS enterprise.guard_marketing_pstn_dispatch();
DROP TABLE IF EXISTS enterprise.marketing_pstn_dispatches;
