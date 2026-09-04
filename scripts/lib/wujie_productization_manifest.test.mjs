import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildWipInventory,
  classifyWipPath,
  parsePorcelain,
} from "../generate_wujie_wip_inventory.mjs";
import { buildCandidateManifest } from "../generate_traceable_candidate_manifest.mjs";
import { probeRuntimeContract } from "../probe_wujie_runtime_contract.mjs";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Wujie productization evidence", () => {
  it("assigns every dirty path to one functional lane", () => {
    const entries = parsePorcelain(
      " M apps/mobile/lib/app.dart\0?? outputs/run.json\0?? services/realtime-gateway/src/new.ts\0",
    );
    const inventory = buildWipInventory(entries);

    expect(inventory.total).toBe(3);
    expect(inventory.groups.mobile.total).toBe(1);
    expect(inventory.groups.outputs.total).toBe(1);
    expect(inventory.groups["realtime-gateway"].total).toBe(1);
    expect(classifyWipPath("unexpected/file.txt")).toBe("other");
  });

  it("distinguishes session readiness from optional release capabilities", async () => {
    const contract = {
      profile: "test",
      services: {
        asr: {
          requiredForSession: true,
          requiredForRelease: true,
          expected: { service: "asr-service" },
        },
        speaker: {
          requiredForSession: false,
          requiredForRelease: true,
          expected: { service: "speaker-service" },
        },
      },
    };
    const evidence = await probeRuntimeContract({
      contract,
      generatedAt: "2026-08-24T00:00:00.000Z",
      urls: {
        asr: "data:application/json,%7B%22service%22%3A%22asr-service%22%7D",
        speaker: "data:application/json,%7B%22service%22%3A%22wrong%22%7D",
      },
    });

    expect(evidence.sessionReady).toBe(true);
    expect(evidence.releaseReady).toBe(false);
    expect(evidence.services.speaker.ok).toBe(false);
  });

  it("rejects a gateway that is healthy but has no traceable runtime identity", async () => {
    const contract = {
      profile: "test",
      services: {
        gateway: {
          requiredForSession: true,
          requiredForRelease: true,
          requiredTraceableRuntime: true,
          expected: { service: "realtime-gateway" },
        },
      },
    };
    const evidence = await probeRuntimeContract({
      contract,
      generatedAt: "2026-08-24T00:00:00.000Z",
      urls: {
        gateway: "data:application/json,%7B%22service%22%3A%22realtime-gateway%22%7D",
      },
    });

    expect(evidence.releaseReady).toBe(false);
    expect(evidence.services.gateway.issues).toContain(
      "runtimeIdentity: missing or not traceable",
    );
  });

  it("fingerprints dirty source while excluding outputs from candidate input", () => {
    const directory = mkdtempSync(join(tmpdir(), "wujie-manifest-"));
    temporaryDirectories.push(directory);
    execFileSync("git", ["init", "-q"], { cwd: directory });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: directory });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: directory });
    mkdirSync(join(directory, "release/domestic"), { recursive: true });
    writeFileSync(join(directory, "release/domestic/wujie-v1-runtime-contract.json"), "{}\n");
    writeFileSync(join(directory, "tracked.txt"), "before\n");
    execFileSync("git", ["add", "."], { cwd: directory });
    execFileSync("git", ["commit", "-qm", "baseline"], { cwd: directory });
    writeFileSync(join(directory, "tracked.txt"), "after\n");
    mkdirSync(join(directory, "outputs"));
    writeFileSync(join(directory, "outputs/evidence.json"), "{}\n");

    const manifest = buildCandidateManifest({
      cwd: directory,
      generatedAt: "2026-08-24T00:00:00.000Z",
    });

    expect(manifest.source.dirty).toBe(true);
    expect(manifest.source.outputsExcluded).toBe(1);
    expect(manifest.eligibility.productionEligible).toBe(false);
  });
});
