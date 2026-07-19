# Dependency security exceptions

`otel-livekit-exception.json` is a narrow, expiring exception for one upstream
advisory. It is not a zero-vulnerability claim. The gate fails if the audit set,
severity, direct versions, mitigations, or expiry drift, and it also fails when a
new advisory appears. Once LiveKit Agents publishes compatible patched OTel
dependencies, upgrade it and delete the exception rather than extending it by
default.

Run:

```bash
npm run check:dependency-security
```
