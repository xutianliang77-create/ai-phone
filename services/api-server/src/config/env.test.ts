import { afterEach, describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

describe("API server env", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("configures the server bind address", () => {
    process.env = { API_BIND_HOST: "10.20.30.40" };

    expect(loadEnv().apiHost).toBe("10.20.30.40");
  });
});
