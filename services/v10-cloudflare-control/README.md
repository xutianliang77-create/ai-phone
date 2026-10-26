# Independent 1.0 Cloudflare control

Local candidate only. Deployment, resource creation, secrets, account grants,
real identity/model/device tests, installation and publication require the
corresponding user approval. No old Cloudflare resource or balance is restored.

The Worker owns Apple identity, device registration, authorization, reservations
and the unique settlement ledger. The retained 1.0 API/Gateway owns audio,
ASR/translation/readout, text history and private storage. No Paraformer, TMT or
phone TTS adapter is imported into this control service. Provider configuration
continues to use the retained processing implementation.

New issue requires both an authenticated account/device signature and a
purpose-bound MAC from the processing API. The private gateway challenges the
bound key on every connection, then asks this authority to admit it before any
provider starts. A repeated issue key cannot reserve again or extend its lease.
A trusted signed stop receipt settles once. Missing provider-close evidence
keeps the reservation and capacity occupied; no global historical sweep runs.

Admission defaults closed. QA has an explicit absolute window and owner list;
there is no automatic renewal. Production admission also requires an explicit
approved source binding. Neither a configured switch nor local simulation proves
real GPU/Apple/device qualification or ten-user latency.

`migrations/` is for a new empty control database. Never apply it to an old or
unrelated database. The retained SQLite content store stays in place; PostgreSQL
private-content erasure explicitly refuses completion until its own adapter is
qualified. Deletion intent is durable before authentication is revoked, and
content erasure waits for confirmed terminal sessions. Accounting metadata is
retained. Only this new service's bounded private-erasure jobs are scheduled.

The generated `vendor/reused-control-core.mjs` contains pure existing first-party
Apple/D1 primitives. Exact input provenance and the standalone Worker module,
local native-runtime results, mobile build recipe and closed deployment plan are
stored in `artifacts/v10-selfhosted-control-20261026/` at the workspace root.
The directory name is historical; the selected control host is Cloudflare.
