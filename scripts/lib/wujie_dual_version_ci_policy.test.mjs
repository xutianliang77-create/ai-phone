import { describe, expect, test } from "vitest";
import {
  evaluateWujieDualVersionCi,
  isForbiddenTrackedPath,
} from "./wujie_dual_version_ci_policy.mjs";

const base = "898ee517e7aac00b03bc79ff2d0597dd00fdbf56";
const tree = "5c564f99489f7bd62eae28ef75157f6e77a2c369";

describe("Wujie dual-version CI policy", () => {
  test("accepts an isolated exact-base dual-version gate", () => {
    const result = evaluateWujieDualVersionCi(fixture());

    expect(result.status).toBe("ready");
    expect(result.issues).toEqual([]);
    expect(result.summary.productionSecretsAllowed).toBe(false);
    expect(result.summary.productionDataAllowed).toBe(false);
  });

  test("rejects a changed private 1.0 anchor", () => {
    const input = fixture();
    input.manifest.createdFrom.commit = "0".repeat(40);

    const result = evaluateWujieDualVersionCi(input);

    expect(result.status).toBe("not_ready");
    expect(result.issues.some((issue) => issue.startsWith("frozen_10_commit:"))).toBe(true);
  });

  test("rejects tracked private data and workflow secrets", () => {
    const input = fixture();
    input.trackedPaths.push("release/public/1.1.0/data/accounts.sqlite");
    input.workflow += "\n      token: ${{ secrets.PRODUCTION_TOKEN }}\n";

    const result = evaluateWujieDualVersionCi(input);

    expect(result.status).toBe("not_ready");
    expect(result.issues.some((issue) => issue.startsWith("tracked_secret_and_data_files:"))).toBe(true);
    expect(result.issues).toContain(
      "workflow_no_secrets: dual-version workflow must not reference GitHub secrets",
    );
  });

  test("allows examples but rejects credential and database artifacts", () => {
    expect(isForbiddenTrackedPath("release/public/1.1.0/runtime.env", [".key"])).toBe(true);
    expect(isForbiddenTrackedPath("config/client.key", [".key"])).toBe(true);
    expect(isForbiddenTrackedPath("config/.env.example", [".key"])).toBe(false);
    expect(isForbiddenTrackedPath("apps/mobile/android/key.properties.example", [".key"])).toBe(false);
  });

  test("rejects an existing CI workflow without read-only credentials", () => {
    const input = fixture();
    input.ciWorkflow = "release/wujie-1.0-private\ndevelop/wujie-1.1-public\nactions/checkout@"
      + "a".repeat(40);

    const result = evaluateWujieDualVersionCi(input);

    expect(result.status).toBe("not_ready");
    expect(result.issues.some((issue) => issue.startsWith("ci_read_only:"))).toBe(true);
    expect(result.issues.some((issue) => issue.startsWith("ci_checkout_credentials:"))).toBe(true);
  });
});

function fixture() {
  const manifest = {
    status: "development_line",
    targetProductVersion: "1.1.0",
    branch: "develop/wujie-1.1-public",
    createdFrom: { commit: base, tree },
    versionIdentity: {
      freezeTask: "V11-03",
      public11ReleaseVersionFrozen: false,
      public11ApplicationIdentityFrozen: false,
    },
    isolation: {
      productionSecretsAllowedInCi: false,
      productionDataAllowedInCi: false,
      private10DataImported: false,
      private10CredentialsImported: false,
      requiredIgnorePatterns: [
        "release/public/1.1.0/runtime.env",
        "release/public/1.1.0/private/",
        "release/public/1.1.0/data/",
      ],
      forbiddenTrackedSuffixes: [".mobileprovision", ".key", ".sqlite"],
    },
    scope: {
      publicCloudRuntimeImplemented: false,
      providerCallsEnabled: false,
      deploymentPerformed: false,
    },
  };
  const checkout = "actions/checkout@" + "a".repeat(40);
  const node = "actions/setup-node@" + "b".repeat(40);
  const flutter = "subosito/flutter-action@" + "c".repeat(40);
  const workflow = `permissions:\n  contents: read\nenv:\n  WUJIE_CI_DATA_MODE: synthetic_only\n  WUJIE_ALLOW_PRODUCTION_SECRETS: "false"\n  WUJIE_ALLOW_PRODUCTION_DATA: "false"\njobs:\n  public-11-node:\n    - uses: ${checkout}\n      persist-credentials: false\n    node-version: 24\n  private-10-node:\n    ref: ${base}\n    - uses: ${node}\n      persist-credentials: false\n  public-11-mobile:\n    - uses: ${flutter}\n      persist-credentials: false\n    flutter-version: 3.44.1\n  private-10-mobile:\n    ref: ${base}\n    - uses: ${flutter}\n      persist-credentials: false\n`;
  return {
    manifest,
    workflow,
    ciWorkflow: "permissions:\n  contents: read\nrelease/wujie-1.0-private\ndevelop/wujie-1.1-public\nactions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\npersist-credentials: false\n",
    supplyChainWorkflow: "permissions:\n  contents: read\nrelease/wujie-1.0-private\ndevelop/wujie-1.1-public\nactions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\npersist-credentials: false\n",
    gitignore: manifest.isolation.requiredIgnorePatterns.join("\n"),
    trackedPaths: ["package.json", "release/public/1.1.0/development-line.json"],
    gitFacts: {
      baseCommitExists: true,
      baseTree: tree,
      headDescendsFromBase: true,
      baseMobileVersion: "1.0.0+2026090501",
    },
  };
}
