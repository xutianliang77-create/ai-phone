import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EnterpriseSupportRagResponse } from "@translation/contracts";
import { useSearchParams } from "react-router-dom";
import type {
  EnterpriseSupportQueueDto,
  EnterpriseSupportWorkbenchDto,
  EnterpriseSupportWorkItemDto,
} from "../api/enterprise-support-api.js";
import type { EnterpriseContentRequestContext } from "../api/enterprise-api.js";
import { apiErrorState } from "../business-state.js";
import { useAuth } from "../auth/AuthContext.js";
import { PageFrame } from "../components/PageFrame.js";
import { StatusPanel } from "../components/StatusPanel.js";
import { SupportQueuePanel } from "../support/SupportQueuePanel.js";
import {
  SupportContextPanel,
  SupportConversationPanel,
} from "../support/SupportWorkbenchPanels.js";

type WorkbenchState =
  | { status: "idle" | "loading" }
  | { status: "ready"; data: EnterpriseSupportWorkbenchDto }
  | { status: "failed"; error: unknown };

export function SupportPage() {
  const { state, api } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [queues, setQueues] = useState<EnterpriseSupportQueueDto[]>([]);
  const [selectedQueueId, setSelectedQueueId] = useState("");
  const [workItems, setWorkItems] = useState<EnterpriseSupportWorkItemDto[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState<unknown>(null);
  const [workbench, setWorkbench] = useState<WorkbenchState>({ status: "idle" });
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [knowledge, setKnowledge] = useState<EnterpriseSupportRagResponse | null>(null);
  const [knowledgeSearching, setKnowledgeSearching] = useState(false);
  const renewing = useRef(false);
  const workbenchRef = useRef<EnterpriseSupportWorkbenchDto | null>(null);
  const claimKeys = useRef(new Map<string, string>());
  const releaseKeys = useRef(new Map<string, string>());
  const followupKeys = useRef(new Map<string, string>());
  const knowledgeRequest = useRef(0);
  if (state.status !== "ready") return null;
  const context = useMemo<EnterpriseContentRequestContext>(() => ({
    token: state.session.token,
    tenantId: state.context.tenant.id,
    routeDocument: state.routeDocument,
  }), [state.context.tenant.id, state.routeDocument, state.session.token]);
  const sessionId = searchParams.get("sessionId");

  const loadQueues = useCallback(async () => {
    setQueueLoading(true);
    setQueueError(null);
    try {
      const result = await api.listSupportQueues(context);
      setQueues(result.queues);
      setSelectedQueueId((current) => result.queues.some((item) => item.id === current)
        ? current : result.queues.find((item) => item.status === "active")?.id ||
          result.queues[0]?.id || "");
    } catch (error) {
      setQueueError(error);
    } finally {
      setQueueLoading(false);
    }
  }, [api, context]);

  const loadWorkItems = useCallback(async () => {
    if (!selectedQueueId) {
      setWorkItems([]);
      return;
    }
    setQueueLoading(true);
    try {
      const result = await api.listSupportWorkItems(context, selectedQueueId);
      setWorkItems(result.workItems);
      setQueueError(null);
    } catch (error) {
      setQueueError(error);
    } finally {
      setQueueLoading(false);
    }
  }, [api, context, selectedQueueId]);

  useEffect(() => { void loadQueues(); }, [loadQueues]);
  useEffect(() => { void loadWorkItems(); }, [loadWorkItems]);
  useEffect(() => {
    if (!selectedQueueId) return;
    const interval = window.setInterval(() => void loadWorkItems(), 5_000);
    return () => window.clearInterval(interval);
  }, [loadWorkItems, selectedQueueId]);

  useEffect(() => {
    if (!sessionId) {
      setWorkbench({ status: "idle" });
      return;
    }
    let active = true;
    setWorkbench({ status: "loading" });
    api.activateSupportWorkbench(context, sessionId).then((data) => {
      if (active) setWorkbench({ status: "ready", data });
    }).catch((error: unknown) => {
      if (active) setWorkbench({ status: "failed", error });
    });
    return () => { active = false; };
  }, [api, context, sessionId]);

  useEffect(() => {
    knowledgeRequest.current += 1;
    setKnowledge(null);
    setKnowledgeQuery("");
    setKnowledgeSearching(false);
  }, [sessionId]);

  useEffect(() => {
    workbenchRef.current = workbench.status === "ready" ? workbench.data : null;
  }, [workbench]);

  useEffect(() => {
    if (!sessionId || workbench.status !== "ready") return;
    const interval = window.setInterval(() => {
      api.getSupportWorkbench(context, sessionId).then((data) => {
        setWorkbench((current) => current.status === "ready"
          ? { status: "ready", data: mergeWorkbench(current.data, data) }
          : current);
      }).catch((error: unknown) => {
        if (terminalWorkbenchError(error)) setWorkbench({ status: "failed", error });
      });
    }, 2_500);
    return () => window.clearInterval(interval);
  }, [api, context, sessionId, workbench.status]);

  const renewClaim = useCallback(async (silent = false) => {
    const currentWorkbench = workbenchRef.current;
    if (!currentWorkbench || renewing.current) return;
    renewing.current = true;
    if (!silent) setBusy("renew");
    try {
      const result = await api.renewSupportClaim(
        context, currentWorkbench.claim.id, currentWorkbench.claim.version,
      );
      setWorkbench((current) => current.status === "ready" &&
        current.data.claim.id === result.claim.id &&
        result.claim.version >= current.data.claim.version
        ? { status: "ready", data: { ...current.data, claim: result.claim } }
        : current);
      if (!silent) setNotice("接管租约已按服务端队列时长续期。");
    } catch (error) {
      setNotice(`接管续租失败：${errorLabel(error)}`);
      if (terminalWorkbenchError(error)) setWorkbench({ status: "failed", error });
    } finally {
      renewing.current = false;
      if (!silent) setBusy(null);
    }
  }, [api, context]);

  useEffect(() => {
    if (workbench.status !== "ready") return;
    const remaining = Date.parse(workbench.data.claim.leaseExpiresAt) - Date.now();
    const delay = Math.max(5_000, Math.min(60_000, Math.floor(remaining / 2)));
    const timeout = window.setTimeout(() => void renewClaim(true), delay);
    return () => window.clearTimeout(timeout);
  }, [renewClaim, workbench.status,
    workbench.status === "ready" ? workbench.data.claim.id : null,
    workbench.status === "ready" ? workbench.data.claim.version : null,
    workbench.status === "ready" ? workbench.data.claim.leaseExpiresAt : null]);

  async function claim(item: EnterpriseSupportWorkItemDto) {
    if (busy) return;
    setBusy(`claim:${item.sessionId}`);
    setNotice(null);
    try {
      const idempotencyKey = claimKeys.current.get(item.sessionId) ??
        `web-claim:${crypto.randomUUID()}`;
      claimKeys.current.set(item.sessionId, idempotencyKey);
      await api.claimSupportSession(context, item.sessionId, {
        expectedSessionVersion: item.expectedSessionVersion,
        idempotencyKey,
      });
      claimKeys.current.delete(item.sessionId);
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.set("sessionId", item.sessionId);
        return next;
      });
      setNotice("已取得坐席租约；正在验证 AI 停播与媒体接入回执。");
      await loadWorkItems();
    } catch (error) {
      setNotice(`接管失败：${errorLabel(error)}`);
      await loadWorkItems();
    } finally {
      setBusy(null);
    }
  }

  async function releaseClaim() {
    if (busy || workbench.status !== "ready") return;
    setBusy("release");
    try {
      const claimId = workbench.data.claim.id;
      const idempotencyKey = releaseKeys.current.get(claimId) ??
        `web-release:${crypto.randomUUID()}`;
      releaseKeys.current.set(claimId, idempotencyKey);
      await api.releaseSupportClaim(context, claimId, {
        expectedClaimVersion: workbench.data.claim.version,
        expectedSessionVersion: workbench.data.session.version,
        idempotencyKey,
        reason: "agent_release",
      });
      releaseKeys.current.delete(claimId);
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete("sessionId");
        return next;
      });
      setNotice("已释放接管，会话重新进入人工等待队列。");
      await loadWorkItems();
    } catch (error) {
      setNotice(`释放接管失败：${errorLabel(error)}`);
    } finally {
      setBusy(null);
    }
  }

  async function searchKnowledge() {
    if (workbench.status !== "ready" || !workbench.data.agent ||
      !knowledgeQuery.trim() || knowledgeSearching) return;
    setKnowledgeSearching(true);
    const requestId = ++knowledgeRequest.current;
    try {
      const agent = workbench.data.agent;
      const result = await api.resolveSupportKnowledge(
        context, workbench.data.session.id, {
          query: knowledgeQuery.trim(), locale: agent.locale,
          countryCode: agent.countryCode, productCode: agent.productCode,
          limit: 6,
        },
      );
      if (knowledgeRequest.current === requestId) setKnowledge(result.resolution);
    } catch (error) {
      if (knowledgeRequest.current === requestId) {
        setKnowledge(null);
        setNotice(`知识检索失败：${errorLabel(error)}`);
      }
    } finally {
      if (knowledgeRequest.current === requestId) setKnowledgeSearching(false);
    }
  }

  async function submitFollowup(input: { kind: "ticket"; subject: string;
    description: string } | { kind: "callback"; scheduledAt: string; reason: string }) {
    const current = workbenchRef.current;
    if (!current || busy) return false;
    const requestKey = `${input.kind}:${JSON.stringify(input)}`;
    const idempotencyKey = followupKeys.current.get(requestKey) ??
      `web-${input.kind}:${crypto.randomUUID()}`;
    followupKeys.current.set(requestKey, idempotencyKey);
    setBusy(input.kind);
    try {
      const versions = { idempotencyKey,
        expectedSessionVersion: current.session.version,
        expectedClaimVersion: current.claim.version };
      const result = input.kind === "ticket"
        ? await api.createSupportTicket(context, current.session.id,
            { subject: input.subject, description: input.description, ...versions })
        : await api.scheduleSupportCallback(context, current.session.id,
            { scheduledAt: input.scheduledAt, reason: input.reason, ...versions });
      followupKeys.current.delete(requestKey);
      setNotice(result.followup.providerSimulated
        ? `模拟${input.kind === "ticket" ? "工单" : "回拨"}任务已入队；不代表真实外部效果。`
        : `${input.kind === "ticket" ? "工单" : "回拨"}任务已入队；外部系统异步处理，不阻塞当前会话。`);
      void refreshWorkbench(current.session.id).catch(() => undefined);
      return true;
    } catch (error) {
      setNotice(`${input.kind === "ticket" ? "工单" : "回拨"}任务提交失败：${
        errorLabel(error)}`);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function refreshWorkbench(targetSessionId: string) {
    const data = await api.getSupportWorkbench(context, targetSessionId);
    setWorkbench((current) => current.status === "ready"
      ? { status: "ready", data: mergeWorkbench(current.data, data) } : current);
  }

  return <PageFrame title="坐席工作台"
    description="等待队列、接管租约、字幕、客户、知识与服务历史的租户服务端真值">
    {notice ? <p className="support-notice" role="status">{notice}</p> : null}
    {queueError ? <StatusPanel state={apiErrorState(queueError)}
      description={`队列读取失败：${errorLabel(queueError)}`}
      action={<button className="button button--secondary" type="button"
        onClick={() => void loadQueues()}>重试</button>} /> : null}
    <div className="support-workspace">
      <SupportQueuePanel queues={queues} selectedQueueId={selectedQueueId}
        workItems={workItems} loading={queueLoading} busy={busy}
        onQueue={setSelectedQueueId} onClaim={(item) => void claim(item)}
        onRefresh={() => void loadWorkItems()} />
      {workbench.status === "idle" ? <section className="support-empty-workbench">
        <StatusPanel state="empty" title="选择一个等待会话"
          description="接管后才会读取客户、字幕与服务历史；页面不展示跨坐席会话。" />
      </section> : null}
      {workbench.status === "loading" ? <section className="support-empty-workbench">
        <StatusPanel state="loading" description="正在校验坐席租约并停止 AI 发言。" />
      </section> : null}
      {workbench.status === "failed" ? <section className="support-empty-workbench">
        <StatusPanel state={apiErrorState(workbench.error)}
          description={`工作台不可用：${errorLabel(workbench.error)}`}
          action={<button className="button button--secondary" type="button"
            onClick={() => setSearchParams((current) => {
              const next = new URLSearchParams(current); next.delete("sessionId"); return next;
            })}>返回队列</button>} />
      </section> : null}
      {workbench.status === "ready" ? <>
        <SupportConversationPanel workbench={workbench.data} busy={busy}
          onRenew={() => void renewClaim(false)} onRelease={() => void releaseClaim()} />
        <SupportContextPanel workbench={workbench.data} query={knowledgeQuery}
          knowledge={knowledge} searching={knowledgeSearching}
          busy={busy} onQuery={setKnowledgeQuery}
          onSearch={() => void searchKnowledge()}
          onTicket={(input) => submitFollowup({ kind: "ticket", ...input })}
          onCallback={(input) => submitFollowup({ kind: "callback", ...input })} />
      </> : null}
    </div>
  </PageFrame>;
}

function mergeWorkbench(
  current: EnterpriseSupportWorkbenchDto,
  next: EnterpriseSupportWorkbenchDto,
) {
  return next.claim.version < current.claim.version
    ? { ...next, claim: current.claim } : next;
}
function terminalWorkbenchError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error &&
    ["claim_expired", "claim_not_active", "not_active", "forbidden",
      "not_found", "ai_stop_not_verified"]
      .includes(String(error.code)));
}
function errorLabel(error: unknown) {
  if (error && typeof error === "object" && "message" in error &&
    typeof error.message === "string") return error.message;
  return "未知错误";
}
