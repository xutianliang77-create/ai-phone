/** Read extension OIDs only from TBSCertificate [3], not from arbitrary bytes
 * in a subject name or another extension's OCTET STRING. */
function node(b,offset){
 const tag=b[offset],first=b[offset+1];if(tag===undefined||first===undefined)throw Error('der');let length=first,start=offset+2;
 if(first&128){const n=first&127;if(!n||n>4||start+n>b.length)throw Error('der');length=0;for(let i=0;i<n;i++)length=length*256+b[start++];}
 if(start+length>b.length)throw Error('der');return {tag,start,end:start+length,offset};
}
function children(b,n){const a=[];for(let p=n.start;p<n.end;){const c=node(b,p);if(c.end>n.end||c.end<=p)throw Error('der');a.push(c);p=c.end;}return a;}
export function hasCertificateExtension(raw,encodedOid){
 try{const certificate=node(raw,0);if(certificate.tag!==48||certificate.end!==raw.length)return false;
  const tbs=children(raw,certificate)[0],extensions=children(raw,tbs).find(n=>n.tag===163);if(!extensions)return false;
  const seq=children(raw,extensions)[0];if(seq.tag!==48)return false;
  return children(raw,seq).some(ext=>{const oid=children(raw,ext)[0];return oid.tag===6&&raw.subarray(oid.offset,oid.end).equals(encodedOid);});
 }catch{return false;}
}
