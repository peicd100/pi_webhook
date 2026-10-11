import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import dns from 'node:dns/promises';
import https from 'node:https';
import {syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
import {Store} from '../src/core.mjs';
import {SESSION_POLICY_TYPE as TYPE,readSessionPolicy,sessionEnabled} from '../src/session-policy_v1.1.0.mjs';
import {fromHost} from './runtime.mjs';
const {loadExtensions}=await fromHost('dist/core/extensions/loader.js');
const {SessionManager}=await fromHost('dist/core/session-manager.js');
const path=fileURLToPath(new URL('../extensions/index.ts',import.meta.url));
const config={version:1,enabled:true,url:'https://notify.example.invalid/fixture',key:'dummy-only',format:'generic',notifyOn:['completed']};
const assistant=()=>({role:'assistant',api:'fixture',provider:'fixture',model:'fixture',timestamp:Date.now(),content:[{type:'text',text:'DO NOT TRANSMIT ANSWER'}],stopReason:'stop',usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}});
async function fixture(run){
 const root=await mkdtemp(join(tmpdir(),'webhook dialogs ')),old=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=root;
 let manager=SessionManager.create(root,join(root,'sessions')),extension,notices=[];
 const ctx={mode:'tui',cwd:root,get sessionManager(){return manager;},isIdle:()=>true,hasPendingMessages:()=>false,ui:{notify:text=>notices.push(text),select:async()=>undefined}};
 const load=async()=>{const loaded=await loadExtensions([path],root);assert.deepEqual(loaded.errors,[]);loaded.runtime.appendEntry=(type,data)=>manager.appendCustomEntry(type,data);extension=loaded.extensions[0];return extension;};
 const api={root,ctx,store:new Store(join(root,'config/webhook-notifier')),notices,get manager(){return manager;},set manager(m){manager=m;},load,
  get extension(){return extension;},event:async(name,e={})=>{for(const h of extension.handlers.get(name)??[])await h(e,ctx);},command:(name,args='')=>extension.commands.get('webhook-'+name).handler(args,ctx),
  finish:async()=>{await api.event('agent_start');manager.appendMessage({role:'user',content:'DO NOT TRANSMIT PROMPT',timestamp:Date.now()});const id=manager.appendMessage(assistant());await api.event('turn_end',{outcome:'completed',messageEntryId:id});await api.event('agent_before_settle',{outcome:'completed'});await api.event('agent_settled');},
  newSession:()=>{manager=SessionManager.create(root,join(root,'sessions'));}};
 try{await load();await run(api);}finally{await api.event('session_shutdown');if(old===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=old;await rm(root,{recursive:true,force:true});}
}
function network(t){const sent=[];t.mock.method(dns,'lookup',async()=>[{address:'8.8.8.8',family:4}]);syncBuiltinESMExports();t.mock.method(https,'request',(_url,options,callback)=>{const request=new EventEmitter();request.destroy=()=>{};request.end=body=>{sent.push({payload:JSON.parse(body),headers:options.headers});queueMicrotask(()=>callback({statusCode:204,destroy:()=>{}}));};return request;});t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});return sent;}

