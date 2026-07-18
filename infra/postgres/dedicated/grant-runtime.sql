BEGIN;

REVOKE ALL ON SCHEMA ai_phone FROM PUBLIC;
REVOKE CREATE ON SCHEMA ai_phone FROM ai_phone_stage_runtime;
GRANT USAGE ON SCHEMA ai_phone TO ai_phone_stage_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ai_phone
  TO ai_phone_stage_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ai_phone
  TO ai_phone_stage_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ai_phone
  TO ai_phone_stage_runtime;

ALTER DEFAULT PRIVILEGES FOR ROLE ai_phone_stage_migrator IN SCHEMA ai_phone
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ai_phone_stage_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE ai_phone_stage_migrator IN SCHEMA ai_phone
  GRANT USAGE, SELECT ON SEQUENCES TO ai_phone_stage_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE ai_phone_stage_migrator IN SCHEMA ai_phone
  GRANT EXECUTE ON FUNCTIONS TO ai_phone_stage_runtime;

COMMIT;
