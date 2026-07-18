import { useState, type FormEvent } from "react";
import type { EnterpriseTermEntryDto, EnterpriseTerminologyPurpose } from "@translation/contracts";
import type {
  ContentKind,
  ContentStageInput,
  ResourceCreateInput,
  VersionCreateInput,
} from "../enterprise-content.js";
import type { EnterprisePublicationInput } from "../api/enterprise-api.js";

const purposes: EnterpriseTerminologyPurpose[] = ["all", "marketing", "support", "meeting"];

export function ResourceCreateForm({
  kind, busy, onCancel, onSubmit,
}: {
  kind: ContentKind;
  busy: boolean;
  onCancel(): void;
  onSubmit(input: ResourceCreateInput): Promise<void>;
}) {
  const [name, setName] = useState("");
  const [option, setOption] = useState("all");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const input = kind === "knowledge"
      ? { kind, name, sourceType: option === "all" ? "text" : option } as ResourceCreateInput
      : kind === "scripts"
      ? { kind, name, purpose: option as EnterpriseTerminologyPurpose } as ResourceCreateInput
      : { kind, name } as ResourceCreateInput;
    void onSubmit(input);
  };
  return (
    <form className="content-form" onSubmit={submit}>
      <h3>新建稳定资源</h3>
      <label><span>名称</span><input required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} /></label>
      {kind === "knowledge" ? (
        <label><span>来源类型</span><select value={option === "all" ? "text" : option} onChange={(e) => setOption(e.target.value)}>
          <option value="text">文本</option><option value="upload">上传</option>
          <option value="url">URL</option><option value="integration">集成</option>
        </select></label>
      ) : kind === "scripts" ? (
        <PurposeSelect value={option as EnterpriseTerminologyPurpose} onChange={setOption} label="使用用途" />
      ) : null}
      <FormActions busy={busy} submitLabel="创建资源" onCancel={onCancel} />
    </form>
  );
}

export function VersionCreateForm({
  kind, busy, onCancel, onSubmit,
}: {
  kind: ContentKind;
  busy: boolean;
  onCancel(): void;
  onSubmit(input: VersionCreateInput): Promise<void>;
}) {
  const [sourceLocale, setSourceLocale] = useState("zh-CN");
  const [targetLocale, setTargetLocale] = useState("en-US");
  const [countryCode, setCountryCode] = useState("CN");
  const [productCode, setProductCode] = useState("");
  const [purpose, setPurpose] = useState<EnterpriseTerminologyPurpose>("all");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const common = { countryCode, productCode };
    void onSubmit(kind === "terms"
      ? { kind, ...common, sourceLocale, targetLocale, usageScope: purpose }
      : { kind, ...common, locale: sourceLocale });
  };
  return (
    <form className="content-form" onSubmit={submit}>
      <h3>新建草稿修订</h3>
      <div className="content-form__grid">
        <label><span>{kind === "terms" ? "源语言" : "语言"}</span><input required value={sourceLocale} onChange={(e) => setSourceLocale(e.target.value)} /></label>
        {kind === "terms" ? <label><span>目标语言</span><input required value={targetLocale} onChange={(e) => setTargetLocale(e.target.value)} /></label> : null}
        <label><span>国家/区域</span><input required maxLength={3} value={countryCode} onChange={(e) => setCountryCode(e.target.value)} /></label>
        <label><span>产品代码</span><input required placeholder="例如 product-cn" value={productCode} onChange={(e) => setProductCode(e.target.value)} /></label>
        {kind === "terms" ? <PurposeSelect value={purpose} onChange={(value) => setPurpose(value as EnterpriseTerminologyPurpose)} label="使用范围" /> : null}
      </div>
      <FormActions busy={busy} submitLabel="创建修订" onCancel={onCancel} />
    </form>
  );
}

export function ContentReviewForm({
  kind, busy, onCancel, onSubmit,
}: {
  kind: ContentKind;
  busy: boolean;
  onCancel(): void;
  onSubmit(input: ContentStageInput): Promise<void>;
}) {
  const [primary, setPrimary] = useState("");
  const [required, setRequired] = useState("");
  const [prohibited, setProhibited] = useState("");
  const [variables, setVariables] = useState("");
  const [validation, setValidation] = useState<string>();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      const input = reviewInput(kind, primary, required, prohibited, variables);
      setValidation(undefined);
      void onSubmit(input);
    } catch (error) {
      setValidation(error instanceof Error ? error.message : "内容格式无效");
    }
  };
  return (
    <form className="content-form content-form--review" onSubmit={submit}>
      <h3>提交评审内容</h3>
      {kind === "knowledge" ? (
        <label><span>知识正文（空行分块，分块 ID 由页面稳定生成）</span><textarea required rows={8} value={primary} onChange={(e) => setPrimary(e.target.value)} /></label>
      ) : kind === "terms" ? (
        <label><span>术语 JSON 数组</span><textarea required rows={10} value={primary} onChange={(e) => setPrimary(e.target.value)} placeholder='[{"termId":"...","sourceText":"...","translatedText":"...","aliases":[],"caseSensitive":false,"protected":true}]' /></label>
      ) : (
        <>
          <label><span>话术正文</span><textarea required rows={6} value={primary} onChange={(e) => setPrimary(e.target.value)} /></label>
          <label><span>必说语（每行一条）</span><textarea rows={3} value={required} onChange={(e) => setRequired(e.target.value)} /></label>
          <label><span>禁语（每行一条）</span><textarea rows={3} value={prohibited} onChange={(e) => setProhibited(e.target.value)} /></label>
          <label><span>变量名（每行一项，首字母小写）</span><textarea rows={2} value={variables} onChange={(e) => setVariables(e.target.value)} /></label>
        </>
      )}
      {validation ? <p className="content-form__error" role="alert">{validation}</p> : null}
      <p className="content-form__notice">提交后进入只读评审状态；内容 hash 由服务端生成。</p>
      <FormActions busy={busy} submitLabel="提交评审" onCancel={onCancel} />
    </form>
  );
}

