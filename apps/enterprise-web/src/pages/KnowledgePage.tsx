import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EnterpriseScope } from "@translation/contracts";
import type {
  EnterpriseApi,
  EnterpriseContentRequestContext,
  EnterprisePublicationInput,
} from "../api/enterprise-api.js";
import { EnterpriseApiError } from "../api/enterprise-api.js";
import { apiErrorState } from "../business-state.js";
import {
  contentKindPresentation,
  contentKinds,
  resourceMeta,
  statusLabel,
  versionCount,
  versionScope,
  type ContentCatalog,
  type ContentKind,
  type ContentResource,
  type ContentStageInput,
  type ContentVersion,
  type ResourceCreateInput,
  type VersionCreateInput,
} from "../enterprise-content.js";
import { enterpriseIcons } from "../icon-registry.js";
import { useAuth } from "../auth/AuthContext.js";
import {
  ContentReviewForm,
  PublicationForm,
  ResourceCreateForm,
  VersionCreateForm,
} from "../components/EnterpriseContentForms.js";
import { MaterialIcon } from "../components/MaterialIcon.js";
import { PageFrame } from "../components/PageFrame.js";
import { StatusPanel } from "../components/StatusPanel.js";

type LoadState = "loading" | "ready" | "failed";

export function KnowledgePage() {
  const { state, api } = useAuth();
  if (state.status !== "ready") return null;
  return (
    <KnowledgeWorkspace
      api={api}
      token={state.session.token}
      tenantId={state.context.tenant.id}
      routeDocument={state.routeDocument}
      scopes={state.context.scopes}
    />
  );
}

