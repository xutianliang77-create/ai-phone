import {createCipheriv,createDecipheriv,randomBytes} from "node:crypto";
import {existsSync,readFileSync,mkdirSync,openSync,writeFileSync,fsyncSync,closeSync,renameSync,lstatSync} from "node:fs";
import {dirname,isAbsolute,resolve} from "node:path";
import {PublicConfigError} from "./public-model-config.js";
interface StoredConfig {schemaVersion:1;deploymentId:string;revision:number;}
/** One encryption/CAS implementation, with distinct files, keys and AAD contexts. */
export function encryptedModelConfigStore<T extends StoredConfig,R>(options:{kind:"public"|"private";deploymentEnv:string;empty:(id:string)=>T;merge:(current:T,body:unknown)=>T;present:(config:T)=>R}){
  let pending=Promise.resolve();const prefix=options.kind.toUpperCase();
  function settings(){
    const file=process.env[`${prefix}_MODEL_CONFIG_FILE`],key=process.env[`${prefix}_MODEL_CONFIG_KEY`],deployment=process.env[options.deploymentEnv];
    if(!file||!isAbsolute(file)||!key||!/^[a-f0-9]{64}$/i.test(key)||!deployment||!/^[A-Za-z0-9._-]{1,120}$/.test(deployment))throw new PublicConfigError(`${options.kind}_config_storage_not_ready`,503);
    const other=process.env[`${options.kind==="public"?"PRIVATE":"PUBLIC"}_MODEL_CONFIG_FILE`];
    if(other&&resolve(other)===resolve(file))throw new PublicConfigError("model_config_storage_collision",503);
    try{const info=lstatSync(file);if(!info.isFile()||info.size>1024*1024)throw new PublicConfigError(`${options.kind}_config_invalid_storage`,503);}
    catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
    return {file,key:Buffer.from(key,"hex"),deployment,aad:Buffer.from(`wujie-${options.kind}-models-v1:${deployment}`)};
  }
  function read(s:ReturnType<typeof settings>):T{
    if(!existsSync(s.file))return options.empty(s.deployment);
    try{
      const e=JSON.parse(readFileSync(s.file,"utf8"));if(e.schemaVersion!==1||e.algorithm!=="aes-256-gcm")throw Error();
      const decipher=createDecipheriv("aes-256-gcm",s.key,Buffer.from(e.iv,"base64"));decipher.setAAD(s.aad);decipher.setAuthTag(Buffer.from(e.tag,"base64"));
      const config=JSON.parse(Buffer.concat([decipher.update(Buffer.from(e.ciphertext,"base64")),decipher.final()]).toString("utf8")) as T;
      if(config.schemaVersion!==1||config.deploymentId!==s.deployment||!Number.isSafeInteger(config.revision))throw Error();return config;
    }catch{throw new PublicConfigError(`${options.kind}_config_unreadable`,503);}
  }
  return {
    read:()=>options.present(read(settings())),
    // Server-internal selection only. HTTP handlers must continue using read().
    selectInternal:<S>(select:(config:T)=>S)=>select(read(settings())),
    save:async(body:unknown)=>{
      const snapshot=structuredClone(body),s=settings();
      const task=pending.then(()=>{
        const config=options.merge(read(s),snapshot),iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",s.key,iv);cipher.setAAD(s.aad);
        const ciphertext=Buffer.concat([cipher.update(JSON.stringify(config),"utf8"),cipher.final()]);
        const envelope=JSON.stringify({schemaVersion:1,algorithm:"aes-256-gcm",iv:iv.toString("base64"),tag:cipher.getAuthTag().toString("base64"),ciphertext:ciphertext.toString("base64")});
        mkdirSync(dirname(s.file),{recursive:true,mode:0o700});const tmp=`${s.file}.${randomBytes(8).toString("hex")}.tmp`,fd=openSync(tmp,"wx",0o600);
        try{writeFileSync(fd,envelope);fsyncSync(fd);}finally{closeSync(fd);}renameSync(tmp,s.file);return options.present(config);
      });pending=task.then(()=>{},()=>{});return task;
    },
  };
}
