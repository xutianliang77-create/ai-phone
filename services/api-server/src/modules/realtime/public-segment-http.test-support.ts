import {request} from "node:http";
/** Real loopback HTTP with a socket deadline independent of the test's Date
 * clock. Never app.inject, and never a transport to a supplier/production API. */
export const loopbackFetch:typeof fetch=async(input,init)=>{
  const url=new URL(String(input));
  if(url.protocol!=="http:"||url.hostname!=="127.0.0.1")throw Error("loopback HTTP only");
  return new Promise<Response>((resolve,reject)=>{
    const req=request(url,{method:init?.method??"GET",headers:Object.fromEntries(new Headers(init?.headers).entries())},res=>{
      const chunks:Buffer[]=[];let size=0;
      res.on("data",(data:Buffer)=>{size+=data.length;if(size>1024*1024)req.destroy(Error("bounded fixture response"));else chunks.push(data);});
      res.on("error",reject);
      res.on("end",()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode??500,
        headers:{"content-type":String(res.headers["content-type"]??"application/json")}})));
    });
    req.setTimeout(10000,()=>req.destroy(Error("fixture HTTP socket deadline")));
    req.on("error",reject);
    req.end(init?.body===undefined?undefined:String(init.body));
  });
};
