import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { pageStates, pageStateRegistry } from "../page-state-registry.js";
import { StatusPanel } from "./StatusPanel.js";

describe("enterprise unified page states", () => {
  it.each(pageStates)("renders an actionable %s state without a blank panel", (state) => {
    const presentation = pageStateRegistry[state];
    const { container } = render(
      <StatusPanel
        state={state}
        description={`${state} 状态说明`}
        traceId="trace-safe-001"
        action={<button>返回工作台</button>}
      />,
    );

    const panel = container.querySelector(`[data-page-state="${state}"]`);
    expect(panel).toBeVisible();
    expect(screen.getByRole("heading", { name: presentation.title })).toBeVisible();
    expect(screen.getByText(`${state} 状态说明`)).toBeVisible();
    expect(screen.getByText("trace-safe-001")).toBeVisible();
    expect(screen.getByRole("button", { name: "返回工作台" })).toBeEnabled();
  });

  it("does not expose a success state that could mask missing provider evidence", () => {
    expect(pageStates).toEqual([
      "loading", "empty", "not_ready", "degraded", "forbidden",
      "conflict", "processing", "failed",
    ]);
    expect(pageStates).not.toContain("success");
  });
});
