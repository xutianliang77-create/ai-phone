import type {PostgresPrimaryStore} from "../../infrastructure/storage/postgres-primary-store.js";
import type {VersionedUsageHoldRecord,PostgresUsageBalance} from "./postgres-usage-records.js";
import type {HoldCommandInput} from "./postgres-usage-holds.repository.js";
import {activeHeldSeconds,assertUsageFence,enqueueUsageEvent,findUsageHold,lockUsageAccount,
  recordUsageCommand,requireUsageHold,usageBalance,usageCommand,usageEventId} from "./postgres-usage-uow.js";

export type PostgresRenewHoldResult={
  status:"held"|"insufficient"|"not_found";
  balance:PostgresUsageBalance;
  hold?:VersionedUsageHoldRecord;
};

export async function renewPostgresUsageHold(
  primary:PostgresPrimaryStore,input:HoldCommandInput & {targetSeconds:number},
):Promise<PostgresRenewHoldResult>{
  assertUsageFence(input);
  if(!Number.isSafeInteger(input.targetSeconds)||input.targetSeconds<1||input.targetSeconds>2_147_483_647){
    throw Error("Invalid PostgreSQL usage hold target");
  }
  const command=usageCommand({aggregateType:"communication_session",aggregateId:input.sessionId,
    commandId:input.commandId,commandType:input.commandType,requestHash:input.requestHash});
  return primary.withAggregateTransaction<PostgresRenewHoldResult>(input.fence,async transaction=>{
    const replay=await transaction.readCommandResult<PostgresRenewHoldResult>(command);
    if(replay)return replay;
    const now=(input.now??new Date()).toISOString();
    const locked=await lockUsageAccount(transaction,{userId:input.userId,plan:input.plan,now,
      commandId:input.commandId,sessionId:input.sessionId});
    const current=await findUsageHold(transaction,{userId:input.userId,sessionId:input.sessionId});
    const held=await activeHeldSeconds(transaction,input.userId,now);
    const balance=usageBalance(locked.account,held);
    if(!current||current.hold.status!=="active"||Date.parse(current.hold.expiresAt)<=Date.parse(now)){
      return recordUsageCommand(transaction,command,{status:"not_found",balance});
    }
    const increase=input.targetSeconds-current.hold.seconds;
    if(increase>30)throw Error("Usage hold renewal exceeds one interval");
    if(increase>balance.availableSeconds){
      return recordUsageCommand(transaction,command,{status:"insufficient",balance,hold:current.hold});
    }
    const expiry=new Date(Math.max(Date.parse(current.hold.expiresAt),Date.parse(now)+300_000)).toISOString();
    if(increase<=0&&expiry===current.hold.expiresAt){
      return recordUsageCommand(transaction,command,{status:"held",balance,hold:current.hold});
    }
    const next:VersionedUsageHoldRecord={...current.hold,seconds:Math.max(current.hold.seconds,input.targetSeconds),
      expiresAt:expiry,version:current.hold.version+1};
    const eventId=usageEventId(input.commandId,"hold:renew");
    const stored=await transaction.mutate<VersionedUsageHoldRecord>({eventId,namespace:"usageHolds",
      recordKey:next.id,operation:"upsert",payload:next,expectedRecordVersion:current.primary.recordVersion});
    const saved=requireUsageHold(stored?.payload,next.id);
    await enqueueUsageEvent(transaction,{eventId,sessionId:input.sessionId,version:saved.version,
      eventType:"usage_hold.renewed",payload:{hold:saved}});
    const total=await activeHeldSeconds(transaction,input.userId,now);
    return recordUsageCommand(transaction,command,{status:"held",balance:usageBalance(locked.account,total),hold:saved});
  });
}
