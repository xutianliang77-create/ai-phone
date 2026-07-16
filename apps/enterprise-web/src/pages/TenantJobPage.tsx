import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { EnterpriseTenantJobDto } from "@translation/contracts";
import { apiErrorState, tenantJobState } from "../business-state.js";
import { useAuth } from "../auth/AuthContext.js";
import { StatusPanel, type PageState } from "../components/StatusPanel.js";

type JobPageState =
  | { status: "loading" }
  | { status: "loaded"; job: EnterpriseTenantJobDto }
  | { status: "error"; pageState: PageState };

export function TenantJobPage() {
  const { jobId = "" } = useParams();
  const { getTenantJob } = useAuth();
  const [state, setState] = useState<JobPageState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    void getTenantJob(jobId).then(
      ({ job }) => active && setState({ status: "loaded", job }),
      (error: unknown) => active && setState({
        status: "error",
        pageState: apiErrorState(error),
      }),
    );
    return () => {
      active = false;
    };
  }, [getTenantJob, jobId]);

  return (
    <main className="page-frame">
      <header className="page-heading">
        <div><h1>租户任务</h1><p>服务端生命周期 job 状态</p></div>
      </header>
      <div className="page-content">
        {state.status === "loading" ? (
          <StatusPanel state="loading" description="正在读取租户任务。" />
        ) : state.status === "error" ? (
          <StatusPanel
            state={state.pageState}
            description="无法读取租户任务，请核对权限或刷新后重试。"
          />
        ) : (
          <JobResult job={state.job} />
        )}
      </div>
    </main>
  );
}

function JobResult({ job }: { job: EnterpriseTenantJobDto }) {
  const state = tenantJobState(job.status);
  if (state === "ready") {
    return (
      <section className="truth-card" role="status">
        <span>{job.type}</span><strong>{job.status}</strong>
        <small>任务已由服务端确认完成。</small>
      </section>
    );
  }
  return (
    <StatusPanel
      state={state}
      description={`${job.type} · ${job.errorCode ?? "等待服务端终态"}`}
      action={<Link className="button button--secondary" to="/">返回工作台</Link>}
    />
  );
}
