# Wujie AI 1.1 development line

V11-01 establishes an isolated local development line and dual-version CI. It does not implement the public-cloud runtime, change the application identity, call a provider, import private 1.0 data, deploy a service, or publish a branch.

## Lineage

- Branch: `develop/wujie-1.1-public`
- Persistent worktree: an isolated local worktree owned by the 1.1 development branch; machine-specific paths stay outside versioned documentation.
- Local 1.0 release tag: `wujie-private-v1.0.0`
- Frozen 1.0 commit: `898ee517e7aac00b03bc79ff2d0597dd00fdbf56`
- Frozen 1.0 tree: `5c564f99489f7bd62eae28ef75157f6e77a2c369`
- Target product version: `1.1.0`

The branch starts from the peeled 1.0 release commit. CI uses the immutable commit rather than requiring the local-only tag to exist on GitHub. The public application ID, signing identity, release version/build, deployment ID, and formal public scope remain V11-03 decisions; the inherited mobile package therefore remains `1.0.0+2026090501` during V11-01.

## Dual-version CI

`.github/workflows/wujie-dual-version.yml` runs four independent gates whenever the 1.1 branch is pushed or proposed in a pull request:

1. Current 1.1 Node build, typecheck, tests, and line-size gate, including the lineage/isolation policy check.
2. Frozen 1.0 Node build, typecheck, tests, and line-size gate at exact commit 898ee51.
3. Current 1.1 Flutter analysis and tests.
4. Frozen 1.0 Flutter analysis and tests at exact commit 898ee51.

The existing CI and supply-chain definitions are also configured for both `release/wujie-1.0-private` and `develop/wujie-1.1-public` pushes when those definitions are present on the pushed ref. All checkout steps use read-only repository permissions without persisted credentials. All third-party actions in the new workflow are pinned to full commit IDs. The workflow references no GitHub secrets and sets production secret/data access to false with synthetic-only CI data.

Local policy validation:

```sh
npm run check:wujie-dual-version-ci
npm run typecheck
npm test
npm run check:lines
cd apps/mobile
flutter analyze
flutter test
```

Formal V11-01 evidence must run the relevant Node and Flutter checks on both this worktree and an immutable frozen-1.0 checkout. Workflow syntax/static policy passing does not by itself prove GitHub-hosted jobs ran because this branch is intentionally not pushed in V11-01.

## Secret and data isolation

- CI accepts repository synthetic/redacted fixtures only.
- `release/public/1.1.0/runtime.env`, `private/`, and `data/` are ignored and forbidden as tracked inputs.
- Private 1.0 credentials, database snapshots, transcripts, device profiles, model weights, and local preservation artifacts are not copied into this worktree or workflow.
- Tracked `.env`, credential/key, provisioning profile, and database/dump suffixes fail the policy check; example templates remain allowed.
- Existing Gitleaks and SBOM jobs remain enabled on both version lines.

## Maintenance rule

The 1.0 maintenance branch remains independent. A shared defect fix is a small explicit commit that is applied to each line and verified by its own regression gate; 1.1 feature work is never merged wholesale into 1.0. Updating the frozen 1.0 CI anchor requires a separately accepted 1.0.x release, not an incidental 1.1 change.
