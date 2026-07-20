# Enterprise security gate

`ENT-REL-001` has three separate release inputs:

1. `npm run check:enterprise-security-static` scans tracked and untracked
   source files for high-confidence SAST and secret rules. Findings never print
   the matched source text or credential.
2. `npm run check:dependency-security` runs the existing production dependency
   audit. The reviewed OpenTelemetry exception remains narrow and expiring; it
   is not a zero-vulnerability result.
3. `npm run enterprise:security-penetration -- --plan=<file> --output=<file>
   --acknowledge-isolated-target` executes a declarative negative-test plan only
   against localhost or an explicitly allowlisted `test`/`staging` host. Tokens
   come from environment variables and are never written to evidence.

The final candidate gate reruns the static and dependency checks and verifies a
signed penetration result bound to the current commit:

```bash
ENTERPRISE_SECURITY_EVIDENCE_SIGNING_KEY=... \
  npm run check:enterprise-security-release -- --evidence=tmp/enterprise-security/result.json
```

For a remote non-production target, set
`ENTERPRISE_SECURITY_ALLOWED_HOSTS=staging-api.example.com`. The runner rejects
production as an environment, non-HTTPS remote targets, URL credentials,
redirect following, literal authorization/cookie headers, incomplete attack
categories, and signing keys shorter than 32 characters.

`penetration-plan.example.json` is structural documentation only. Copy it to the
ignored `tmp/enterprise-security/` path, bind it to the exact candidate commit,
replace resource IDs and paths with isolated test fixtures, and keep all tokens
in the named environment variables. The runner requires a clean worktree and
refuses to overwrite evidence or read/write outside that directory. A passing runner result is still not an
independent penetration review; `AC-ENT-0050` also requires reviewer findings,
logs and retest evidence for the locked candidate.
