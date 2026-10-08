import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import { postJson } from '../src/core.mjs';

test('HTTPS POST uses pinned address, TLS verification/id header and never follows redirects',async t=>{
  let calls=0,options,body;
  t.mock.method(https,'request',(url,opts,respond)=>{
    calls++;options=opts;assert.equal(url.hostname,'notify.example.net');
    const request=new EventEmitter();request.destroy=()=>{};request.end=value=>{
      body=value;queueMicrotask(()=>respond({statusCode:302,destroy:()=>{}}));
    };return request;
  });
  const result=await postJson(new URL('https://notify.example.net/token-dummy'),{address:'8.8.8.8',family:4},'dummy-only-key',{text:'fixture'},
    {notificationId:'dedup-fixture',timeoutMs:30});
  assert.equal(result.state,'HTTP_REJECTED');assert.equal(calls,1);
  assert.equal(options.rejectUnauthorized,true);assert.equal(options.agent,false);assert.equal(options.autoSelectFamily,false);
  assert.equal(options.servername,'notify.example.net');assert.equal(options.headers['X-Pi-Notification-Id'],'dedup-fixture');
  assert.equal(options.headers.Authorization,'Bearer dummy-only-key');
  options.lookup('ignored-private-dns',{all:false},(error,address,family)=>{
    assert.equal(error,null);assert.equal(address,'8.8.8.8');assert.equal(family,4);
  });
  assert.deepEqual(JSON.parse(body.toString()),{text:'fixture'});
});
test('no response has a bounded timeout, destroys request and never retries',async t=>{
  let calls=0,destroyed=0;
  t.mock.method(https,'request',()=>{
    calls++;const request=new EventEmitter();request.destroy=()=>{destroyed++;};request.end=()=>{};return request;
  });
  await assert.rejects(postJson(new URL('https://notify.example.net/'),{address:'8.8.8.8',family:4},'',{}, {timeoutMs:10}),
    /without confirmed acceptance/);
  assert.equal(calls,1);assert.equal(destroyed,1);
});
test('already-aborted request never writes POST body',async t=>{
  let writes=0;
  t.mock.method(https,'request',()=>{
    const request=new EventEmitter();request.destroy=()=>{};request.end=()=>{writes++;};return request;
  });
  const controller=new AbortController();controller.abort();
  await assert.rejects(postJson(new URL('https://notify.example.net/'),{address:'8.8.8.8',family:4},'',{}, {signal:controller.signal}),
    /without confirmed acceptance/);assert.equal(writes,0);
});
