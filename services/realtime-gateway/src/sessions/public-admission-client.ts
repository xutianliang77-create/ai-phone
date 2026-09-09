import {randomUUID} from "node:crypto";
import {publicRuntimeTokenBinding,matchesPublicAdmissionReceipt,type RealtimeTokenClaims,type PublicAdmissionQuery} from "@translation/contracts";
import type {SessionEventSink} from "./session-event-sink.js";

/** Verified claims are only a lookup key, never the current grant. No caching or
 * retry. Connect and each dispatch decision require fresh authority; actual model
 * attempts still pass through the original durable writer before transmission. */
export function createPublicAdmissionClient(sink:SessionEventSink,claims:RealtimeTokenClaims,deploymentId:string){
  const snapshot=structuredClone(claims),binding=publicRuntimeTokenBinding(snapshot,deploymentId),lookup=sink.admission?.bind(sink);
  if(!binding||!lookup)throw Error("public_admission_client_not_bound");
  const queryAuthority=async(purpose:PublicAdmissionQuery["purpose"])=>{
    if(purpose==="connect"&&snapshot.expiresAt<=Math.floor(Date.now()/1000))throw Error("public_admission_token_expired");
    const query:PublicAdmissionQuery={...binding,contractVersion:1,requestId:randomUUID(),sessionId:snapshot.sessionId,ownerId:snapshot.userId,
      modelPolicyRevision:snapshot.processing!.modelPolicyRevision,grantRef:snapshot.processing!.publicGrantRef!,purpose};
    const receipt=await lookup(query);if(!matchesPublicAdmissionReceipt(receipt,query))throw Error("public_admission_ack_mismatch");return receipt;
  };
  return {
    async authorize(purpose:"connect"|"dispatch") {
      if(!["connect","dispatch"].includes(purpose))throw Error("public_admission_purpose_invalid");
      return queryAuthority(purpose);
    },
    // Inspect the old aggregate; this does not acquire a connection generation,
    // renew its token, fetch credentials or enable public reconnect.
    inspectRecovery:()=>queryAuthority("recovery"),
  };
}