export function PublicationForm({
  revision, expectedVersion, busy, onCancel, onSubmit,
}: {
  revision: number;
  expectedVersion: number;
  busy: boolean;
  onCancel(): void;
  onSubmit(input: EnterprisePublicationInput): Promise<void>;
}) {
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [validation, setValidation] = useState<string>();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      const effective = effectiveFrom ? localIso(effectiveFrom) : undefined;
      const expires = expiresAt ? localIso(expiresAt) : undefined;
      if (effective && expires && Date.parse(expires) <= Date.parse(effective)) {
        throw new Error("失效时间必须晚于生效时间");
      }
      setValidation(undefined);
      void onSubmit({
        expectedVersion,
        ...(effective ? { effectiveFrom: effective } : {}),
        ...(expires ? { expiresAt: expires } : {}),
      });
    } catch (error) {
      setValidation(error instanceof Error ? error.message : "发布时间无效");
    }
  };
  return (
    <form className="content-form content-form--publish" onSubmit={submit}>
      <h3>发布修订 {revision}</h3>
      <div className="content-form__grid">
        <label><span>生效时间（留空立即生效）</span><input type="datetime-local" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} /></label>
        <label><span>失效时间（可选）</span><input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></label>
      </div>
      {validation ? <p className="content-form__error" role="alert">{validation}</p> : null}
      <p className="content-form__notice">发布使用当前服务端版本号；成功后内容成为不可变只读快照。</p>
      <FormActions busy={busy} submitLabel="确认发布" onCancel={onCancel} />
    </form>
  );
}

function PurposeSelect({ value, onChange, label }: {
  value: EnterpriseTerminologyPurpose;
  onChange(value: string): void;
  label: string;
}) {
  return <label><span>{label}</span><select value={value} onChange={(e) => onChange(e.target.value)}>
    {purposes.map((purpose) => <option key={purpose} value={purpose}>{purpose}</option>)}
  </select></label>;
}

function FormActions({ busy, submitLabel, onCancel }: { busy: boolean; submitLabel: string; onCancel(): void }) {
  return <div className="content-form__actions">
    <button className="button button--secondary" type="button" onClick={onCancel}>取消</button>
    <button className="button button--primary" disabled={busy}>{busy ? "提交中…" : submitLabel}</button>
  </div>;
}

function reviewInput(
  kind: ContentKind,
  primary: string,
  required: string,
  prohibited: string,
  variables: string,
): ContentStageInput {
  if (kind === "knowledge") {
    const blocks = primary.split(/\n\s*\n/).map((value) => value.trim()).filter(Boolean);
    if (blocks.length === 0 || blocks.length > 200) throw new Error("知识正文必须包含 1 到 200 个分块");
    return { kind, chunks: blocks.map((content, index) => ({ blockId: `block-${String(index + 1).padStart(3, "0")}`, content })) };
  }
  if (kind === "terms") {
    let terms: unknown;
    try {
      terms = JSON.parse(primary) as unknown;
    } catch {
      throw new Error("术语 JSON 格式无效");
    }
    if (!Array.isArray(terms) || terms.length === 0 || !terms.every(isTermEntry)) {
      throw new Error("术语必须是包含完整字段的非空 JSON 数组");
    }
    return { kind, terms };
  }
  return {
    kind,
    promptText: primary.trim(),
    requiredPhrases: lines(required),
    prohibitedPhrases: lines(prohibited),
    variables: lines(variables),
  };
}

function lines(value: string) {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
}

function localIso(value: string) {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) throw new Error("请输入有效日期时间");
  return timestamp.toISOString();
}

function isTermEntry(value: unknown): value is EnterpriseTermEntryDto {
  if (!value || typeof value !== "object") return false;
  const term = value as Partial<EnterpriseTermEntryDto>;
  return typeof term.termId === "string" && typeof term.sourceText === "string" &&
    typeof term.translatedText === "string" && Array.isArray(term.aliases) &&
    term.aliases.every((alias) => typeof alias === "string") &&
    typeof term.caseSensitive === "boolean" && typeof term.protected === "boolean";
}
