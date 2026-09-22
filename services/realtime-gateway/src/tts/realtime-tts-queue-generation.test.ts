import assert from 'node:assert/strict';
import {it as test} from 'vitest';
import {RealtimeTtsOutputQueue} from './realtime-tts-output.js';
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {resolve,promise};};
const tick=()=>new Promise(r=>setTimeout(r,0));
const event=(id:string,revision=1)=>({type:'translation.final',sessionId:'test',segmentId:id,revision,text:'Synthetic.',language:'en'} as const);
const audio=(id:string,revision:number)=>({type:'audio.output',sessionId:'test',segmentId:id,revision,sequence:1,format:'pcm16',sampleRate:16000,data:'AAA=',isFinal:true} as const);

test('CONTROL duplicate and stale translation revisions are not spoken twice',async()=>{
  const sent:any[]=[];const queue=new RealtimeTtsOutputQueue({sessionId:'test',voiceOutput:true,isSessionActive:()=>true,
    synthesizer:{enabled:true,cancelSession(){},closeSession(){},async *synthesizeStream(e){yield audio(e.segmentId,e.revision??0);}}});
  try{queue.enqueue(event('A',2),e=>sent.push(e));await queue.drain();
    queue.enqueue(event('A',2),e=>sent.push(e));queue.enqueue(event('A',1),e=>sent.push(e));await queue.drain();
    assert.deepEqual(sent.map(e=>[e.segmentId,e.revision]),[['A',2]]);
  }finally{queue.close();}
});
test('CONTROL backpressure works within one generation',async()=>{
  const pending=deferred(),started=deferred(),sent:any[]=[],drops:string[]=[];
  const queue=new RealtimeTtsOutputQueue({sessionId:'test',voiceOutput:true,isSessionActive:()=>true,maxPendingOutputs:1,
    onDrop:e=>drops.push(e.segmentId),synthesizer:{enabled:true,cancelSession(){},closeSession(){},async *synthesizeStream(e){started.resolve();await pending.promise;yield audio(e.segmentId,e.revision??0);}}});
  try{queue.enqueue(event('A'),e=>sent.push(e));await started.promise;queue.enqueue(event('B'),e=>sent.push(e));
    pending.resolve();await queue.drain();assert.deepEqual(drops,['B']);assert.deepEqual(sent.map(e=>e.segmentId),['A']);
  }finally{pending.resolve();queue.close();await queue.drainInFlight();}
});
test('legacy unversioned finals retain their serialized behavior',async()=>{
  const sent:any[]=[];const queue=new RealtimeTtsOutputQueue({sessionId:'test',voiceOutput:true,isSessionActive:()=>true,
    synthesizer:{enabled:true,cancelSession(){},closeSession(){},async *synthesizeStream(e){yield audio(e.segmentId,e.revision??0);}}});
  try{const first={...event('A'),revision:undefined};queue.enqueue(first,e=>sent.push(e));queue.enqueue(first,e=>sent.push(e));
    await queue.drain();assert.equal(sent.length,2);
  }finally{queue.close();}
});
test('F7 correcting A must retain unrelated queued B and C',async()=>{
  const first=deferred(),entered=deferred(),sent:any[]=[],drops:string[]=[];
  const queue=new RealtimeTtsOutputQueue({sessionId:'test',voiceOutput:true,isSessionActive:()=>true,onDrop:e=>drops.push(e.segmentId),
    synthesizer:{enabled:true,cancelSession(){},closeSession(){},async *synthesizeStream(e){
      if(e.segmentId==='A'&&e.revision===1){entered.resolve();await first.promise;}yield audio(e.segmentId,e.revision??0);}}});
  try{
    queue.enqueue(event('A'),e=>sent.push(e));await entered.promise;
    queue.enqueue(event('B'),e=>sent.push(e));queue.enqueue(event('C'),e=>sent.push(e));
    queue.enqueue(event('A',2),e=>sent.push(e));first.resolve();await queue.drain();await queue.drainInFlight();
    assert.deepEqual(sent.map(e=>`${e.segmentId}:${e.revision}`).sort(),['A:2','B:1','C:1'],
      'Unrelated current translations must not disappear when another segment is corrected');
    assert.deepEqual(drops,[]);
  }finally{first.resolve();queue.close();await queue.drainInFlight();}
});
test('F8 old-generation completion must not release current-generation capacity',async()=>{
  const old=deferred(),fresh=deferred(),oldEntered=deferred(),freshEntered=deferred(),sent:any[]=[],drops:string[]=[];
  const queue=new RealtimeTtsOutputQueue({sessionId:'test',voiceOutput:true,isSessionActive:()=>true,maxPendingOutputs:1,onDrop:e=>drops.push(e.segmentId),
    synthesizer:{enabled:true,cancelSession(){},closeSession(){},async *synthesizeStream(e){
      if(e.segmentId==='old'){oldEntered.resolve();await old.promise;}
      if(e.segmentId==='fresh'){freshEntered.resolve();await fresh.promise;}yield audio(e.segmentId,e.revision??0);}}});
  try{
    queue.enqueue(event('old'),e=>sent.push(e));await oldEntered.promise;queue.cancelPending();
    queue.enqueue(event('fresh'),e=>sent.push(e));await freshEntered.promise;
    assert.equal(queue.diagnostics().pendingOutputs,1);old.resolve();await tick();
    const countAfterOld=queue.diagnostics().pendingOutputs;
    queue.enqueue(event('extra'),e=>sent.push(e));fresh.resolve();await queue.drain();await queue.drainInFlight();
    assert.deepEqual({countAfterOld,drops,emitted:sent.map(e=>e.segmentId)},
      {countAfterOld:1,drops:['extra'],emitted:['fresh']},'Old cancellation cannot create a false free slot');
  }finally{old.resolve();fresh.resolve();queue.close();await queue.drainInFlight();}
});
