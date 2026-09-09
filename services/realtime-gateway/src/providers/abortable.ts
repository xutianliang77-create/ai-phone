/** Bound waiting even when an injected transport ignores cancellation. Native fetch
 * also receives the signal so its underlying request/body can be cancelled. */
export async function abortable<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
  let listener:()=>void=()=>{};
  const abort=new Promise<never>((_resolve,reject)=>{
    listener=()=>reject(new DOMException("Aborted","AbortError"));
    if(signal.aborted)listener();else signal.addEventListener("abort",listener,{once:true});
  });
  try{return await Promise.race([promise,abort]);}finally{signal.removeEventListener("abort",listener);}
}
