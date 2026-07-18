#!/bin/sh
set -eu

: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_MIGRATOR_PASSWORD:?POSTGRES_MIGRATOR_PASSWORD is required}"
: "${POSTGRES_RUNTIME_PASSWORD:?POSTGRES_RUNTIME_PASSWORD is required}"
: "${POSTGRES_REPLICA_PASSWORD:?POSTGRES_REPLICA_PASSWORD is required}"

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=database_name="$POSTGRES_DB" \
  --set=migrator_password="$POSTGRES_MIGRATOR_PASSWORD" \
  --set=runtime_password="$POSTGRES_RUNTIME_PASSWORD" \
  --set=replica_password="$POSTGRES_REPLICA_PASSWORD" <<'SQL'
SELECT 'CREATE ROLE ai_phone_stage_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_phone_stage_owner') \gexec

SELECT format(
  'CREATE ROLE ai_phone_stage_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L',
  :'migrator_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_phone_stage_migrator') \gexec

SELECT format(
  'CREATE ROLE ai_phone_stage_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L',
  :'runtime_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_phone_stage_runtime') \gexec

SELECT format(
  'CREATE ROLE ai_phone_stage_replica LOGIN REPLICATION NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L',
  :'replica_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_phone_stage_replica') \gexec

ALTER ROLE ai_phone_stage_migrator PASSWORD :'migrator_password';
ALTER ROLE ai_phone_stage_runtime PASSWORD :'runtime_password';
ALTER ROLE ai_phone_stage_replica PASSWORD :'replica_password';
GRANT ai_phone_stage_owner TO ai_phone_stage_migrator;

ALTER DATABASE :"database_name" OWNER TO ai_phone_stage_owner;
REVOKE ALL ON DATABASE :"database_name" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"database_name"
  TO ai_phone_stage_migrator, ai_phone_stage_runtime;
ALTER ROLE ai_phone_stage_runtime SET search_path = ai_phone, public;
SQL
