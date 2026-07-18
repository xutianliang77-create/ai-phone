import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import type { EnterpriseContentRequestContext } from "../api/enterprise-api.js";
import { useAuth } from "../auth/AuthContext.js";
import {
  clientErrorEvent,
  clientPerformanceEvent,
} from "../enterprise-telemetry.js";

export function EnterpriseTelemetry() {
  const { state, api } = useAuth();
  const location = useLocation();
  const reportedNavigation = useRef(false);

  useEffect(() => {
    if (state.status !== "ready") return;
    const context: EnterpriseContentRequestContext = {
      token: state.session.token,
      tenantId: state.context.tenant.id,
      routeDocument: state.routeDocument,
    };
    const report = async (kind: "error" | "unhandled_rejection", value: unknown) => {
      try {
        await api.reportClientEvent(
          context,
          await clientErrorEvent(kind, value, location.pathname),
        );
      } catch {
        // Telemetry transport must never create a second user-visible failure.
      }
    };
    const onError = (event: ErrorEvent) => {
      void report("error", event.error ?? new Error(event.message || "client_error"));
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      void report("unhandled_rejection", event.reason);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    if (!reportedNavigation.current) {
      reportedNavigation.current = true;
      const navigation = performance.getEntriesByType("navigation")[0];
      if (navigation && navigation.duration > 0) {
        void api.reportClientEvent(
          context,
          clientPerformanceEvent(
            "navigation_duration_ms",
            navigation.duration,
            location.pathname,
          ),
        ).catch(() => undefined);
      }
    }
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [api, location.pathname, state]);

  return null;
}
