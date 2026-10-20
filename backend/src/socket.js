'use strict'
const {WebSocketServer,WebSocket}=require('ws')
const {ownerId}=require('./jobs')
function attachChatSocket(server,jobs,config){
 const wss=new WebSocketServer({noServer:true,maxPayload:1024,perMessageDeflate:false})
 server.on('upgrade',(req,socket,head)=>{
  let url;try{url=new URL(req.url,'http://localhost')}catch{socket.destroy();return}
  const id=/^\/chat\/jobs\/([a-f0-9-]{36})\/stream$/.exec(url.pathname)?.[1]
  if(!id||(config.deployment==='cloud'&&(!req.headers['x-wx-source']||!req.headers['x-wx-openid']))){socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');return}
  const owner=ownerId(req)
  jobs.get(id,owner).then(()=>{
   if(socket.destroyed)return
   wss.handleUpgrade(req,socket,head,ws=>watch(ws,id,owner))
  }).catch(()=>socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'))
 })
 function watch(ws,id,owner){
  let last='',timer,busy=false,alive=true,unsubscribe=()=>{}
  const cleanup=()=>{clearInterval(timer);unsubscribe()}
  const send=value=>{
   if(ws.readyState!==WebSocket.OPEN)return
   const payload=JSON.stringify(value);if(payload===last)return
   last=payload
   if(ws.bufferedAmount>262144){ws.terminate();return}
   ws.send(payload)
   if(value.status!=='running'){cleanup();ws.close(1000,'finished')}
  }
  unsubscribe=jobs.subscribe(id,send)
  ws.on('close',cleanup);ws.on('error',cleanup);ws.on('pong',()=>{alive=true})
  const refresh=async()=>{
   if(busy||ws.readyState!==WebSocket.OPEN)return
   busy=true
   try{send(await jobs.get(id,owner))}catch{ws.close(1011,'read failed')}finally{busy=false}
  }
  // Checkpoints make a connection to another replica work too.
  let ticks=0
  timer=setInterval(()=>{if(++ticks%20===0){if(!alive){ws.terminate();return}alive=false;ws.ping()}refresh()},750)
  timer.unref();refresh()
 }
 server.on('close',()=>{for(const ws of wss.clients)ws.terminate();wss.close()})
 return wss
}
module.exports={attachChatSocket}
