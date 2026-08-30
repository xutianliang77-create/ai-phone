import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  EnterpriseCustomerDirectoryDetailResponse,
  EnterpriseCustomerDirectoryItemDto,
  EnterpriseLeadDirectoryItemDto,
} from "@translation/contracts";
import { EnterpriseApiError } from "../api/enterprise-api.js";
import { useAuth } from "../auth/AuthContext.js";
import { ContactDirectoryCustomers, ContactDirectoryLeads,
  ContactDirectoryTabs } from "../components/ContactDirectory.js";
import { PageFrame } from "../components/PageFrame.js";
import { StatusPanel } from "../components/StatusPanel.js";

type ContactTab = "leads" | "customers";

export function ContactsPage() {
  const { state, api } = useAuth();
  if (state.status !== "ready") return null;
  const canReadLeads = state.context.scopes.includes("campaign:read");
  const canReadCustomers = state.context.scopes.includes("support:read");
  const initialTab: ContactTab = canReadLeads ? "leads" : "customers";
  const context = useMemo(() => ({ token: state.session.token,
    tenantId: state.context.tenant.id, routeDocument: state.routeDocument }),
  [state.context.tenant.id, state.routeDocument, state.session.token]);
  const currentTenant = useRef(context.tenantId);
  const detailGeneration = useRef(0);
  const leadGeneration = useRef(0);
  const customerGeneration = useRef(0);
  currentTenant.current = context.tenantId;
  const [tab, setTab] = useState<ContactTab>(initialTab);
  const [leads, setLeads] = useState<EnterpriseLeadDirectoryItemDto[]>([]);
  const [leadCursor, setLeadCursor] = useState<string>();
  const [customers, setCustomers] =
    useState<EnterpriseCustomerDirectoryItemDto[]>([]);
  const [customerCursor, setCustomerCursor] = useState<string>();
  const [selectedLead, setSelectedLead] =
    useState<EnterpriseLeadDirectoryItemDto>();
  const [selectedCustomer, setSelectedCustomer] =
    useState<EnterpriseCustomerDirectoryDetailResponse>();
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<unknown>();

  const loadLeads = useCallback(async (cursor?: string) => {
    if (!canReadLeads) return;
    const tenantId = context.tenantId;
    const generation = ++leadGeneration.current;
    cursor ? setLoadingMore(true) : setLoading(true);
    setError(undefined);
    try {
      const response = await api.listEnterpriseLeads(context,
        { cursor, limit: 50 });
      if (currentTenant.current !== tenantId ||
        leadGeneration.current !== generation) return;
      setLeads((current) => cursor ? appendUnique(current, response.leads) :
        response.leads);
      setLeadCursor(response.nextCursor);
    } catch (reason) {
      if (currentTenant.current === tenantId &&
        leadGeneration.current === generation) setError(reason);
    } finally {
      if (currentTenant.current === tenantId &&
        leadGeneration.current === generation) {
        setLoading(false); setLoadingMore(false);
      }
    }
  }, [api, canReadLeads, context]);

  const loadCustomers = useCallback(async (cursor?: string) => {
    if (!canReadCustomers) return;
    const tenantId = context.tenantId;
    const generation = ++customerGeneration.current;
    cursor ? setLoadingMore(true) : setLoading(true);
    setError(undefined);
    try {
      const response = await api.listEnterpriseCustomers(context,
        { cursor, limit: 50 });
      if (currentTenant.current !== tenantId ||
        customerGeneration.current !== generation) return;
      setCustomers((current) => cursor
        ? appendUnique(current, response.customers) : response.customers);
      setCustomerCursor(response.nextCursor);
    } catch (reason) {
      if (currentTenant.current === tenantId &&
        customerGeneration.current === generation) setError(reason);
    } finally {
      if (currentTenant.current === tenantId &&
        customerGeneration.current === generation) {
        setLoading(false); setLoadingMore(false);
      }
    }
  }, [api, canReadCustomers, context]);

  useEffect(() => {
    detailGeneration.current += 1;
    leadGeneration.current += 1;
    customerGeneration.current += 1;
    setLeads([]); setCustomers([]); setSelectedLead(undefined);
    setSelectedCustomer(undefined); setLeadCursor(undefined);
    setCustomerCursor(undefined); setTab(initialTab); setError(undefined);
    setLoading(false); setLoadingMore(false); setDetailLoading(false);
    if (initialTab === "leads") void loadLeads(); else void loadCustomers();
  }, [context, initialTab, loadCustomers, loadLeads]);

  async function selectLead(id: string) {
    const tenantId = context.tenantId;
    const generation = ++detailGeneration.current;
    setSelectedLead(undefined); setDetailLoading(true); setError(undefined);
    try {
      const response = await api.getEnterpriseLead(context, id);
      if (currentTenant.current === tenantId &&
        detailGeneration.current === generation) setSelectedLead(response.lead);
    } catch (reason) {
      if (currentTenant.current === tenantId &&
        detailGeneration.current === generation) setError(reason);
    } finally {
      if (currentTenant.current === tenantId &&
        detailGeneration.current === generation) setDetailLoading(false);
    }
  }
  async function selectCustomer(id: string) {
    const tenantId = context.tenantId;
    const generation = ++detailGeneration.current;
    setSelectedCustomer(undefined); setDetailLoading(true); setError(undefined);
    try {
      const response = await api.getEnterpriseCustomer(context, id);
      if (currentTenant.current === tenantId &&
        detailGeneration.current === generation) setSelectedCustomer(response);
    } catch (reason) {
      if (currentTenant.current === tenantId &&
        detailGeneration.current === generation) setError(reason);
    } finally {
      if (currentTenant.current === tenantId &&
        detailGeneration.current === generation) setDetailLoading(false);
    }
  }
  function changeTab(next: ContactTab) {
    if (next === tab) return;
    detailGeneration.current += 1;
    if (tab === "leads") leadGeneration.current += 1;
    else customerGeneration.current += 1;
    setTab(next); setError(undefined); setLoading(false);
    setLoadingMore(false); setDetailLoading(false);
    if (next === "leads" && leads.length === 0) void loadLeads();
    if (next === "customers" && customers.length === 0) void loadCustomers();
  }

  const apiError = error instanceof EnterpriseApiError ? error : undefined;
  return <PageFrame title="客户与线索"
    description="营销线索与客服客户保持两个服务端真值域，不在客户端强行合并">
    <ContactDirectoryTabs active={tab} canReadLeads={canReadLeads}
      canReadCustomers={canReadCustomers} onChange={changeTab} />
    {error ? <StatusPanel state={apiError?.status === 403 ? "forbidden" :
      apiError?.status === 503 ? "not_ready" : "failed"}
      description={apiError?.message ?? "客户目录暂时无法读取。"}
      traceId={apiError?.traceId}
      action={<button className="button button--secondary" onClick={() =>
        tab === "leads" ? void loadLeads() : void loadCustomers()}>重试</button>} /> : null}
    {loading ? <StatusPanel state="loading" description="正在读取当前租户目录。" /> : null}
    {!loading && tab === "leads" ? <ContactDirectoryLeads leads={leads}
      selected={selectedLead} detailLoading={detailLoading}
      onSelect={(id) => void selectLead(id)} hasMore={Boolean(leadCursor)}
      loadingMore={loadingMore} onMore={() => void loadLeads(leadCursor)} /> : null}
    {!loading && tab === "customers" ? <ContactDirectoryCustomers
      customers={customers} selected={selectedCustomer}
      detailLoading={detailLoading} onSelect={(id) => void selectCustomer(id)}
      hasMore={Boolean(customerCursor)} loadingMore={loadingMore}
      onMore={() => void loadCustomers(customerCursor)} /> : null}
  </PageFrame>;
}

function appendUnique<T extends { id: string }>(current: T[], next: T[]) {
  const values = new Map(current.map((item) => [item.id, item]));
  next.forEach((item) => values.set(item.id, item));
  return [...values.values()];
}
