import { promises as fs, constants } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP, BlockList } from 'node:net';
import https from 'node:https';

export const VERSION = '1.1.1';
export const TIMEOUT_MS = 8000;
const hash = value => createHash('sha256').update(value).digest('hex');
const blocks = new BlockList();
for (const [ip, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],
  ['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],
  ['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) blocks.addSubnet(ip,prefix,'ipv4');
const global6 = new BlockList(); global6.addSubnet('2000::',3,'ipv6');
const reserved6 = new BlockList(); reserved6.addSubnet('2001::',23,'ipv6'); reserved6.addSubnet('2001:db8::',32,'ipv6');
export function publicAddress(address) {
  const family = isIP(address);
  return family === 4 ? !blocks.check(address,'ipv4') :
    family === 6 && global6.check(address,'ipv6') && !reserved6.check(address,'ipv6');
}
export function validateEndpoint(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid HTTPS endpoint.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash ||
    (url.port && url.port !== '443') || isIP(url.hostname.replace(/^\[|\]$/g,'')) ||
    !url.hostname.includes('.') || url.hostname.length > 253 ||
    !url.hostname.split('.').every(part => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(part)) ||
    /\.(localhost|local|internal)$/i.test(url.hostname) || url.href.length > 4096) {
    throw new Error('Only public DNS HTTPS endpoints on port443 are allowed.');
  }
  return url;
}
export function validateConfig(input) {
  if (!input || input.version !== 1 || typeof input.enabled !== 'boolean' ||
    typeof input.key !== 'string' || input.key.length > 4096 || /[\r\n\x00-\x1f\x7f]/.test(input.key) ||
    !['generic','slack','discord'].includes(input.format) ||
    !Array.isArray(input.notifyOn) || !input.notifyOn.length ||
    !input.notifyOn.every(value => ['completed','error','aborted'].includes(value))) throw new Error('Invalid webhook configuration.');
  const url = validateEndpoint(input.url);
  return {version:1,enabled:input.enabled,url:url.href,key:input.key,format:input.format,notifyOn:[...new Set(input.notifyOn)]};
}
export async function resolveDestination(url, resolver = lookup) {
  const rows = await resolver(url.hostname, {all:true,verbatim:true});
  if (!Array.isArray(rows) || !rows.length || rows.some(row => !publicAddress(row.address))) throw new Error('Destination has a forbidden or unresolved address.');
  return {address:rows[0].address,family:rows[0].family};
}
async function privateDirectory(path) {
  await fs.mkdir(path,{recursive:true,mode:0o700});
  const stat = await fs.lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())) throw new Error('Unsafe webhook storage directory.');
  await fs.chmod(path,0o700);
}
async function privateRead(path) {
  let handle;
  try {
    handle = await fs.open(path,constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 16384 || (process.getuid && stat.uid !== process.getuid()) ||
      (process.platform !== 'win32' && (stat.mode & 0o077))) throw new Error('Unsafe webhook file permissions or size.');
    return JSON.parse(await handle.readFile('utf8'));
  } finally { await handle?.close(); }
}
async function atomicJson(path, data) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary,'wx',0o600);
    await handle.writeFile(JSON.stringify(data,null,2)+'\n'); await handle.sync(); await handle.close(); handle = undefined;
    await fs.rename(temporary,path);
  } finally { await handle?.close(); await fs.unlink(temporary).catch(() => {}); }
}
export class Store {
  constructor(root) { this.root=root; this.configPath=join(root,'config.json'); this.preferencesPath=join(root,'preferences.json'); this.eventsPath=join(root,'events'); }
  async readConfig() {
    try { return validateConfig(await privateRead(this.configPath)); }
    catch (error) { if (error.code === 'ENOENT') return null; throw new Error('Webhook config unavailable/invalid; no notification sent.'); }
  }
  async readDefault() {
    try {
      const data=await privateRead(this.preferencesPath);
      if(!data || Object.keys(data).sort().join()!=='defaultEnabled,version' || data.version!==1 || typeof data.defaultEnabled!=='boolean') throw new Error('Invalid preferences.');
      return data.defaultEnabled;
    } catch(error) { if(error.code==='ENOENT')return false;throw new Error('Webhook preferences unavailable/invalid; no automatic notification sent.'); }
  }
  async writeDefault(defaultEnabled) {
    if(typeof defaultEnabled!=='boolean')throw new Error('Invalid default preference.');
    await privateDirectory(this.root);await atomicJson(this.preferencesPath,{version:1,defaultEnabled});
  }
  async writeConfig(input) { const config=validateConfig(input); await privateDirectory(this.root); await atomicJson(this.configPath,config); }
  async clear() { await fs.unlink(this.configPath).catch(error => { if(error.code!=='ENOENT') throw error; }); }
  async claim(id, metadata) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid notification identity.');
    await privateDirectory(this.root); await privateDirectory(this.eventsPath);
    const folder=join(this.eventsPath,id);
    try { await fs.mkdir(folder,{mode:0o700}); }
    catch(error) { if(error.code==='EEXIST') return null; throw error; }
    // Directory creation is the durable cross-process claim. Never reuse even if receipt writing fails.
    const receipt={...metadata,notification_id:id,state:'SENDING',started_at:new Date().toISOString()};
    await atomicJson(join(folder,'receipt.json'),receipt);
    return receipt;
  }
  async finish(id, receipt, result) {
    await atomicJson(join(this.eventsPath,id,'receipt.json'),{...receipt,...result,finished_at:new Date().toISOString()});
  }
  async recent() {
    let names; try {names=await fs.readdir(this.eventsPath);} catch(error) {if(error.code==='ENOENT')return [];throw error;}
    const records=[];
    for(const name of names.filter(name=>/^[a-f0-9]{64}$/.test(name)).slice(-100)) {
      try {const row=await privateRead(join(this.eventsPath,name,'receipt.json'));records.push({...row,state:row.state==='SENDING'?'UNKNOWN':row.state});}
      catch {records.push({notification_id:name,state:'UNKNOWN',reason:'Incomplete claim; do not resend.'});}
    }
    return records.sort((a,b)=>(b.started_at??'').localeCompare(a.started_at??'')).slice(0,20);
  }
}
export function notificationId(sessionId, terminalEntryId, outcome, namespace='') { return hash(JSON.stringify(['pi-webhook-v1',namespace,sessionId,terminalEntryId,outcome])); }
const clean = (value,limit=100) => String(value??'').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,limit);
export function formatSendTime(sentAt) {
  if (!(sentAt instanceof Date) || !Number.isFinite(sentAt.getTime())) throw new Error('Invalid webhook send time.');
  const pad = n => String(n).padStart(2,'0');
  const offset = -sentAt.getTimezoneOffset();
  const zone = `UTC${offset < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offset)/60))}:${pad(Math.abs(offset)%60)}`;
  return `${String(sentAt.getFullYear()).padStart(4,'0')}-${pad(sentAt.getMonth()+1)}-${pad(sentAt.getDate())} ${pad(sentAt.getHours())}:${pad(sentAt.getMinutes())}:${pad(sentAt.getSeconds())} ${zone}`;
}
export function makePayload({id,sessionId,sessionName,cwd,outcome,elapsedMs,test=false},format='generic',sentAt=new Date()) {
  const label=test?'測試通知':outcome==='completed'?'完成':outcome==='aborted'?'回合已取消':'回合發生錯誤';
  const workspace=clean(basename(cwd??''),60);
  const base=`Pi ${label} · ${workspace || 'workspace'} · ${clean(sessionName || sessionId,80)}`;
  const suffix=` · ${formatSendTime(sentAt)}`;
  const text=base+suffix;
  if(format==='slack') return {text};
  if(format==='discord') return {content:(base.endsWith(' @everyone')?base:`${base} @everyone`)+suffix,allowed_mentions:{parse:['everyone']}};
  return {schema_version:1,event:test?'pi.webhook.test':'pi.agent.settled',notification_id:id,status:outcome,session_id:clean(sessionId),
    session_name:clean(sessionName),workspace,finished_at:sentAt.toISOString(),elapsed_ms:Math.max(0,Math.round(elapsedMs??0)),text};
}
export function postJson(url,destination,key,payload,{signal,timeoutMs=TIMEOUT_MS,notificationId: id}={}) {
  const body=Buffer.from(JSON.stringify(payload));
  if(body.length>4096) return Promise.reject(new Error('Notification payload too large.'));
  return new Promise((resolve,reject)=>{
    let done=false;
    const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(new Error('Webhook request ended without confirmed acceptance.')):resolve(result);};
    const request=https.request(url,{method:'POST',agent:false,servername:url.hostname,
      rejectUnauthorized:true,family:destination.family,autoSelectFamily:false,
      lookup:(_host,_options,callback)=>callback(null,destination.address,destination.family),
      headers:{'Content-Type':'application/json','Content-Length':body.length,'User-Agent':'pi-webhook-notifier/1.1.1',
        'X-Pi-Notification-Id':id??payload.notification_id??'',...(key?{Authorization:`Bearer ${key}`}:{})}},response=>{
      // Never follow redirects or store/echo response bodies (which can contain secrets).
      response.destroy(); finish(null,{state:response.statusCode>=200&&response.statusCode<300?'ACCEPTED':'HTTP_REJECTED',http_status:response.statusCode});
    });
    const timer=setTimeout(()=>{request.destroy();finish(new Error('timeout'));},timeoutMs);
    const abort=()=>{request.destroy();finish(new Error('abort'));};
    request.on('error',()=>finish(new Error('network')));
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted) {abort();return;}
    request.end(body);
  });
}
export async function deliver(store, config, event, {resolver=lookup,transport=postJson,signal,timeoutMs=TIMEOUT_MS,clock=()=>new Date()}={}) {
  config=validateConfig(config);
  if(!config.enabled || !config.notifyOn.includes(event.outcome)) return {state:'SKIPPED'};
  const url=validateEndpoint(config.url);
  const receipt=await store.claim(event.id,{session_id:clean(event.sessionId),status:event.outcome,
    endpoint_host:url.hostname,endpoint_fingerprint:hash(url.href),test:event.test===true});
  if(!receipt)return {state:'DUPLICATE_NO_RESEND'};
  let result; let dispatched=false; let timer;
  const deadline=Date.now()+timeoutMs;
  try {
    const destination=await Promise.race([resolveDestination(url,resolver),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('DNS timeout')),timeoutMs);})]);
    clearTimeout(timer);
    if(signal?.aborted || Date.now()>=deadline)throw new Error('Cancelled/expired before dispatch');
    // Capture once, after claim/DNS and cancellation checks, immediately before POST.
    // Text and legacy finished_at share this dispatch time, not the turn start time.
    const payload=makePayload(event,config.format,clock());
    // Include the id header even for Slack/Discord, without extra payload fields.
    const sendPayload=payload;
    dispatched=true;
    result=await transport(url,destination,config.key,sendPayload,{signal,timeoutMs:Math.max(1,deadline-Date.now()),notificationId:event.id});
    if(!['ACCEPTED','HTTP_REJECTED'].includes(result?.state)) throw new Error('Unconfirmed transport result');
  } catch {
    result={state:dispatched?'UNKNOWN':'FAILED_PRECHECK',reason:dispatched?'No confirmed HTTP acceptance; never auto-resend.':'Destination validation or pre-dispatch failed; no POST submitted.'};
  } finally {clearTimeout(timer);}
  await store.finish(event.id,receipt,result);
  return result;
}
export function settledSnapshot(branch,sessionId,outcome,namespace='') {
  const last=[...branch].reverse().find(entry=>entry.type==='message'&&entry.message?.role==='assistant');
  if(!last)return null;
  if(outcome==='completed'&&last.message.stopReason!=='stop')return null;
  if(outcome==='error'&&last.message.stopReason!=='error'&&last.message.stopReason!=='length')return null;
  if(outcome==='aborted'&&last.message.stopReason!=='aborted')return null;
  return {id:notificationId(sessionId,last.id,outcome,namespace),terminalEntryId:last.id,outcome,sessionId};
}
