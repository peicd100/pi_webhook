import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Store, validateEndpoint, validateConfig, publicAddress, resolveDestination, notificationId, makePayload, formatSendTime, deliver, settledSnapshot } from '../src/core.mjs';
const config = {version:1,enabled:true,url:'https://notify.example.net/secret-endpoint?token=dummy',key:'fixture-secret-only',format:'generic',notifyOn:['completed']};
const resolver = async () => [{address:'8.8.8.8',family:4}];
const event = () => ({id:notificationId('session',randomUUID(),'completed'),sessionId:'session',sessionName:'test session',cwd:'/private/workspace',outcome:'completed',elapsedMs:25});
async function fixture(run) {const root=await mkdtemp(join(tmpdir(),'pi-webhook-fixture-'));try {await run(new Store(join(root,'store')));}finally{await rm(root,{recursive:true,force:true});}}

test('only DNS HTTPS443, no credentials/IP/fragment or internal host endpoints',()=>{
  assert.equal(validateEndpoint(config.url).hostname,'notify.example.net');
  for(const value of ['http://notify.example.net','https://user:password@notify.example.net','https://notify.example.net:8443',
    'https://127.0.0.1/','https://[::1]/','https://localhost/','https://host.internal/','https://notify.example.net/#token']) assert.throws(()=>validateEndpoint(value));
  assert.throws(()=>validateConfig({...config,key:'bad\r\nheader'}));
});
test('reject private, metadata, loopback, mapped, documentation and multicast addresses',()=>{
  for(const ip of ['127.0.0.1','10.1.2.3','100.64.0.1','169.254.169.254','172.16.0.1','192.168.1.1','192.0.2.1','198.51.100.1','203.0.113.1','224.0.0.1','::1','fc00::1','fe80::1','::ffff:127.0.0.1','2001:db8::1']) assert.equal(publicAddress(ip),false,ip);
  for(const ip of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111']) assert.equal(publicAddress(ip),true,ip);
});
test('all resolved addresses validated; pin selected IP and refuse mixed DNS results',async()=>{
  assert.deepEqual(await resolveDestination(validateEndpoint(config.url),resolver),{address:'8.8.8.8',family:4});
  await assert.rejects(resolveDestination(validateEndpoint(config.url),async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]));
});
test('config and receipts permissions restricted; key and endpoint path never enter receipt',()=>fixture(async store=>{
  await store.writeConfig(config);assert.deepEqual(await store.readConfig(),config);
  // POSIX chmod bits are not a Windows ACL proof. The real Windows store ACL is
  // secured and verified separately during installation; fixtures test storage behavior.
  if (process.platform !== 'win32') {
    assert.equal((await stat(store.configPath)).mode&0o777,0o600);
    assert.equal((await stat(store.root)).mode&0o777,0o700);
  }
  const e=event();let calls=0;
  const result=await deliver(store,config,e,{resolver,transport:async(_url,destination,key,payload,options)=>{
    calls++;assert.equal(destination.address,'8.8.8.8');assert.equal(key,config.key);assert.equal(payload.notification_id,e.id);assert.equal(options.notificationId,e.id);return {state:'ACCEPTED',http_status:204};}});
  assert.equal(result.state,'ACCEPTED');assert.equal(calls,1);
  const receipt=await readFile(join(store.eventsPath,e.id,'receipt.json'),'utf8');
  assert.ok(!receipt.includes(config.key));assert.ok(!receipt.includes('secret-endpoint'));assert.ok(!receipt.includes('token=dummy'));
}));
test('cross-process-compatible exclusive claim dedups concurrent and reloaded delivery',()=>fixture(async store=>{
  let calls=0;const e=event();const transport=async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,10));return {state:'ACCEPTED',http_status:200};};
  const results=await Promise.all([deliver(store,config,e,{resolver,transport}),deliver(new Store(store.root),config,e,{resolver,transport})]);
  assert.equal(calls,1);assert.equal(results.filter(r=>r.state==='DUPLICATE_NO_RESEND').length,1);
  assert.equal((await deliver(new Store(store.root),config,e,{resolver,transport})).state,'DUPLICATE_NO_RESEND');assert.equal(calls,1);
}));
test('timeout or thrown network error is UNKNOWN and never retried after reload',()=>fixture(async store=>{
  let calls=0;const e=event();const transport=async()=>{calls++;throw new Error('Secret URL or response must not be logged');};
  assert.equal((await deliver(store,config,e,{resolver,transport})).state,'UNKNOWN');
  assert.equal((await deliver(new Store(store.root),config,e,{resolver,transport})).state,'DUPLICATE_NO_RESEND');assert.equal(calls,1);
  const receipts=await store.recent();assert.equal(receipts[0].state,'UNKNOWN');assert.ok(!JSON.stringify(receipts).includes('Secret URL'));
}));
test('pre-dispatch invalid DNS or cancellation does not POST',()=>fixture(async store=>{
  let calls=0;const transport=async()=>{calls++;return {state:'ACCEPTED'};};
  assert.equal((await deliver(store,config,event(),{resolver:async()=>[{address:'127.0.0.1',family:4}],transport})).state,'FAILED_PRECHECK');
  const controller=new AbortController();controller.abort();
  assert.equal((await deliver(store,config,event(),{resolver,transport,signal:controller.signal})).state,'FAILED_PRECHECK');assert.equal(calls,0);
}));
test('disabled/default failed or aborted outcomes skip without creating a claim',()=>fixture(async store=>{
  const transport=()=>{throw new Error('No dispatch allowed');};
  assert.equal((await deliver(store,{...config,enabled:false},event(),{resolver,transport})).state,'SKIPPED');
  assert.equal((await deliver(store,config,{...event(),outcome:'aborted'},{resolver,transport})).state,'SKIPPED');
  assert.equal((await deliver(store,config,{...event(),outcome:'error'},{resolver,transport})).state,'SKIPPED');
}));
test('incomplete SENDING crash claim surfaces UNKNOWN, credential clear retains dedup evidence',()=>fixture(async store=>{
  await store.writeConfig(config);const e=event();await store.claim(e.id,{status:'completed'});
  assert.equal((await store.recent())[0].state,'UNKNOWN');await store.clear();assert.equal(await store.readConfig(),null);
  assert.equal((await deliver(store,config,e,{resolver,transport:()=>{throw new Error('No resend');}})).state,'DUPLICATE_NO_RESEND');
}));
test('payload has only mechanical metadata, privacy-minimal path and safe Discord mentions',()=>{
  const e=event();const payload=makePayload({...e,prompt:'do not transmit',answer:'do not transmit',key:'do not transmit'});
  assert.equal(payload.workspace,'workspace');assert.ok(!JSON.stringify(payload).includes('/private/'));
  for(const key of ['prompt','answer','key'])assert.equal(key in payload,false);
  assert.deepEqual(Object.keys(makePayload(e,'slack')),['text']);assert.deepEqual(makePayload(e,'discord').allowed_mentions,{parse:['everyone']});
});
test('Discord keeps everyone once before the timestamp; all formats share the same fixed send time',()=>{
  const at=new Date('2026-10-09T03:04:05.678Z'),suffix=` · ${formatSendTime(at)}`;
  for(const outcome of ['completed','error','aborted']) {
    const e={...event(),outcome};
    const original=makePayload(e,'generic',at).text;
    assert.deepEqual(makePayload(e,'discord',at),{content:`${original.slice(0,-suffix.length)} @everyone${suffix}`,allowed_mentions:{parse:['everyone']}});
    assert.deepEqual(makePayload(e,'slack',at),{text:original});
    assert.equal(original.includes('@everyone'),false);
  }
  const e={...event(),sessionName:'already @everyone'};
  const payload=makePayload(e,'discord',at);
  assert.equal(payload.content,makePayload(e,'generic',at).text);
  assert.equal(payload.content.match(/@everyone/g).length,1);
});
test('Discord timestamp does not change concurrent/reloaded at-most-once dispatch',()=>fixture(async store=>{
  const e=event();let calls=0;const at=new Date('2026-10-09T03:04:05Z'),clock=()=>at;
  const transport=async(_url,_destination,_key,payload,options)=>{
    calls++;assert.equal(payload.content,makePayload(e,'discord',at).content);
    assert.deepEqual(payload.allowed_mentions,{parse:['everyone']});
    assert.equal(options.notificationId,e.id);
    await new Promise(resolve=>setTimeout(resolve,10));return {state:'ACCEPTED',http_status:204};
  };
  const discord={...config,format:'discord'};
  const results=await Promise.all([deliver(store,discord,e,{resolver,transport,clock}),deliver(new Store(store.root),discord,e,{resolver,transport,clock})]);
  assert.equal(results.filter(r=>r.state==='ACCEPTED').length,1);
  assert.equal(results.filter(r=>r.state==='DUPLICATE_NO_RESEND').length,1);
  assert.equal((await deliver(new Store(store.root),discord,e,{resolver,transport})).state,'DUPLICATE_NO_RESEND');
  assert.equal(calls,1);
}));
test('Discord suffix does not enable unconfigured error or cancellation notifications',()=>fixture(async store=>{
  let calls=0;const transport=async()=>{calls++;return {state:'ACCEPTED',http_status:204};};
  for(const outcome of ['error','aborted']) {
    const e={...event(),outcome};const discord={...config,format:'discord'};
    assert.equal((await deliver(store,discord,e,{resolver,transport})).state,'SKIPPED');
    assert.equal((await deliver(store,{...discord,notifyOn:[outcome]},e,{resolver,transport})).state,'ACCEPTED');
  }
  assert.equal(calls,2);
}));
test('terminal identity stable across reload; skip nonfinal toolUse and mismatched failure facts',()=>{
  const branch=[{type:'message',id:'terminal',message:{role:'assistant',stopReason:'stop',content:[{type:'text',text:'never inspect contents'}]}}];
  const snapshot=settledSnapshot(branch,'session','completed');assert.equal(snapshot.id,notificationId('session','terminal','completed'));
  assert.equal(settledSnapshot(branch,'session','error'),null);
  assert.equal(settledSnapshot([{...branch[0],message:{role:'assistant',stopReason:'toolUse'}}],'session','completed'),null);
  assert.equal(settledSnapshot([],'session','completed'),null);
});
