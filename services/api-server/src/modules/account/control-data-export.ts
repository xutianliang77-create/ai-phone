import {getRepositoryRuntime} from '../../infrastructure/storage/repository-runtime.js';
import {getStoreSnapshot} from '../../infrastructure/storage/json-store.js';
import {listSessions} from '../sessions/sessions-runtime.repository.js';
import type {TermbaseTermRecord} from '../terms/term-record.js';

/** Content stays in the original processing store. Never initialize a second
 * wallet, export auth hashes, tickets, device proofs or signing receipts. */
export async function controlDataExport(ownerId:string){
 const runtime=getRepositoryRuntime();
 const terms=runtime.driver==='postgres'
  ?await runtime.postgres.productRecords.query<TermbaseTermRecord>({namespace:'termbaseTerms',ownerId,limit:500})
  :getStoreSnapshot().termbaseTerms.filter(t=>t.userId===ownerId);
 const sessions=(await listSessions(ownerId)).map(s=>({id:s.id,mode:s.mode,status:s.status,
  createdAt:s.createdAt,endedAt:s.endedAt,consumedSeconds:s.consumedSeconds,segments:s.segments}));
 return {exportedAt:new Date().toISOString(),sessions,termbaseTerms:terms,agentCalls:[],privateDataExportRequired:false};
}
