import { getRepositoryRuntime } from "../../infrastructure/storage/repository-runtime.js";
import { PostgresPrimaryStore } from "../../infrastructure/storage/postgres-primary-store.js";
import { withPostgresRepositoryFence } from "../../infrastructure/storage/postgres-repository-fence.js";
import { ResultSyncError, resultSyncHash, syncKey } from "../sessions/session-result-sync-contract.js";
import {minimumPostgresUsageHoldTtlSeconds} from "../usage/postgres-usage-holds.repository.js";

const aggregateType = "qa_public_one_shot";
const commandType = "reserve";

interface Reservation {
  authorizationId: string;
  ownerId: string;
  deploymentId: string;
  sessionId: string;
  reservedAt: string;
}

export interface PublicQaOneShotGuard {
  readonly authorizationId: string;
  readonly expiresAt: string;
  readonly maxWallSeconds: number;
  assertScope(ownerId: string, deploymentId: string): void;
  reserve(sessionId: string, ownerId: string, deploymentId: string): Promise<void>;
  assertReserved(sessionId: string, ownerId: string, deploymentId: string): Promise<void>;
}

type QaEnv = Partial<Pick<NodeJS.ProcessEnv,
  "PUBLIC_QA_ONE_SHOT_ENABLED" | "PUBLIC_QA_ONE_SHOT_AUTHORIZATION_ID" |
  "PUBLIC_QA_ONE_SHOT_OWNER_ID" | "PUBLIC_QA_ONE_SHOT_DEPLOYMENT_ID" |
  "PUBLIC_QA_ONE_SHOT_EXPIRES_AT" | "PUBLIC_QA_ONE_SHOT_MAX_WALL_SECONDS" |
  "API_RESULT_SYNC_DEPLOYMENT_ID">>;

/** Require enough time for the QA wall limit and the PostgreSQL hold's
 * minimum TTL, plus a small issuance/finalization margin. */
export function qaOneShotStartWindowReady(expiresAt:unknown,maxWallSeconds:unknown,nowMs=Date.now()){
  const expires=typeof expiresAt==="string"?Date.parse(expiresAt):NaN;
  return Number.isFinite(expires)&&Number.isSafeInteger(maxWallSeconds)&&
    (maxWallSeconds as number)>=1&&(maxWallSeconds as number)<=45&&
    expires-nowMs>=(Math.max(maxWallSeconds as number,minimumPostgresUsageHoldTtlSeconds)+5)*1000;
}

/** Explicitly installed only on a dedicated public QA candidate. Reuse the
 * original durable command inbox rather than adding a schema or a second
 * session store. A failed/ambiguous preparation still consumes this grant. */
export function publicQaOneShotGuardFromEnvironment(env: QaEnv = process.env): PublicQaOneShotGuard | undefined {
  const fields = [env.PUBLIC_QA_ONE_SHOT_ENABLED, env.PUBLIC_QA_ONE_SHOT_AUTHORIZATION_ID,
    env.PUBLIC_QA_ONE_SHOT_OWNER_ID, env.PUBLIC_QA_ONE_SHOT_DEPLOYMENT_ID,
    env.PUBLIC_QA_ONE_SHOT_EXPIRES_AT, env.PUBLIC_QA_ONE_SHOT_MAX_WALL_SECONDS];
  if (fields.every(value => value === undefined)) return undefined;
  const [enabled, authorizationId, ownerId, deploymentId, expiresAt, rawMaxWallSeconds] = fields;
  const maxWallSeconds = Number(rawMaxWallSeconds);
  if (enabled !== "true" || !syncKey(authorizationId) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(authorizationId) || !syncKey(ownerId) ||
    !syncKey(deploymentId) || deploymentId !== env.API_RESULT_SYNC_DEPLOYMENT_ID ||
    typeof expiresAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(expiresAt) ||
    !Number.isFinite(Date.parse(expiresAt)) ||
    Date.parse(expiresAt) <= Date.now() || Date.parse(expiresAt) > Date.now() + 86_400_000 ||
    !Number.isSafeInteger(maxWallSeconds) || maxWallSeconds < 1 || maxWallSeconds > 45 ||
    getRepositoryRuntime().driver !== "postgres") {
    throw Error("public_qa_one_shot_not_configured");
  }
  const scopeKey = resultSyncHash({ authorizationId, ownerId, deploymentId });
  const command = {commandId:`qa-public-once:${scopeKey}`,aggregateType,aggregateId:scopeKey,
    commandType,requestHash:scopeKey};
  const expected = (sessionId: string): Omit<Reservation, "reservedAt"> =>
    ({ authorizationId, ownerId, deploymentId, sessionId });
  const assertScope = (candidateOwner: string, candidateDeployment: string) => {
    if (candidateOwner !== ownerId || candidateDeployment !== deploymentId ||
      Date.parse(expiresAt) <= Date.now()) {
      throw new ResultSyncError("public_qa_one_shot_scope_denied", 403);
    }
  };
  const matches = (record: Reservation, sessionId: string) =>
    record.authorizationId === authorizationId && record.ownerId === ownerId &&
    record.deploymentId === deploymentId && record.sessionId === sessionId &&
    Number.isFinite(Date.parse(record.reservedAt));
  return {
    authorizationId, expiresAt, maxWallSeconds, assertScope,
    async reserve(sessionId, candidateOwner, candidateDeployment) {
      assertScope(candidateOwner, candidateDeployment);
      if (!/^public-[a-f0-9]{64}$/.test(sessionId)) throw new ResultSyncError("public_qa_one_shot_invalid", 400);
      const runtime = getRepositoryRuntime();
      if (runtime.driver !== "postgres") throw new ResultSyncError("public_qa_one_shot_store_unavailable", 503);
      await withPostgresRepositoryFence({ aggregateType, aggregateId: scopeKey }, fence =>
        new PostgresPrimaryStore(runtime.postgres.pool).withAggregateTransaction(fence, async transaction => {
          const current = await transaction.readCommandResult<Reservation>(command);
          if (current) {
            if (!matches(current, sessionId)) throw new ResultSyncError("public_qa_one_shot_consumed", 409);
            return;
          }
          if(!qaOneShotStartWindowReady(expiresAt,maxWallSeconds)){
            throw new ResultSyncError("public_qa_one_shot_window_too_short",403);
          }
          await transaction.recordCommandResult<Reservation>({
            ...command,result:{...expected(sessionId),reservedAt:new Date().toISOString()},
            retainUntil:new Date(Date.parse(expiresAt)+90*24*60*60*1000).toISOString(),
          });
        }));
    },
    async assertReserved(sessionId, candidateOwner, candidateDeployment) {
      assertScope(candidateOwner, candidateDeployment);
      const runtime = getRepositoryRuntime();
      if (runtime.driver !== "postgres") throw new ResultSyncError("public_qa_one_shot_store_unavailable", 503);
      const rows=await runtime.postgres.pool.query<{aggregate_type:string;aggregate_id:string;command_type:string;request_hash:string;result_payload:Reservation}>(`
        SELECT aggregate_type,aggregate_id,command_type,request_hash,result_payload
        FROM ai_phone.primary_command_inbox WHERE command_id=$1
      `,[command.commandId]);
      const current=rows.rows[0];
      if(!current||current.aggregate_type!==aggregateType||current.aggregate_id!==scopeKey||
        current.command_type!==commandType||current.request_hash!==scopeKey||
        !matches(current.result_payload,sessionId))throw new ResultSyncError("public_qa_one_shot_unreserved",403);
    },
  };
}
