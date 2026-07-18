import { vi } from "vitest";
import type { EnterpriseApi } from "../api/enterprise-api.js";

type ContentApi = Pick<EnterpriseApi,
  | "listKnowledgeSources" | "createKnowledgeSource"
  | "listKnowledgeVersions" | "createKnowledgeVersion"
  | "stageKnowledgeVersion" | "publishKnowledgeVersion"
  | "listTermPacks" | "createTermPack"
  | "listTermPackVersions" | "createTermPackVersion"
  | "stageTermPackVersion" | "publishTermPackVersion"
  | "listScriptTemplates" | "createScriptTemplate"
  | "listScriptTemplateVersions" | "createScriptTemplateVersion"
  | "stageScriptTemplateVersion" | "publishScriptTemplateVersion"
>;

export function fakeEnterpriseContentApi(): ContentApi {
  return {
    listKnowledgeSources: vi.fn().mockResolvedValue({ sources: [] }),
    createKnowledgeSource: vi.fn(),
    listKnowledgeVersions: vi.fn().mockResolvedValue({ knowledgeVersions: [] }),
    createKnowledgeVersion: vi.fn(),
    stageKnowledgeVersion: vi.fn(),
    publishKnowledgeVersion: vi.fn(),
    listTermPacks: vi.fn().mockResolvedValue({ termPacks: [] }),
    createTermPack: vi.fn(),
    listTermPackVersions: vi.fn().mockResolvedValue({ termPackVersions: [] }),
    createTermPackVersion: vi.fn(),
    stageTermPackVersion: vi.fn(),
    publishTermPackVersion: vi.fn(),
    listScriptTemplates: vi.fn().mockResolvedValue({ scriptTemplates: [] }),
    createScriptTemplate: vi.fn(),
    listScriptTemplateVersions: vi.fn().mockResolvedValue({ scriptTemplateVersions: [] }),
    createScriptTemplateVersion: vi.fn(),
    stageScriptTemplateVersion: vi.fn(),
    publishScriptTemplateVersion: vi.fn(),
  };
}
