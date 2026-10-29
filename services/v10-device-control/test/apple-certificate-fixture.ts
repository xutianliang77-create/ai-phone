import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {X509Certificate,createHash,sign} from 'node:crypto';
/** Synthetic three-certificate purpose chain, never Apple production material. */
export function certificates(leafPurpose=true,ocspHost='ocsp.apple.com'){
 const dir=mkdtempSync(join(tmpdir(),'v10-jws-fixture-'));
 const run=(a:string[])=>execFileSync('/usr/bin/openssl',a,{cwd:dir,stdio:'ignore'});
 for(const key of ['root','intermediate','leaf'])run(['ecparam','-name','prime256v1','-genkey','-noout','-out',key+'.key']);
 writeFileSync(join(dir,'root.cnf'),'[req]\ndistinguished_name=dn\nx509_extensions=ca\n[dn]\n[ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=keyCertSign,cRLSign,digitalSignature\nsubjectKeyIdentifier=hash\n');
 run(['req','-new','-x509','-key','root.key','-sha256','-days','3','-subj','/CN=Synthetic local root','-config','root.cnf','-out','root.crt']);
 for(const [key,parent,purpose,ca] of [['intermediate','root','1.2.840.113635.100.6.2.1',true],['leaf','intermediate',leafPurpose?'1.2.840.113635.100.6.11.1':'1.2.840.113635.100.6.11.2',false]] as const){
  run(['req','-new','-key',key+'.key','-subj','/CN=Synthetic '+key,'-out',key+'.csr']);
  writeFileSync(join(dir,key+'.ext'),`basicConstraints=critical,CA:${ca?'TRUE':'FALSE'}\nkeyUsage=${ca?'keyCertSign,cRLSign,digitalSignature':'digitalSignature'}\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\nauthorityInfoAccess=OCSP;URI:http://${ocspHost}/fixture/${key}\n${purpose}=DER:05:00\n`);
  run(['x509','-req','-in',key+'.csr','-CA',parent+'.crt','-CAkey',parent+'.key','-CAcreateserial','-sha256','-days','3','-extfile',key+'.ext','-out',key+'.crt']);
 }
 const certs=['leaf','intermediate','root'].map(k=>new X509Certificate(readFileSync(join(dir,k+'.crt'))));
 const header=Buffer.from(JSON.stringify({alg:'ES256',x5c:certs.map(c=>c.raw.toString('base64'))})).toString('base64url');
 let serial=0;
 const ocsp=(key:'leaf'|'intermediate',request:Buffer,status:'good'|'revoked'='good',delegated:'no'|'valid'|'invalid'|'wrongusage'='no')=>{
  const idx=key==='leaf'?0:1,issuer=key==='leaf'?'intermediate':'root',n=serial++;
  const cert=certs[idx]!;
  const format=(d:Date)=>d.toISOString().replace(/[-:TZ.]/g,'').slice(2,14)+'Z';
  const revoked=status==='revoked'?format(new Date(Date.now()-60000)):'';
  writeFileSync(join(dir,`index-${n}.txt`),`${status==='good'?'V':'R'}\t${format(new Date(cert.validTo))}\t${revoked}\t${cert.serialNumber}\tunknown\t/CN=Synthetic ${key}\n`);
  writeFileSync(join(dir,`request-${n}.der`),request);
  let signer=issuer;
  if(delegated!=='no'){
   signer=`responder-${n}`;
   run(['ecparam','-name','prime256v1','-genkey','-noout','-out',signer+'.key']);
   run(['req','-new','-key',signer+'.key','-subj',`/CN=Synthetic ${signer}`,'-out',signer+'.csr']);
   writeFileSync(join(dir,signer+'.ext'),`basicConstraints=critical,CA:FALSE\nkeyUsage=${delegated==='wrongusage'?'keyEncipherment':'digitalSignature'}\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n${delegated==='valid'||delegated==='wrongusage'?'extendedKeyUsage=OCSPSigning\n':''}`);
   run(['x509','-req','-in',signer+'.csr','-CA',issuer+'.crt','-CAkey',issuer+'.key','-CAcreateserial','-sha256','-days','3','-extfile',signer+'.ext','-out',signer+'.crt']);
  }
  execFileSync('openssl',['ocsp','-index',`index-${n}.txt`,'-rsigner',signer+'.crt','-rkey',signer+'.key','-CA',issuer+'.crt',
    '-reqin',`request-${n}.der`,'-respout',`response-${n}.der`,'-ndays','1','-rmd','sha256'],{cwd:dir,stdio:'ignore'});
  return readFileSync(join(dir,`response-${n}.der`));
 };
 return {root:createHash('sha256').update(certs[2]!.raw).digest('hex'),ocsp,sign:(p:object)=>{
  const input=header+'.'+Buffer.from(JSON.stringify(p)).toString('base64url');
  return input+'.'+sign('sha256',Buffer.from(input),{key:readFileSync(join(dir,'leaf.key')),dsaEncoding:'ieee-p1363'}).toString('base64url');
 },close:()=>rmSync(dir,{recursive:true,force:true})};
}
