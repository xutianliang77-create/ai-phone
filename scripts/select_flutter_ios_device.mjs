#!/usr/bin/env node
import { readFileSync } from "node:fs";
import process from "node:process";
import { selectFlutterIosDevice } from "./lib/flutter_ios_device_selector.mjs";

let devices;
try {
  devices = JSON.parse(readFileSync(0, "utf8"));
} catch (error) {
  console.error(`Unable to parse Flutter devices JSON: ${error.message}`);
  process.exit(2);
}

const result = selectFlutterIosDevice(devices, {
  requested: process.env.DEVICE_ID ?? "",
  allowSimulator: process.env.ALLOW_IOS_SIMULATOR === "true",
});

if (!result.selectedId) {
  for (const error of result.errors) console.error(error);
  process.exit(2);
}

console.log(result.selectedId);
