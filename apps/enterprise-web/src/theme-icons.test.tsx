import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MaterialIcon } from "./components/MaterialIcon.js";
import { enterpriseIcons } from "./icon-registry.js";

const tokensCss = readFileSync("src/styles/tokens.css", "utf8");
const flutterTheme = readFileSync("../mobile/lib/src/app/theme.dart", "utf8");
const packageJson = readFileSync("package.json", "utf8");

describe("enterprise theme and icon contract", () => {
  it("matches the Flutter light and dark semantic colors", () => {
    const colors = [
      ["087a70", "087A70"], ["62d7ca", "62D7CA"],
      ["c4574e", "C4574E"], ["ffb0a6", "FFB0A6"],
      ["4f6498", "4F6498"], ["b9c5ff", "B9C5FF"],
      ["f7f9f8", "F7F9F8"], ["0c1110", "0C1110"],
      ["17201e", "17201E"], ["e3e8e6", "E3E8E6"],
      ["697572", "697572"], ["87918e", "87918E"],
      ["d2dcda", "D2DCDA"], ["394542", "394542"],
      ["c34c43", "C34C43"], ["ffb4ab", "FFB4AB"],
    ];
    for (const [cssHex, flutterHex] of colors) {
      expect(tokensCss).toContain(`#${cssHex}`);
      expect(flutterTheme).toContain(`0xFF${flutterHex}`);
    }
  });

  it("registers the shared type, radius, control and icon sizes", () => {
    expect(tokensCss).toContain("--radius: 8px");
    expect(tokensCss).toContain("--font-headline-small-size: 1.5rem");
    expect(tokensCss).toContain("--font-body-medium-size: 0.875rem");
    expect(tokensCss).toContain("--control-height: 3rem");
    expect(tokensCss).toContain("--touch-target: 2.75rem");
    expect(tokensCss).toContain("--icon-size: 1.25rem");
    expect(flutterTheme).toContain("BorderRadius.circular(8)");
    expect(flutterTheme).toContain("fontSize: 24");
    expect(flutterTheme).toContain("fontSize: 14");
  });

  it("contains all nine Material navigation semantics and no second icon library", () => {
    expect(Object.keys(enterpriseIcons.navigation)).toEqual([
      "dashboard", "campaigns", "support", "meetings", "contacts",
      "knowledge", "analytics", "audit", "settings",
    ]);
    expect(packageJson).not.toMatch(/lucide|fontawesome|heroicons|react-icons/i);
    expect(packageJson).toContain("@fontsource/material-icons");
    expect(packageJson).toContain("@fontsource/material-icons-outlined");
  });

  it("renders outlined and filled variants with an accessible label", () => {
    const { rerender } = render(
      <MaterialIcon name={enterpriseIcons.navigation.meetings.outlined} label="会议" />,
    );
    expect(screen.getByLabelText("会议")).toHaveClass("material-icons-outlined");

    rerender(
      <MaterialIcon
        name={enterpriseIcons.navigation.meetings.filled}
        outlined={false}
        label="会议"
      />,
    );
    expect(screen.getByLabelText("会议")).toHaveClass("material-icons");
  });
});
