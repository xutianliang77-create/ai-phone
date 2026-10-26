#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { checkIosDistribution } from "./lib/ios_distribution_policy.mjs";

const app = process.argv[2];
if (!app) throw new Error("An explicit candidate App path is required");
const channel = process.env.DISTRIBUTION_CHANNEL ?? "restricted_instance";
let input = { channel };
if (channel === "app_store") {
  execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", app], { stdio: "pipe" });
  const profileBytes = execFileSync("/usr/bin/security", ["cms", "-D", "-i", path.join(app, "embedded.mobileprovision")]);
  const signedBytes = execFileSync("/usr/bin/codesign", ["-d", "--entitlements", "-", "--xml", app], { stdio: ["ignore", "pipe", "ignore"] });
  const signingDetails = spawnSync("/usr/bin/codesign", ["-dv", "--verbose=4", app], { encoding: "utf8" });
  if (signingDetails.status !== 0) throw new Error("Could not inspect candidate signing authority");
  input = { channel, info: plist(readFileSync(path.join(app, "Info.plist"))),
    profile: plist(profileBytes), signedEntitlements: plist(signedBytes),
    signingIdentity: signingDetails.stderr.match(/^Authority=(.+)$/m)?.[1],
    buildMode: process.env.BUILD_MODE, productProfile: process.env.PRODUCT_PROFILE };
}
const result = checkIosDistribution(input);
console.log(JSON.stringify(result, null, 2));
if (result.status !== "ready") process.exitCode = 1;

function plist(bytes) {
  return JSON.parse(execFileSync("/usr/bin/python3", ["-c",
    "import json,plistlib,sys,datetime; d=plistlib.loads(sys.stdin.buffer.read()); print(json.dumps(d,default=lambda x: x.isoformat()+'Z' if isinstance(x,datetime.datetime) else None))"], { input: bytes, encoding: "utf8" }));
}
