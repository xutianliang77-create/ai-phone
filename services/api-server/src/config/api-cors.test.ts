import { describe, expect, it, vi } from "vitest";
import { apiCorsOrigin, parseAllowedOrigins } from "./api-cors.js";

describe("API CORS origin policy", () => {
  it("disables browser CORS by default in production", () => {
    expect(apiCorsOrigin({ NODE_ENV: "production" })).toBe(false);
  });

  it("allows only loopback browser origins by default outside production", () => {
    const origin = apiCorsOrigin({ NODE_ENV: "development" });
    expect(typeof origin).toBe("function");
    const callback = vi.fn();
    if (typeof origin === "function") {
      origin("http://localhost:5173", callback);
      origin("https://attacker.example", callback);
    }
    expect(callback).toHaveBeenNthCalledWith(1, null, true);
    expect(callback).toHaveBeenNthCalledWith(2, null, false);
  });

  it("uses an exact configured allowlist", () => {
    const origin = apiCorsOrigin({
      NODE_ENV: "production",
      API_CORS_ALLOWED_ORIGINS: "https://enterprise.example.com",
    });
    const callback = vi.fn();
    if (typeof origin === "function") {
      origin("https://enterprise.example.com", callback);
      origin("https://sub.enterprise.example.com", callback);
    }
    expect(callback).toHaveBeenNthCalledWith(1, null, true);
    expect(callback).toHaveBeenNthCalledWith(2, null, false);
  });

  it("rejects wildcard, URL paths and duplicates", () => {
    expect(() => parseAllowedOrigins("*")).toThrow("wildcard");
    expect(() => parseAllowedOrigins("https://example.com/path")).toThrow("Invalid");
    expect(() => parseAllowedOrigins("https://example.com,https://example.com"))
      .toThrow("duplicates");
  });
});
