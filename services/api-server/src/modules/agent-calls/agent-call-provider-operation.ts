import {
  findProviderOperation,
  findSessionProviderOperation,
} from
  "../provider-operations/provider-operations-runtime.repository.js";
import { isAgentCallDialOperation } from "./agent-call-provider-profile.js";

export async function findAgentDialProviderOperation(
  sessionId: string,
  providerOperationId?: string,
) {
  if (providerOperationId) {
    const exact = await findProviderOperation(providerOperationId);
    if (exact?.sessionId === sessionId && isAgentCallDialOperation(exact)) {
      return exact;
    }
    return null;
  }
  return await findSessionProviderOperation(sessionId, "phone_outbound") ??
    await findSessionProviderOperation(sessionId, "sip_outbound");
}
