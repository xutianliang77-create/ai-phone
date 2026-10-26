import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {X509Certificate,createHash,sign} from 'node:crypto';
/** Synthetic three-certificate purpose chain, never Apple production material. */
export function certificates(leafPurpose=true){
 const dir=mkdtempSync(join(tmpdir(),'v10-jws-fixture-'));
 const run=(a:string[])=>execFileSync('/usr/bin/openssl',a,{cwd:dir,stdio:'ignore'});
 for(const key of ['root','intermediate','leaf'])run(['ecparam','-name','prime256v1','-genkey','-noout','-out',key+'.key']);
 writeFileSync(join(dir,'root.cnf'),'[req]\ndistinguished_name=dn\nx509_extensions=ca\n[dn]\n[ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n');
 run(['req','-new','-x509','-key','root.key','-sha256','-days','3','-subj','/CN=Synthetic local root','-config','root.cnf','-out','root.crt']);
 for(const [key,parent,purpose,ca] of [['intermediate','root','1.2.840.113635.100.6.2.1',true],['leaf','intermediate',leafPurpose?'1.2.840.113635.100.6.11.1':'1.2.840.113635.100.6.11.2',false]] as const){
  run(['req','-new','-key',key+'.key','-subj','/CN=Synthetic '+key,'-out',key+'.csr']);
  writeFileSync(join(dir,key+'.ext'),`basicConstraints=critical,CA:${ca?'TRUE':'FALSE'}\nkeyUsage=${ca?'keyCertSign,cRLSign':'digitalSignature'}\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n${purpose}=DER:05:00\n`);
  run(['x509','-req','-in',key+'.csr','-CA',parent+'.crt','-CAkey',parent+'.key','-CAcreateserial','-sha256','-days','3','-extfile',key+'.ext','-out',key+'.crt']);
 }
 const certs=['leaf','intermediate','root'].map(k=>new X509Certificate(readFileSync(join(dir,k+'.crt'))));
 const header=Buffer.from(JSON.stringify({alg:'ES256',x5c:certs.map(c=>c.raw.toString('base64'))})).toString('base64url');
 return {root:createHash('sha256').update(certs[2]!.raw).digest('hex'),sign:(p:object)=>{
  const input=header+'.'+Buffer.from(JSON.stringify(p)).toString('base64url');
  return input+'.'+sign('sha256',Buffer.from(input),{key:readFileSync(join(dir,'leaf.key')),dsaEncoding:'ieee-p1363'}).toString('base64url');
 },close:()=>rmSync(dir,{recursive:true,force:true})};
}
