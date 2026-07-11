import process from "node:process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  getReleaseMaterialsReadiness,
  getReleaseMaterialsReadinessForFile,
} from "./release-materials-readiness.js";

const args = process.argv.slice(2);
const help = takeFlag("--help") || takeFlag("-h");
const json = takeFlag("--json");
const file =
  valueFlag("--file") ??
  process.env.RELEASE_MATERIALS_FILE ??
  defaultReleaseMaterialsFile();

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}

const result = file
  ? getReleaseMaterialsReadinessForFile(resolve(file))
  : getReleaseMaterialsReadiness();

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else if (result.status === "ready") {
  console.log("Domestic release materials readiness passed.");
} else {
  console.error(
    `Domestic release materials readiness failed: ${result.issues.join("; ")}`,
  );
  for (const item of result.checkedItems) console.error(`checked: ${item}`);
}

if (result.status !== "ready") process.exit(1);

function takeFlag(flag: string) {
  const index = args.indexOf(flag);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function valueFlag(flag: string) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("-"))
    throw new Error(`${flag} requires a value`);
  args.splice(index, 2);
  return value;
}

function usage() {
  console.log(`Usage:
  npm run check:domestic-release-materials -- --file release/domestic/release-materials.json
  npm run check:domestic-release-materials -- --json

Verifies domestic app store release materials:
- App identity, legal entity and APP ICP filing; 京ICP备00000000号-1A is accepted as the current development placeholder
- Privacy policy, user agreement, refund policy and account deletion URL
- SDK list, model provider list and keywords
- At least 3 iOS and 3 Android screenshots, HTTPS screenshot URLs and local PNG/JPEG files with readable dimensions
- Privacy labels, customer support, release owner and rollback plan
- Gray release plan and initial gray percent from 1 to 20
- Domestic baseline alignment for cn.qkxy.realtimeinterpreter, 北京乾坤祥云科技有限公司, support@qkxy.cn and app.qkxy.cn legal URLs`);
}

function defaultReleaseMaterialsFile() {
  const file = "release/domestic/release-materials.json";
  return existsSync(resolve(file)) ? file : "";
}
