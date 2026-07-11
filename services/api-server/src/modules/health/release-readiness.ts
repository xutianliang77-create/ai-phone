import { getPaymentDeploymentReadiness } from "../billing/payment-readiness.js";
import { getPstnReadiness } from "../calls/pstn-readiness.js";
import { getCallRoomReadiness } from "../call-links/call-room-readiness.js";
import { getDiagnosticsDeploymentReadiness } from "../diagnostics/diagnostics-alerting.js";
import { getAccountDeploymentReadiness } from "../account/account-readiness.js";
import { getSmsDeploymentReadiness } from "../account/sms-provider.js";
import { getReleaseMaterialsReadiness } from "./release-materials-readiness.js";

export function getReleaseReadiness() {
  const accountReadiness = getAccountDeploymentReadiness();
  const paymentReadiness = getPaymentDeploymentReadiness();
  const callRoomReadiness = getCallRoomReadiness();
  const pstnReadiness = getPstnReadiness();
  const smsReadiness = getSmsDeploymentReadiness();
  const diagnosticsReadiness = getDiagnosticsDeploymentReadiness();
  const releaseMaterialsReadiness = getReleaseMaterialsReadiness();
  const issues = [
    ...accountReadiness.issues,
    ...paymentReadiness.issues,
    ...callRoomReadiness.issues,
    ...pstnReadiness.issues,
    ...smsReadiness.issues,
    ...diagnosticsReadiness.issues,
    ...releaseMaterialsReadiness.issues,
  ];
  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    service: "api-server",
    accountReadiness,
    paymentReadiness,
    callRoomReadiness,
    pstnReadiness,
    smsReadiness,
    diagnosticsReadiness,
    releaseMaterialsReadiness,
    issues,
  };
}