function KnowledgeWorkspace({
  api, token, tenantId, routeDocument, scopes,
}: {
  api: EnterpriseApi;
  token: string;
  tenantId: string;
  routeDocument: EnterpriseContentRequestContext["routeDocument"];
  scopes: readonly EnterpriseScope[];
}) {
  const requestContext = useMemo(
    () => ({ token, tenantId, routeDocument }),
    [routeDocument, tenantId, token],
  );
  const canPublish = scopes.includes("knowledge:publish");
  const [kind, setKind] = useState<ContentKind>("knowledge");
  const [catalog, setCatalog] = useState<ContentCatalog>();
  const [catalogState, setCatalogState] = useState<LoadState>("loading");
  const [catalogError, setCatalogError] = useState<unknown>();
  const [selected, setSelected] = useState<Partial<Record<ContentKind, string>>>({});
  const [versions, setVersions] = useState<ContentVersion[]>([]);
  const [versionsState, setVersionsState] = useState<LoadState>("ready");
  const [mutationError, setMutationError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<"resource" | "version" | "review" | "publish">();
  const [formVersion, setFormVersion] = useState<ContentVersion>();
  const versionRequestId = useRef(0);

  const loadCatalog = useCallback(async () => {
    setCatalogState("loading");
    setCatalogError(undefined);
    try {
      const [knowledge, terms, scripts] = await Promise.all([
        api.listKnowledgeSources(requestContext),
        api.listTermPacks(requestContext),
        api.listScriptTemplates(requestContext),
      ]);
      const next = {
        knowledge: knowledge.sources,
        terms: terms.termPacks,
        scripts: scripts.scriptTemplates,
      };
      setCatalog(next);
      setSelected((current) => ({
        knowledge: current.knowledge ?? next.knowledge[0]?.id,
        terms: current.terms ?? next.terms[0]?.id,
        scripts: current.scripts ?? next.scripts[0]?.id,
      }));
      setCatalogState("ready");
    } catch (error) {
      setCatalogError(error);
      setCatalogState("failed");
    }
  }, [api, requestContext]);

  useEffect(() => { void loadCatalog(); }, [loadCatalog]);

  const selectedId = selected[kind];
  const loadVersions = useCallback(async () => {
    const requestId = ++versionRequestId.current;
    if (!selectedId) {
      setVersions([]);
      setVersionsState("ready");
      return;
    }
    setVersionsState("loading");
    try {
      const result = kind === "knowledge"
        ? (await api.listKnowledgeVersions(requestContext, selectedId)).knowledgeVersions
        : kind === "terms"
        ? (await api.listTermPackVersions(requestContext, selectedId)).termPackVersions
        : (await api.listScriptTemplateVersions(requestContext, selectedId)).scriptTemplateVersions;
      if (requestId !== versionRequestId.current) return;
      setVersions([...result].sort((left, right) => right.revision - left.revision));
      setVersionsState("ready");
    } catch (error) {
      if (requestId !== versionRequestId.current) return;
      setMutationError(error);
      setVersionsState("failed");
    }
  }, [api, kind, requestContext, selectedId]);

  useEffect(() => {
    setForm(undefined);
    setFormVersion(undefined);
    setMutationError(undefined);
    void loadVersions();
  }, [loadVersions]);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setMutationError(undefined);
    try {
      await operation();
      setForm(undefined);
      setFormVersion(undefined);
    } catch (error) {
      setMutationError(error);
    } finally {
      setBusy(false);
    }
  };

  const createResource = (input: ResourceCreateInput) => run(async () => {
    const resource = input.kind === "knowledge"
      ? (await api.createKnowledgeSource(requestContext, input)).source
      : input.kind === "terms"
      ? (await api.createTermPack(requestContext, input)).termPack
      : (await api.createScriptTemplate(requestContext, input)).scriptTemplate;
    setCatalog((current) => current && ({
      ...current,
      [input.kind]: [resource, ...current[input.kind]],
    }));
    setSelected((current) => ({ ...current, [input.kind]: resource.id }));
  });

  const createVersion = (input: VersionCreateInput) => run(async () => {
    if (!selectedId) throw new Error("请先选择稳定资源");
    const version = input.kind === "knowledge"
      ? (await api.createKnowledgeVersion(requestContext, selectedId, input)).knowledgeVersion
      : input.kind === "terms"
      ? (await api.createTermPackVersion(requestContext, selectedId, input)).termPackVersion
      : (await api.createScriptTemplateVersion(requestContext, selectedId, input)).scriptTemplateVersion;
    setVersions((current) => [version, ...current]);
  });

  const stageVersion = (input: ContentStageInput) => run(async () => {
    if (!formVersion) throw new Error("未选择草稿修订");
    const expectedVersion = formVersion.version;
    const version = input.kind === "knowledge"
      ? (await api.stageKnowledgeVersion(requestContext, formVersion.id, { expectedVersion, chunks: input.chunks })).knowledgeVersion
      : input.kind === "terms"
      ? (await api.stageTermPackVersion(requestContext, formVersion.id, { expectedVersion, terms: input.terms })).termPackVersion
      : (await api.stageScriptTemplateVersion(requestContext, formVersion.id, {
          expectedVersion,
          promptText: input.promptText,
          requiredPhrases: input.requiredPhrases,
          prohibitedPhrases: input.prohibitedPhrases,
          variables: input.variables,
        })).scriptTemplateVersion;
    replaceVersion(setVersions, version);
  });

  const publishVersion = (input: EnterprisePublicationInput) => run(async () => {
    if (!formVersion) throw new Error("未选择待发布修订");
    const version = kind === "knowledge"
      ? (await api.publishKnowledgeVersion(requestContext, formVersion.id, input)).knowledgeVersion
      : kind === "terms"
      ? (await api.publishTermPackVersion(requestContext, formVersion.id, input)).termPackVersion
      : (await api.publishScriptTemplateVersion(requestContext, formVersion.id, input)).scriptTemplateVersion;
    replaceVersion(setVersions, version);
  });

  const resources = catalog?.[kind] ?? [];
  return (
    <PageFrame
      title="知识与术语"
      description="稳定资源、不可变修订、评审与发布均使用服务端真实状态"
      action={canPublish ? (
        <button className="button button--primary" disabled={busy} onClick={() => setForm("resource")}>
          <MaterialIcon name={enterpriseIcons.action.create} />新建{contentKindPresentation[kind].singular}
        </button>
      ) : undefined}
    >
      <ContentTabs kind={kind} catalog={catalog} disabled={busy} onChange={setKind} />
      {catalogState === "loading" ? <StatusPanel state="loading" description="正在读取租户知识源、术语包和话术模板。" /> : null}
      {catalogState === "failed" ? (
        <ContentError error={catalogError} action={<button className="button button--secondary" onClick={() => void loadCatalog()}>重试</button>} />
      ) : null}
      {catalogState === "ready" ? (
        <>
          {mutationError && versionsState !== "failed" ? <ContentError error={mutationError} /> : null}
          {form === "resource" ? <ResourceCreateForm kind={kind} busy={busy} onCancel={() => setForm(undefined)} onSubmit={createResource} /> : null}
          {resources.length === 0 ? (
            <StatusPanel state="empty" description={`当前企业没有${contentKindPresentation[kind].label}。`} />
          ) : (
            <div className="content-workbench">
              <ResourceList kind={kind} resources={resources} selectedId={selectedId} disabled={busy} onSelect={(id) => setSelected((current) => ({ ...current, [kind]: id }))} />
              <section className="version-panel" aria-label={`${contentKindPresentation[kind].label}修订`}>
                <header className="version-panel__header">
                  <div><h2>版本与生效范围</h2><p>草稿 → 评审 → 发布；发布后只读</p></div>
                  {canPublish && selectedId ? <button className="button button--secondary" disabled={busy} onClick={() => setForm("version")}><MaterialIcon name={enterpriseIcons.action.version} />新建修订</button> : null}
                </header>
                {form === "version" ? <VersionCreateForm kind={kind} busy={busy} onCancel={() => setForm(undefined)} onSubmit={createVersion} /> : null}
                {form === "review" && formVersion ? <ContentReviewForm kind={kind} busy={busy} onCancel={() => setForm(undefined)} onSubmit={stageVersion} /> : null}
                {form === "publish" && formVersion ? <PublicationForm revision={formVersion.revision} expectedVersion={formVersion.version} busy={busy} onCancel={() => setForm(undefined)} onSubmit={publishVersion} /> : null}
                {versionsState === "loading" ? <StatusPanel state="loading" description="正在读取版本与服务端发布状态。" /> : null}
                {versionsState === "failed" ? <ContentError error={mutationError} /> : null}
                {versionsState === "ready" && versions.length === 0 ? <StatusPanel state="empty" description="该稳定资源还没有修订。" /> : null}
                {versionsState === "ready" ? <VersionList versions={versions} canPublish={canPublish} busy={busy} onReview={(version) => { setFormVersion(version); setForm("review"); }} onPublish={(version) => { setFormVersion(version); setForm("publish"); }} /> : null}
              </section>
            </div>
          )}
        </>
      ) : null}
    </PageFrame>
  );
}

