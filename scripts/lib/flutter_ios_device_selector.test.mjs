import { describe, expect, test } from "vitest";
import { selectFlutterIosDevice } from "./flutter_ios_device_selector.mjs";

describe("selectFlutterIosDevice", () => {
  test("selects the only ready real iOS device", () => {
    const result = selectFlutterIosDevice([realDevice()]);

    expect(result).toEqual({ selectedId: "iphone-1", errors: [] });
  });

  test("rejects simulator unless explicitly allowed", () => {
    const result = selectFlutterIosDevice([simulatorDevice()], {
      requested: "iPhone 17 Pro",
    });

    expect(result.selectedId).toBeNull();
    expect(result.errors.join(" ")).toContain("ALLOW_IOS_SIMULATOR=true");
  });

  test("allows simulator dry runs when requested", () => {
    const result = selectFlutterIosDevice([simulatorDevice()], {
      requested: "iPhone 17 Pro",
      allowSimulator: true,
    });

    expect(result.selectedId).toBe("sim-1");
  });

  test("rejects iOS versions below FluidAudio minimum", () => {
    const result = selectFlutterIosDevice([
      { ...realDevice(), sdk: "iOS 16.7" },
    ]);

    expect(result.selectedId).toBeNull();
    expect(result.errors.join(" ")).toContain("requires iOS 17.0 or newer");
  });
});

function realDevice() {
  return {
    id: "iphone-1",
    name: "Wha's iPhone",
    targetPlatform: "ios",
    emulator: false,
    sdk: "iOS 26.3",
  };
}

function simulatorDevice() {
  return {
    id: "sim-1",
    name: "iPhone 17 Pro",
    targetPlatform: "ios",
    emulator: true,
    sdk: "iOS 26.2",
  };
}
