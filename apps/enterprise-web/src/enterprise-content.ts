import type {
  EnterpriseKnowledgeSourceDto,
  EnterpriseKnowledgeVersionDto,
  EnterpriseScriptTemplateDto,
  EnterpriseScriptTemplateVersionDto,
  EnterpriseTermEntryDto,
  EnterpriseTermPackDto,
  EnterpriseTermPackVersionDto,
  EnterpriseTerminologyPurpose,
} from "@translation/contracts";

export const contentKinds = ["knowledge", "terms", "scripts"] as const;
export type ContentKind = typeof contentKinds[number];

export type ContentResource = EnterpriseKnowledgeSourceDto |
  EnterpriseTermPackDto | EnterpriseScriptTemplateDto;

export type ContentVersion = EnterpriseKnowledgeVersionDto |
  EnterpriseTermPackVersionDto | EnterpriseScriptTemplateVersionDto;

export interface ContentCatalog {
  knowledge: EnterpriseKnowledgeSourceDto[];
  terms: EnterpriseTermPackDto[];
  scripts: EnterpriseScriptTemplateDto[];
}

export type ResourceCreateInput =
  | { kind: "knowledge"; name: string; sourceType: "upload" | "url" | "text" | "integration" }
  | { kind: "terms"; name: string }
  | { kind: "scripts"; name: string; purpose: EnterpriseTerminologyPurpose };

export type VersionCreateInput =
  | { kind: "knowledge"; locale: string; countryCode: string; productCode: string }
  | {
      kind: "terms";
      sourceLocale: string;
      targetLocale: string;
      countryCode: string;
      productCode: string;
      usageScope: EnterpriseTerminologyPurpose;
    }
  | { kind: "scripts"; locale: string; countryCode: string; productCode: string };

export type ContentStageInput =
  | { kind: "knowledge"; chunks: Array<{ blockId: string; content: string }> }
  | { kind: "terms"; terms: EnterpriseTermEntryDto[] }
  | {
      kind: "scripts";
      promptText: string;
      requiredPhrases: string[];
      prohibitedPhrases: string[];
      variables: string[];
    };

export const contentKindPresentation = {
  knowledge: {
    label: "知识源",
    singular: "知识源",
    description: "按语言、国家与产品发布可引用知识",
    icon: "source",
  },
  terms: {
    label: "术语包",
    singular: "术语包",
    description: "统一 ASR、翻译与 Agent 的企业术语",
    icon: "terms",
  },
  scripts: {
    label: "话术模板",
    singular: "话术模板",
    description: "管理营销、客服与会议使用的话术快照",
    icon: "script",
  },
} as const;

export function versionScope(version: ContentVersion) {
  if ("sourceLocale" in version) {
    return `${version.sourceLocale} → ${version.targetLocale} · ${version.countryCode} · ${version.productCode}`;
  }
  return `${version.locale} · ${version.countryCode} · ${version.productCode}`;
}

export function versionCount(version: ContentVersion) {
  if ("chunkCount" in version) return `${version.chunkCount} 个分块`;
  if ("termCount" in version) return `${version.termCount} 个术语 · ASR / 翻译 / Agent`;
  return `${version.requiredPhraseCount} 必说 · ${version.prohibitedPhraseCount} 禁语`;
}

export function resourceMeta(kind: ContentKind, resource: ContentResource) {
  if (kind === "knowledge" && "sourceType" in resource) return resource.sourceType;
  if (kind === "scripts" && "purpose" in resource) return resource.purpose;
  return "versioned";
}

export function statusLabel(status: ContentVersion["status"]) {
  return ({
    draft: "草稿",
    processing: "解析中",
    review: "待发布",
    published: "已发布",
    expired: "已过期",
    failed: "失败",
  } as const)[status];
}