function ContentTabs({ kind, catalog, disabled, onChange }: { kind: ContentKind; catalog?: ContentCatalog; disabled: boolean; onChange(kind: ContentKind): void }) {
  return <div className="content-tabs" role="tablist" aria-label="企业内容类型">
    {contentKinds.map((item) => {
      const presentation = contentKindPresentation[item];
      return <button key={item} role="tab" aria-selected={kind === item} disabled={disabled} className={kind === item ? "content-tab content-tab--active" : "content-tab"} onClick={() => onChange(item)}>
        <MaterialIcon name={enterpriseIcons.content[presentation.icon]} />
        <span>{presentation.label}<small>{catalog?.[item].length ?? "–"}</small></span>
      </button>;
    })}
  </div>;
}

function ResourceList({ kind, resources, selectedId, disabled, onSelect }: { kind: ContentKind; resources: ContentResource[]; selectedId?: string; disabled: boolean; onSelect(id: string): void }) {
  return <section className="resource-panel" aria-label={`${contentKindPresentation[kind].label}列表`}>
    <header><h2>{contentKindPresentation[kind].label}</h2><p>{contentKindPresentation[kind].description}</p></header>
    <div className="resource-list">{resources.map((resource) => (
      <button key={resource.id} disabled={disabled} className={resource.id === selectedId ? "resource-item resource-item--active" : "resource-item"} onClick={() => onSelect(resource.id)}>
        <span><strong>{resource.name}</strong><small>{resourceMeta(kind, resource)} · {resource.status}</small></span>
        <MaterialIcon name="chevron_right" />
      </button>
    ))}</div>
  </section>;
}

function VersionList({ versions, canPublish, busy, onReview, onPublish }: { versions: ContentVersion[]; canPublish: boolean; busy: boolean; onReview(version: ContentVersion): void; onPublish(version: ContentVersion): void }) {
  return <div className="version-list">{versions.map((version) => (
    <article className="version-card" key={version.id}>
      <div className="version-card__title"><strong>修订 {version.revision}</strong><span className={`version-status version-status--${version.status}`}>{statusLabel(version.status)}</span></div>
      <p>{versionScope(version)}</p><small>{versionCount(version)}</small>
      {"usageScope" in version ? <small>使用范围：{version.usageScope}</small> : null}
      {version.contentHash ? <small title={version.contentHash}>内容 hash：{version.contentHash.slice(0, 12)}…</small> : <small>内容 hash：尚未生成</small>}
      {version.effectiveFrom ? <small>生效：{formatDate(version.effectiveFrom)}{version.expiresAt ? `，失效：${formatDate(version.expiresAt)}` : ""}</small> : null}
      <p className="version-card__truth">{version.status === "published" ? "已发布，只读快照" : version.status === "expired" ? "已过期，不参与运行时解析" : version.status === "review" ? "内容已锁定，等待发布" : version.status === "draft" ? "草稿尚未进入运行时" : "当前状态不参与运行时解析"}</p>
      {canPublish && version.status === "draft" ? <button className="button button--secondary" disabled={busy} onClick={() => onReview(version)}><MaterialIcon name={enterpriseIcons.action.review} />提交内容评审</button> : null}
      {canPublish && version.status === "review" ? <button className="button button--primary" disabled={busy} onClick={() => onPublish(version)}><MaterialIcon name={enterpriseIcons.action.publish} />发布修订 {version.revision}</button> : null}
    </article>
  ))}</div>;
}

function ContentError({ error, action }: { error: unknown; action?: React.ReactNode }) {
  const apiError = error instanceof EnterpriseApiError ? error : undefined;
  const description = apiError?.code === "enterprise_postgres_required"
    ? "企业 PostgreSQL runtime 尚未就绪，未回退到 SQLite/JSON，也未显示伪造内容。"
    : apiError?.status === 403
    ? "服务端拒绝当前角色访问此租户内容。"
    : apiError?.status === 409 || apiError?.status === 412
    ? "服务端版本已变化，请重新读取后再提交。"
    : "企业内容请求失败，未显示或写入本地替代数据。";
  return <StatusPanel state={apiErrorState(error)} description={description} traceId={apiError?.traceId} action={action} />;
}

function replaceVersion(setVersions: React.Dispatch<React.SetStateAction<ContentVersion[]>>, version: ContentVersion) {
  setVersions((current) => current.map((item) => item.id === version.id ? version : item));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
