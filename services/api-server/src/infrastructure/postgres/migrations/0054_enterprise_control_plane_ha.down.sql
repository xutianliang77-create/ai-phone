DROP TRIGGER IF EXISTS control_plane_pending_work_guard
  ON enterprise.control_plane_pending_work;
DROP FUNCTION IF EXISTS enterprise.guard_control_plane_pending_work();
DROP TRIGGER IF EXISTS control_plane_instance_guard
  ON enterprise.control_plane_instances;
DROP FUNCTION IF EXISTS enterprise.guard_control_plane_instance();
DROP TRIGGER IF EXISTS enterprise_control_plane_pending_work
  ON enterprise.tenant_jobs;
DROP FUNCTION IF EXISTS enterprise.sync_control_plane_pending_work();
DROP TABLE IF EXISTS enterprise.control_plane_pending_work;
DROP TABLE IF EXISTS enterprise.control_plane_instances;
DROP FUNCTION IF EXISTS enterprise.current_control_plane_worker_id();
