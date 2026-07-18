import { describe, expect, it } from "vitest";
import {
  prepareEnterpriseKnowledgeChunks,
  validateEnterpriseKnowledgeDimensions,
  validateEnterpriseKnowledgePublishTime,
} from "./enterprise-knowledge.js";

describe("enterprise knowledge values", () => {
  it("builds stable per-chunk and aggregate hashes", () => {
    const input = [
      { blockId: "intro", content: "产品保修期为两年。" },
      { blockId: "contact", content: "人工客服工作时间为 09:00-18:00。" },
    ];

    const first = prepareEnterpriseKnowledgeChunks(input);
    const second = prepareEnterpriseKnowledgeChunks(input);

    expect(first).toEqual(second);
    expect(first.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.chunks.map(({ sequence, contentHash }) => ({ sequence, contentHash })))
      .toEqual([
        { sequence: 1, contentHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
        { sequence: 2, contentHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
      ]);
  });

  it("rejects duplicate blocks and invalid retrieval dimensions", () => {
    expect(() => prepareEnterpriseKnowledgeChunks([
      { blockId: "same", content: "one" },
      { blockId: "same", content: "two" },
    ])).toThrow("Duplicate");
    expect(() => validateEnterpriseKnowledgeDimensions({
      locale: "zh_CN", countryCode: "China", productCode: "Phone Pro",
    })).toThrow("dimensions");
  });

  it("rejects publication windows ending before they become effective", () => {
    expect(() => validateEnterpriseKnowledgePublishTime({
      versionId: "version-1",
      expectedVersion: 2,
      publishedAt: "2026-07-18T10:00:00.000Z",
      effectiveFrom: "2026-07-18T10:10:00.000Z",
      expiresAt: "2026-07-18T10:09:59.000Z",
    })).toThrow("publication window");
  });
});
