import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {Store,makePayload,formatSendTime,deliver,notificationId} from '../src/core.mjs';
const at=new Date('2026-01-01T23:04:05.987Z');
const event={id:notificationId('timestamp-fixture','terminal','completed'),sessionId:'timestamp-fixture',sessionName:'Fixture',cwd:'/fixture/work',outcome:'completed',elapsedMs:99999999};
test('all formats/outcomes/test suffix one fixed dispatch timestamp with explicit offset',()=>{
 const suffix=` · ${formatSendTime(at)}`;
 for(const format of ['generic','slack','discord'])for(const outcome of ['completed','error','aborted'])for(const isTest of [false,true]){
  const payload=makePayload({...event,outcome,test:isTest,finished_at:'2000-01-01T00:00:00Z'},format,at);
  const text=payload.content??payload.text;
  assert(text.endsWith(suffix));assert(!text.includes('2000-01-01'));
  assert.match(text,/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC[+-]\d{2}:\d{2}$/);
  assert.equal(text.includes('Pi 測試通知'),isTest);
  if(format==='generic')assert.equal(payload.finished_at,at.toISOString());
  if(format==='discord'){assert.deepEqual(payload.allowed_mentions,{parse:['everyone']});assert.equal(text.match(/@everyone/g).length,1);}
 }
 assert.throws(()=>formatSendTime(new Date(NaN)),/Invalid/);
});
test('OS timezones include day rollover, fractional offset and seasonal DST',()=>{
 const module=new URL('../src/core.mjs',import.meta.url).href;
 const run=(zone,iso)=>execFileSync(process.execPath,['--input-type=module','-e',`import {formatSendTime} from ${JSON.stringify(module)};console.log(formatSendTime(new Date(${JSON.stringify(iso)})));`],{env:{...process.env,TZ:zone},encoding:'utf8'}).trim();
 assert.equal(run('UTC',at.toISOString()),'2026-01-01 23:04:05 UTC+00:00');
 assert.equal(run('Asia/Taipei',at.toISOString()),'2026-01-02 07:04:05 UTC+08:00');
 assert.equal(run('Asia/Kathmandu',at.toISOString()),'2026-01-02 04:49:05 UTC+05:45');
 assert.equal(run('America/New_York',at.toISOString()),'2026-01-01 18:04:05 UTC-05:00');
 assert.equal(run('America/New_York','2026-07-01T23:04:05Z'),'2026-07-01 19:04:05 UTC-04:00');
});
test('delivery captures after DNS, immediately before transport, once; new clocks never bypass dedup',async()=>{
 const root=await mkdtemp(join(tmpdir(),'webhook send timestamp '));
 try{
  const store=new Store(join(root,'store'));
  const config={version:1,enabled:true,url:'https://notify.example.invalid/test',key:'',format:'generic',notifyOn:['completed']};
  let time=new Date('2000-01-01T00:00:00Z'),clockCalls=0,posts=0;
  const resolver=async()=>{time=at;return [{address:'8.8.8.8',family:4}];};
  const clock=()=>{clockCalls++;return time;};
  const transport=async(_url,_destination,_key,payload)=>{posts++;assert(payload.text.endsWith(formatSendTime(at)));assert.equal(payload.finished_at,at.toISOString());return {state:'ACCEPTED',http_status:204};};
  assert.equal((await deliver(store,config,event,{resolver,transport,clock})).state,'ACCEPTED');
  assert.equal(clockCalls,1);assert.equal(posts,1);
  time=new Date('2027-01-01T00:00:00Z');
  assert.equal((await deliver(new Store(store.root),config,event,{resolver,transport,clock})).state,'DUPLICATE_NO_RESEND');
  assert.equal(clockCalls,1);assert.equal(posts,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
