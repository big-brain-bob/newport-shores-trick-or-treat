// The build embeds the map and password page. Secrets are runtime-only.
const encoder = new TextEncoder();
const headers = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'SAMEORIGIN'};
function json(data,status=200,extra={}) {return new Response(JSON.stringify(data),{status,headers:{...headers,'Content-Type':'application/json',...extra}})}
function html(data,status=200) {return new Response(data,{status,headers:{...headers,'Content-Type':'text/html; charset=utf-8'}})}
async function digest(s){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('')}
function equal(a,b){if(typeof a!=='string'||typeof b!=='string')return false;let diff=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return diff===0}
async function signature(payload,env){const key=await crypto.subtle.importKey('raw',encoder.encode(env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(payload)))].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function authorized(req,env){const token=(req.headers.get('Cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('map_session='))?.slice(12);if(!token)return false;const [exp,nonce,sig]=token.split('.');return Number(exp)>Date.now()&&!!nonce&&equal(sig,await signature(exp+'.'+nonce,env))}
const attempts=new Map();
const liveListeners=new Set();
let changeVersion=0;
// Live walker locations: memory only, never written to BUCKET; dropped after WALKER_TTL without an update.
const walkers=new Map(),WALKER_TTL=120000;
// Pointer colors; each active walker holds one exclusively (keep in sync with WALKER_COLORS in map.html).
const WALKER_COLORS=['#1668d0','#d9620b','#7d3cb5','#c2257a','#0b8580','#7a4a1e','#222831','#a87f00'];
function walkerList(){const now=Date.now(),list=[];for(const [id,w] of walkers){if(now-w.t>WALKER_TTL){walkers.delete(id);continue}list.push({id,name:w.name,color:w.color,out:w.out,x:w.x,y:w.y,heading:w.heading})}return list}
function liveStream(req,env){
 let stop=()=>{};
 const stream=new ReadableStream({start(controller){
  let closed=false,timer,last='',lastWalkers='',lastHeartbeat=0;const started=Date.now();
  const send=(event,data)=>{if(closed)return;try{controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))}catch(e){stop()}};
  const notify=mark=>send('mark',mark);
  stop=()=>{if(closed)return;closed=true;clearTimeout(timer);liveListeners.delete(notify);req.signal.removeEventListener('abort',stop);try{controller.close()}catch(e){}};
  liveListeners.add(notify);req.signal.addEventListener('abort',stop,{once:true});
  controller.enqueue(encoder.encode('retry: 1000\n\n'));
  async function tick(){
   if(closed)return;
   if(Date.now()-started>55000){stop();return}
   try{
    const generation=changeVersion;
    const result=await env.BUCKET.list({prefix:'marks/',limit:1000,include:['customMetadata']});
    const marks=result.objects.map(o=>({id:Number(o.key.slice(6)),status:o.customMetadata?.status||'unvisited'}));
    const serialized=JSON.stringify(marks);
    if(generation===changeVersion&&serialized!==last){send('snapshot',{marks});last=serialized}
    const walkersNow=JSON.stringify(walkerList());if(walkersNow!==lastWalkers){send('walkers',{walkers:JSON.parse(walkersNow)});lastWalkers=walkersNow}
    if(Date.now()-lastHeartbeat>15000){send('heartbeat',{ok:true});lastHeartbeat=Date.now()}
   }catch(e){send('storage-error',{error:'Shared storage unavailable'})}
   if(!closed)timer=setTimeout(tick,750);
  }
  tick();
 },cancel(){stop()}});
 return new Response(stream,{headers:{...headers,'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-store, no-transform','X-Accel-Buffering':'no'}});
}
function sameOrigin(req){const origin=req.headers.get('Origin');return origin===new URL(req.url).origin}
export default {async fetch(req,env){
 try{
 const url=new URL(req.url),path=url.pathname;
 if(!env.PASSWORD_HASH||!env.SESSION_SECRET)return html('<h1>Map temporarily unavailable</h1>',503);
 if(path==='/api/login'&&req.method==='POST'){
  if(!sameOrigin(req))return json({error:'Invalid origin'},403);
  const ip=req.headers.get('CF-Connecting-IP')||'unknown',now=Date.now(),entry=attempts.get(ip);
  if(entry&&entry.reset>now&&entry.count>=10)return json({error:'Too many attempts. Try again in a minute.'},429,{'Retry-After':'60'});
  if(attempts.size>5000)for(const [k,v] of attempts)if(v.reset<now)attempts.delete(k);
  const record=entry&&entry.reset>now?entry:{count:0,reset:now+60000};record.count++;attempts.set(ip,record);
  if(Number(req.headers.get('Content-Length'))>2048)return json({error:'Request too large'},413);
  const body=await req.json().catch(()=>null);
  if(typeof body?.password!=='string'||body.password.length>256||!equal(await digest(body.password),env.PASSWORD_HASH))return json({error:'Incorrect password'},401);
  attempts.delete(ip);
  const payload=(now+7*24*3600*1000)+'.'+crypto.randomUUID();const token=payload+'.'+await signature(payload,env);
  return json({ok:true},200,{'Set-Cookie':`map_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`});
 }
 const auth=await authorized(req,env);
 if(path==='/api/logout'&&req.method==='POST'){
  if(!sameOrigin(req))return json({error:'Invalid origin'},403);
  return json({ok:true},200,{'Set-Cookie':'map_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'});
 }
 if(path.startsWith('/api/')){
  if(!auth)return json({error:'Password required'},401);
  if(!env.BUCKET)return json({error:'Shared storage is unavailable'},503);
  if(path==='/api/live'&&req.method==='GET')return liveStream(req,env);
  if(path==='/api/marks'&&req.method==='GET'){
   const result=await env.BUCKET.list({prefix:'marks/',limit:1000,include:['customMetadata']});
   return json({marks:result.objects.map(o=>({id:Number(o.key.slice(6)),status:o.customMetadata?.status||'unvisited'}))});
  }
  if(path==='/api/marks'&&req.method==='PUT'){
   if(!sameOrigin(req))return json({error:'Invalid origin'},403);
   if(Number(req.headers.get('Content-Length'))>2048)return json({error:'Request too large'},413);
   const body=await req.json().catch(()=>null);
   if(!Number.isInteger(body?.id)||body.id<0||body.id>=346||!['visited','no-candy','unvisited'].includes(body.status))return json({error:'Invalid house mark'},400);
   const key='marks/'+body.id;
   if(body.status==='visited'){
    const current=await env.BUCKET.head(key);
    if(current?.customMetadata?.status==='no-candy')return json({error:'Hold to remove the no-candy X first.'},409);
   }
   await env.BUCKET.put(key,JSON.stringify({status:body.status}),{customMetadata:{status:body.status},httpMetadata:{contentType:'application/json'}});
   changeVersion++;for(const notify of liveListeners)notify({id:body.id,status:body.status});
   return json({ok:true,id:body.id,status:body.status});
  }
  if(path==='/api/location'&&req.method==='PUT'){
   if(!sameOrigin(req))return json({error:'Invalid origin'},403);
   if(Number(req.headers.get('Content-Length'))>1024)return json({error:'Request too large'},413);
   const body=await req.json().catch(()=>null);
   if(typeof body?.id!=='string'||!/^[A-Za-z0-9-]{8,64}$/.test(body.id))return json({error:'Invalid walker'},400);
   if(body.off===true){walkers.delete(body.id);return json({ok:true})}
   const name=typeof body.name==='string'?body.name.trim().slice(0,32):'';
   if(!WALKER_COLORS.includes(body.color))return json({error:'Invalid color'},400);
   const taken=walkerList().filter(w=>w.id!==body.id).map(w=>w.color);
   if(taken.includes(body.color))return json({error:'Color taken',taken},409);
   if(body.out===true){if(!walkers.has(body.id)&&walkers.size>=200)return json({error:'Too many walkers'},429);walkers.set(body.id,{name,color:body.color,out:true,x:null,y:null,t:Date.now()});return json({ok:true})}
   const heading=Number.isFinite(body.heading)&&body.heading>=0&&body.heading<=360?Math.round(body.heading)%360:null;
   if(!Number.isFinite(body.x)||!Number.isFinite(body.y)||body.x<0||body.x>1400||body.y<0||body.y>1340)return json({error:'Invalid location'},400);
   if(!walkers.has(body.id)&&walkers.size>=200)return json({error:'Too many walkers'},429);
   walkers.set(body.id,{name,color:body.color,heading,out:false,x:Math.round(body.x*10)/10,y:Math.round(body.y*10)/10,t:Date.now()});
   return json({ok:true});
  }
  return json({error:'Not found'},404);
 }
 if(path==='/'||path==='/index.html')return html(auth?MAP_HTML:LOGIN_HTML);
 return new Response('Not found',{status:404,headers});
 }catch(e){return json({error:'The map could not reach shared storage. Try again.'},503)}
}};
