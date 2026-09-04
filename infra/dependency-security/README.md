# Dependency security gate

`dependency-policy.json` requires a zero-vulnerability production audit and pins
the reviewed LiveKit Agent and direct OpenTelemetry versions. The former
temporary OpenTelemetry exception was retired after upgrading LiveKit Agents to
the patched 1.6.4 release. The gate fails on any npm audit entry, dependency
version drift, or removal of the trace-context-only ingress markers.

Run:

```bash
npm run check:dependency-security
```