test('default selector works before URL setup; cancellation/invalid input/busy are no-write and never POST',t=>fixture(async f=>{
 const sent=network(t);assert.equal(await f.store.readDefault(),false);await f.event('session_start');
 f.ctx.ui.select=async(_title,choices)=>{assert.deepEqual(choices,['開啟（on）','關閉（off）']);return '開啟（on）';};await f.command('default');assert.equal(await f.store.readDefault(),true);assert.equal(await f.store.readConfig(),null);
 const before=await readFile(f.store.preferencesPath,'utf8');f.ctx.ui.select=async()=>undefined;await f.command('default');assert.equal(await readFile(f.store.preferencesPath,'utf8'),before);
 await f.command('default','not-secret-must-not-echo');assert(!f.notices.at(-1).includes('not-secret'));assert.equal(await readFile(f.store.preferencesPath,'utf8'),before);
 f.ctx.isIdle=()=>false;await f.command('default','off');await f.command('session','on');assert.equal(await readFile(f.store.preferencesPath,'utf8'),before);assert.equal(sessionEnabled(readSessionPolicy(f.manager.getBranch())),false);assert.equal(sent.length,0);
}));
test('new defaultOff skips automatic sends; changing global default only affects new dialogs; master and explicit tests remain independent',t=>fixture(async f=>{
 const sent=network(t);await f.store.writeConfig(config);await f.event('session_start');await f.finish();assert.equal(sent.length,0);
 await f.command('default','on');assert.equal(sessionEnabled(readSessionPolicy(f.manager.getBranch())),false);await f.finish();assert.equal(sent.length,0);
 f.newSession();await f.event('session_start');assert.equal(sessionEnabled(readSessionPolicy(f.manager.getBranch())),true);await f.finish();assert.equal(sent.length,1);
 await f.command('session','off');await f.finish();assert.equal(sent.length,1);
 await f.command('test');assert.equal(sent.length,2,'Explicit manual test bypasses sessionOff but not global master');
 await f.command('off');await f.command('session','on');await f.finish();await f.command('test');assert.equal(sent.length,2);
 await f.command('on');await f.finish();assert.equal(sent.length,3);
 for(const e of sent)assert(!JSON.stringify(e.payload).includes('DO NOT TRANSMIT'));
}));
test('session default explicitly adopts current global snapshot; resume/reload, independent sibling and tree restore remain stable',t=>fixture(async f=>{
 const sent=network(t);await f.store.writeConfig(config);await f.event('session_start');await f.command('session','on');await f.finish();const savedFile=f.manager.getSessionFile(),onLeaf=f.manager.getLeafId();
 await f.command('default','off');await f.command('session','off');await f.finish();assert.equal(sent.length,1);
 await f.load();f.manager=SessionManager.open(savedFile);await f.event('session_start');assert.equal(sessionEnabled(readSessionPolicy(f.manager.getBranch())),false);
 f.manager.branch(onLeaf);await f.event('session_tree');assert.equal(sessionEnabled(readSessionPolicy(f.manager.getBranch())),true);await f.finish();assert.equal(sent.length,2);
 await f.command('session','default');assert.equal(sessionEnabled(readSessionPolicy(f.manager.getBranch())),false);
 await f.command('default','on');assert.equal(sessionEnabled(readSessionPolicy(f.manager.getBranch())),false);await f.command('session','default');assert.equal(sessionEnabled(readSessionPolicy(f.manager.getBranch())),true);
 f.newSession();await f.event('session_start');await f.command('session','off');f.manager=SessionManager.open(savedFile);await f.event('session_start');assert.equal(sessionEnabled(readSessionPolicy(f.manager.getBranch())),true);
}));
test('legacy existing conversation preserves previous master intent; fresh SDK/print/RPC never auto-initialize or notify',t=>fixture(async f=>{
 const sent=network(t);await f.store.writeConfig(config);f.manager.appendMessage({role:'user',content:'legacy',timestamp:Date.now()});f.manager.appendMessage(assistant());await f.event('session_start');assert.equal(readSessionPolicy(f.manager.getBranch()).origin,'legacy-master');await f.finish();assert.equal(sent.length,1);
 for(const mode of['sdk','print','rpc']){f.newSession();f.ctx.mode=mode;await f.event('session_start');assert.equal(readSessionPolicy(f.manager.getBranch()),null);await f.command('session','on');await f.finish();assert.equal(sent.length,1);}
}));
test('invalid raw session policy blocks automatic sends instead of resurrecting older on state',t=>fixture(async f=>{
 const sent=network(t);await f.store.writeConfig(config);await f.event('session_start');await f.command('session','on');f.manager.appendCustomEntry(TYPE,{version:1,mode:'bad',defaultEnabled:true,origin:'explicit'});await f.finish();assert.equal(sent.length,0);await f.command('off');assert.equal((await f.store.readConfig()).enabled,false);
}));
test('sessionOff cancels owned pending DNS before POST, retains claim, never retries',t=>fixture(async f=>{
 const sent=network(t);await f.store.writeConfig(config);await f.event('session_start');await f.command('session','on');
 let release,entered;const started=new Promise(r=>entered=r);t.mock.method(dns,'lookup',async()=>{entered();return new Promise(r=>release=()=>r([{address:'8.8.8.8',family:4}]));});syncBuiltinESMExports();
 const running=f.finish();await started;await f.command('session','off');release();await running;assert.equal(sent.length,0);assert.equal((await f.store.recent())[0].state,'FAILED_PRECHECK');await f.event('agent_settled');assert.equal(sent.length,0);
}));
test('session switch during an awaited config read cannot dispatch the old terminal under a new session policy',t=>fixture(async f=>{
 const sent=network(t);await f.store.writeConfig(config);await f.event('session_start');await f.command('session','on');
 const original=Store.prototype.readConfig;let release,entered,once=true;const started=new Promise(r=>entered=r);
 t.mock.method(Store.prototype,'readConfig',async function(){if(once){once=false;entered();await new Promise(r=>release=r);}return original.call(this);});
 const running=f.finish();await started;f.newSession();await f.event('session_start');await f.command('session','on');release();await running;assert.equal(sent.length,0);
}));
