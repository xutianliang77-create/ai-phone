import {getStoreSnapshot,persistStoreSnapshot,runStoreTransaction} from "../../infrastructure/storage/json-store.js";
import type {SessionRecord} from "../sessions/session-record.js";
import {ResultSyncError} from "../sessions/session-result-sync-contract.js";
import {resultSyncHash,syncKey} from "../sessions/session-result-sync-contract.js";
import {publicDeploymentId} from "../sessions/session-result-sync.service.js";

export function publicCreationIdentity(ownerId:string,idempotencyKey:unknown) {
  if(!syncKey(ownerId)||typeof idempotencyKey!=="string"||!/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(idempotencyKey))throw new ResultSyncError("public_creation_idempotency_required",400);
  const deploymentId=publicDeploymentId();
  return {deploymentId,sessionId:`public-${resultSyncHash({deploymentId,ownerId,idempotencyKey})}`};
}

/** Same original snapshot transaction as the prepared session. A deleted session
 * cannot free its HTTP idempotency identity for replay. Non-HTTP internal IDs and
 * private 1.0 records do not acquire this additional metadata. */
export function createPreparedSessionWithBinding(record:SessionRecord,create:(record:SessionRecord)=>SessionRecord){
  return runStoreTransaction(()=>{
    const httpIdentity=/^public-[a-f0-9]{64}$/.test(record.id),store=getStoreSnapshot();
    if(httpIdentity&&Object.hasOwn(store.publicCreationBindings??{},record.id))throw new ResultSyncError("public_creation_request_retired",410);
    const saved=create(record);
    if(httpIdentity){store.publicCreationBindings??={};store.publicCreationBindings[record.id]=record.publicCreationRequest!.requestHash;persistStoreSnapshot();}
    return saved;
  });
}
