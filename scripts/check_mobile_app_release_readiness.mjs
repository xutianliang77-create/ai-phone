#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { checkMobileAppReleaseReadiness } from "./lib/mobile_app_release_readiness.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const help = takeFlag("--help") || takeFlag("-h");
const json = takeFlag("--json");

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}

const result = checkMobileAppReleaseReadiness(root);
if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.status === "ready") {
  console.log("Mobile app release readiness passed.");
} else {
  console.error(`Mobile app release readiness failed: ${result.issues.join("; ")}`);
  for (const check of result.checks) {
    console.error(`${check.status === "pass" ? "pass" : "fail"}: ${check.name}`);
  }
  for (const action of result.actions) console.error(`action: ${action}`);
}

if (result.status !== "ready") process.exit(1);

function takeFlag(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function usage() {
  console.log(`Usage:
  scripts/check_mobile_app_release_readiness.mjs [--json]

Verifies mobile app release metadata:
- Chinese interface and permission strings
- Compliance center support, refund, account deletion, and privacy feedback entries
- domestic default config
- iOS Apple IAP purchase and restore-purchase surface
- iOS LocalIdentity.xcconfig resolves to a real bundle id
- Android key.properties resolves to a real applicationId
- Android release manifest does not allow cleartext
- Android release build has non-debug signing properties
- Android release certificate subject includes 北京乾坤祥云科技有限公司`);
}
