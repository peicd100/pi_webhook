import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,readFile,mkdir,writeFile } from 'node:fs/promises';
import dns from 'node:dns/promises';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { Store } from '../src/core.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromHost } from './runtime.mjs';
const { loadExtensions }=await fromHost('dist/core/extensions/loader.js');
const path=fileURLToPath(new URL('../extensions/index.ts',import.meta.url));
async function fixture(run) {
  const root=await mkdtemp(join(tmpdir(),'pi-webhook-extension-'));const old=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=root;
  try {const loaded=await loadExtensions([path],root);assert.deepEqual(loaded.errors,[]);await run(loaded.extensions[0],root);}
  finally {if(old===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=old;await rm(root,{recursive:true,force:true});}
}
const sessionManager={getSessionId:()=> 'fixture-session',getSessionName:()=> 'Fixture',getSessionFile:()=> '/tmp/fixture-session.jsonl',getBranch:()=>[{type:'message',id:'final-entry',message:{role:'assistant',stopReason:'stop',content:[{type:'text',text:'private answer not inspected'}]}}]};

test('public Pi loader exposes only webhook command, no tools/model requests or old agent_end notification',()=>fixture(async extension=>{
  assert.equal(extension.tools.size,0);assert.deepEqual([...extension.commands.keys()],['webhook','webhook-status','webhook-setup','webhook-test','webhook-on','webhook-off','webhook-events','webhook-clear','webhook-default','webhook-session']);
  assert.equal(extension.handlers.has('agent_end'),false);
  assert.equal(extension.handlers.has('agent_settled'),true);
}));
test('unconfigured completed settlement skips mechanically; status masked, secret arguments rejected',()=>fixture(async extension=>{
  const notices=[];const ctx={mode:'sdk',cwd:'/private/work',sessionManager,ui:{notify:text=>notices.push(text)}};
  await extension.handlers.get('session_start')[0]({},ctx);
  await extension.handlers.get('agent_start')[0]({},ctx);
  await extension.handlers.get('turn_end')[0]({outcome:'completed',messageEntryId:'final-entry'},ctx);
  await extension.handlers.get('agent_before_settle')[0]({outcome:'completed'},ctx);
  await extension.handlers.get('agent_settled')[0]({},ctx);
  assert.equal(notices.length,0);
  await extension.commands.get('webhook-status').handler('json',ctx);
  assert.equal(JSON.parse(notices.at(-1)).configured,false);
  assert.equal(JSON.parse(notices.at(-1)).loaded_version,'1.1.1');
  await extension.commands.get('webhook').handler('key dummy-do-not-echo',ctx);
  assert.ok(!notices.at(-1).includes('dummy-do-not-echo'));
  await extension.commands.get('webhook-setup').handler('',ctx);
  assert.match(notices.at(-1),/互動式 TUI/);
  await extension.handlers.get('session_shutdown')[0]({},ctx);
}));
test('masked URL dialog draws no secret, cancels without config write or network',()=>fixture(async extension=>{
  let captured;const notices=[];
  const ctx={mode:'tui',cwd:'/private/work',sessionManager,ui:{notify:text=>notices.push(text),
    select:async(_title,choices)=>{assert.deepEqual(choices,['Discord','Slack','一般 JSON']);return 'Discord';},
    custom:async factory=>{
      let result;const component=factory({requestRender:()=>{}},{},{},value=>{result=value;});
      component.focused=true;component.handleInput('https://private-secret.invalid/token=dummy');
      captured=component.render(90).join('\n');
      assert.ok(!captured.includes('private-secret'));assert.ok(!captured.includes('token=dummy'));assert.match(captured,/\*{5}/);
      component.handleInput('\u001b');component.dispose();return result;
    }}};
  await extension.commands.get('webhook-setup').handler('',ctx);
  assert.ok(captured);assert.equal(notices.length,0);
}));

const configPath=root=>join(root,'config/webhook-notifier/config.json');
function mockSetupNetwork(t) {
  let dnsCalls=0;
  t.mock.method(dns,'lookup',async()=>{dnsCalls++;return [{address:'8.8.8.8',family:4}];});
  syncBuiltinESMExports();
  t.mock.method(https,'request',()=>assert.fail('Setup must never submit a POST'));
  t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
  return ()=>dnsCalls;
}
function setupUI(format,values,enable=true) {
  const stages=[],notices=[];
  const ui={notify:text=>notices.push(text),
    select:async(_title,choices)=>{stages.push('format');assert.deepEqual(choices,['Discord','Slack','一般 JSON']);return {discord:"Discord",slack:"Slack",generic:"一般 JSON"}[format];},
    custom:async factory=>{
      let result;const component=factory({requestRender:()=>{}},{},{},value=>{result=value;});
      component.focused=true;const title=component.render(90)[0];
      stages.push(title.startsWith('HTTPS')?'url':'key');
      assert(values.length,'Unexpected extra input dialog');
      const value=values.shift();
      if(value!==undefined) {if(value)component.handleInput(value);component.handleInput('\r');}
      else component.handleInput('\u001b');
      component.dispose();return result;
    },
    confirm:async()=>{stages.push('confirm');return enable;}};
  return {ui,stages,notices};
}

test('Discord setup selects format first and asks only URL, persists empty key without POST',t=>fixture(async(extension,root)=>{
  const calls=mockSetupNetwork(t);
  const {ui,stages,notices}=setupUI('discord',['https://notify.example.invalid/discord-fixture']);
  await extension.commands.get('webhook-setup').handler('',{mode:'tui',cwd:root,sessionManager,ui});
  assert.deepEqual(stages,['format','url','confirm']);assert.equal(calls(),1);
  const config=JSON.parse(await readFile(configPath(root),'utf8'));
  assert.equal(config.format,'discord');assert.equal(config.key,'');assert.equal(config.enabled,true);
  assert.deepEqual(config.notifyOn,['completed']);assert.match(notices.at(-1),/已設定並開啟/);
}));
for(const format of ['slack','generic'])test(`${format} setup keeps optional Bearer key after format and URL`,t=>fixture(async(extension,root)=>{
  mockSetupNetwork(t);const key=format==='slack'?'':'dummy-fixture-only';
  const {ui,stages}=setupUI(format,['https://notify.example.invalid/fixture',key]);
  await extension.commands.get('webhook-setup').handler('',{mode:'tui',cwd:root,sessionManager,ui});
  assert.deepEqual(stages,['format','url','key','confirm']);
  const config=JSON.parse(await readFile(configPath(root),'utf8'));assert.equal(config.format,format);assert.equal(config.key,key);
}));
test('cancel format performs no input, DNS or config write',t=>fixture(async(extension,root)=>{
  const calls=mockSetupNetwork(t);const {ui,stages,notices}=setupUI(undefined,[]);
  await extension.commands.get('webhook-setup').handler('',{mode:'tui',cwd:root,sessionManager,ui});
  assert.deepEqual(stages,['format']);assert.equal(calls(),0);assert.equal(notices.length,0);
  await assert.rejects(readFile(configPath(root)),{code:'ENOENT'});
}));
test('declining Discord enable preserves previous config including its key',t=>fixture(async(extension,root)=>{
  mockSetupNetwork(t);await mkdir(join(root,'config/webhook-notifier'),{recursive:true});
  const before=JSON.stringify({version:1,enabled:false,url:'https://notify.example.invalid/old',key:'dummy-existing-key',format:'generic',notifyOn:['completed','error']});
  await writeFile(configPath(root),before);
  const {ui,stages,notices}=setupUI('discord',['https://notify.example.invalid/new'],false);
  await extension.commands.get('webhook-setup').handler('',{mode:'tui',cwd:root,sessionManager,ui});
  assert.deepEqual(stages,['format','url','confirm']);assert.equal(notices.length,0);
  assert.equal(await readFile(configPath(root),'utf8'),before);
}));

test('hyphen test command dispatches an actual POST through mocked HTTPS, with distinct test identities',t=>fixture(async(extension,root)=>{
  mockSetupNetwork(t);
  const sent=[];
  t.mock.method(https,'request',(_url,options,callback)=>{
    assert.equal(options.method,'POST');
    const request=new EventEmitter();request.destroy=()=>{};
    request.end=body=>{sent.push({body:JSON.parse(body),id:options.headers['X-Pi-Notification-Id']});queueMicrotask(()=>callback({statusCode:204,destroy:()=>{}}));};
    return request;
  });
  const ctx={mode:'sdk',cwd:root,sessionManager,ui:{notify:()=>{}}};
  const store=new Store(join(root,'config/webhook-notifier'));
  await store.writeConfig({version:1,enabled:true,url:'https://notify.example.invalid/test',key:'',format:'discord',notifyOn:['error']});
  assert.equal((await store.readConfig()).enabled,true,'Fixture must pass the same private-store checks as setup');
  await extension.commands.get('webhook-test').handler('',ctx);
  await extension.commands.get('webhook-test').handler('',ctx);
  assert.equal(sent.length,2);assert.notEqual(sent[0].id,sent[1].id);
  for(const message of sent){assert.match(message.body.content,/Pi 測試通知/);assert.match(message.body.content,/@everyone/);assert.deepEqual(message.body.allowed_mentions,{parse:['everyone']});}
  await extension.commands.get('webhook-off').handler('',ctx);
  await extension.commands.get('webhook-test').handler('',ctx);
  assert.equal(sent.length,2,'Disabled configuration must never dispatch');
}));

test('中文狀態為預設，原始 JSON 識別碼可明確取得且不寫設定',()=>fixture(async extension=>{
  const notices=[],ctx={mode:'sdk',ui:{notify:text=>notices.push(text)}};
  await extension.commands.get('webhook-status').handler('',ctx);assert.match(notices.at(-1),/全域總開關：關閉/);
  await extension.commands.get('webhook-status').handler('json',ctx);assert.equal(JSON.parse(notices.at(-1)).loaded_version,'1.1.1');
  for(const c of extension.commands.values())assert.match(c.description,/[\u3400-\u9fff]/);
}));
