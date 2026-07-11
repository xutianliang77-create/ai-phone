#!/usr/bin/env node
import os from "node:os";
import process from "node:process";
import { detectMacLanIp } from "./lib/mac_lan_ip.mjs";

const args = process.argv.slice(2);
const json = takeFlag("--json");
const help = takeFlag("--help") || takeFlag("-h");

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}

const result = detectMacLanIp({
  interfaces: os.networkInterfaces(),
  preferredInterface: process.env.MAC_LAN_INTERFACE ?? "",
});

if (!result) {
  console.error(
    "No usable non-loopback IPv4 address was detected. Set MAC_LAN_IP manually.",
  );
  process.exit(2);
}

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(result.address);
}

function takeFlag(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function usage() {
  console.log(`Usage:
  scripts/detect_mac_lan_ip.mjs [--json]

Prints the Mac LAN IPv4 address used by physical iPhone smoke tests.
Set MAC_LAN_INTERFACE=en0/en1/... to prefer a specific interface, or set
MAC_LAN_IP directly in the caller to bypass auto-detection.`);
}
