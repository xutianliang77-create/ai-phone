# Dedicated PostgreSQL profile

This profile runs an ai-phone-only PostgreSQL instance. It publishes a loopback-only
port, requires TLS for every TCP client, scopes `pg_hba.conf` by database and role,
uses SCRAM credentials, archives WAL, and supports a physical standby.

Required host-only inputs:

- an environment file with the variables referenced by `docker-compose.yml`;
- a private CA and a server certificate whose SAN contains `localhost` and
  `127.0.0.1`;
- dedicated data, WAL archive, TLS, runtime, base-backup, and restore directories.

The checked-in files never contain passwords or private keys. Keep the environment,
CA private key, server private key, cutover HMAC key, and phone-reference keys at
mode `0600`; keep their parent directory at `0700`.

After first startup:

Set `POSTGRES_SSL_MODE=verify-full` and
`POSTGRES_SSL_ROOT_CERT_FILE=/absolute/path/to/root.crt`. Keep TLS query parameters
such as `sslmode` out of `POSTGRES_URL`; the runtime owns TLS configuration so
`node-postgres` cannot replace the explicitly loaded CA with URL defaults.

1. run all migrations with the migrator `verify-full` URL;
2. execute `grant-runtime.sql` as the migrator;
3. import the consistent SQLite backup twice and run the signed audit;
4. run `postgres:staging-acceptance` and `postgres:load-acceptance` with the runtime
   `verify-full` URL;
5. validate a base backup, PITR target recovery, streaming standby, and promotion
   before scheduling any service cutover.

The production profile must replace the staging private CA with the approved
enterprise PKI and must use an external backup retention target. A successful local
WAL archive copy is not evidence of off-host disaster recovery.
