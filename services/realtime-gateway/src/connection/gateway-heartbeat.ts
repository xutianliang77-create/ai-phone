import type {WebSocket} from 'ws';
export function bindGatewayHeartbeat(ws:WebSocket,intervalMs:number){
 let alive=true;
 ws.on('pong',()=>{alive=true;});
 return setInterval(()=>{if(!alive){ws.terminate();return;}alive=false;ws.ping();},intervalMs);
}
