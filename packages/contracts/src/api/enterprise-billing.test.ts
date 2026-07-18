import { describe, expect, it } from "vitest";
import {
  enterpriseUsageCategories,
  enterpriseUsageUnits,
  isEnterpriseUsageCategory,
  isEnterpriseUsageUnit,
} from "./enterprise-billing.js";

describe("enterprise billing contracts", () => {
  it("accepts only declared usage categories and units", () => {
    for (const category of enterpriseUsageCategories) {
      expect(isEnterpriseUsageCategory(category)).toBe(true);
    }
    for (const unit of enterpriseUsageUnits) {
      expect(isEnterpriseUsageUnit(unit)).toBe(true);
    }
    expect(isEnterpriseUsageCategory("credits")).toBe(false);
    expect(isEnterpriseUsageUnit("currency")).toBe(false);
  });
});
