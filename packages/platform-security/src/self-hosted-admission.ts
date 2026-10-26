/** Operational admission only. This does not certify model capacity, testing,
 * costs or human approval. Deployment receipts carry those separate facts. */
export function selfHostedAdmission(env:NodeJS.ProcessEnv=process.env,now=Date.now()){
 if(env.AUTH_PROVIDER!=='apple'&&env.V10_CONTROL_AUTHORITY!=='cloudflare')return {controlled:false,open:true,deadlineMs:null as number|null};
 if(env.V10_SERVICE_ADMISSION_ENABLED!=='true'||!strongControlKey(env.REALTIME_TOKEN_SECRET)||!strongControlKey(env.INTERNAL_API_SECRET))return {controlled:true,open:false,deadlineMs:null as number|null};
 const from=Date.parse(env.V10_SERVICE_WINDOW_STARTS_AT??''),end=Date.parse(env.V10_SERVICE_WINDOW_ENDS_AT??'');
 if(env.V10_SERVICE_WINDOW_STARTS_AT!==undefined||env.V10_SERVICE_WINDOW_ENDS_AT!==undefined)return {controlled:true,
  open:Number.isFinite(from)&&Number.isFinite(end)&&from<=now&&now<end&&end>from&&end-from<=3600000,deadlineMs:Number.isFinite(end)?end:null};
 const source=env.V10_SOURCE_MANIFEST_SHA256,approved=env.V10_RELEASE_APPROVED_SOURCE_SHA256;
 return {controlled:true,open:!!source&&/^[a-f0-9]{64}$/.test(source)&&source===approved,deadlineMs:null as number|null};
}
export function selfHostedOwnerAllowed(owner:string,env:NodeJS.ProcessEnv=process.env){
 if((env.AUTH_PROVIDER!=='apple'&&env.V10_CONTROL_AUTHORITY!=='cloudflare')||(env.V10_SERVICE_WINDOW_STARTS_AT===undefined&&env.V10_SERVICE_WINDOW_ENDS_AT===undefined))return true;
 try{
  const ids:unknown=JSON.parse(env.V10_QA_ALLOWED_ACCOUNT_IDS??'[]');
  return Array.isArray(ids)&&ids.length<=32&&ids.every(x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(x))&&ids.includes(owner);
 }catch{return false;}
}

function strongControlKey(value:string|undefined){return typeof value==='string'&&value.length>=32&&!/dev-secret|replace-with|changeme/i.test(value);}
