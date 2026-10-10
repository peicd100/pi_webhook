import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../src/core.mjs';
import {SESSION_POLICY_TYPE as TYPE,readSessionPolicy,initialSessionPolicy,sessionEnabled,validateSessionPolicy} from '../src/session-policy_v1.1.0.mjs';
import {fromHost} from './runtime.mjs';
const {SessionManager}=await fromHost('dist/core/session-manager.js');
const entry=data=>({type:'custom',customType:TYPE,data});
const on={version:1,mode:'on',defaultEnabled:false,origin:'explicit'};
const off={...on,mode:'off'};
const assistant=()=>({role:'assistant',api:'fixture',provider:'fixture',model:'fixture',stopReason:'stop',timestamp:Date.now(),content:[{type:'text',text:'mock'}],usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}});
async function fixture(run){const root=await mkdtemp(join(tmpdir(),'webhook branch policy '));try{await run(root);}finally{await rm(root,{recursive:true,force:true});}}

test('absent global preferences defaultOff; boolean schema is strict; config/URL/key unaffected by preference writes/clear',()=>fixture(async root=>{
 const store=new Store(join(root,'store'));assert.equal(await store.readDefault(),false);
 await store.writeDefault(true);assert.equal(await new Store(store.root).readDefault(),true);assert.equal(await store.readConfig(),null);
 await store.writeConfig({version:1,enabled:true,url:'https://notify.example.invalid/fixture',key:'dummy',format:'generic',notifyOn:['completed']});const before=await readFile(store.configPath,'utf8');
 await store.writeDefault(false);assert.equal(await readFile(store.configPath,'utf8'),before);await store.clear();assert.equal(await store.readDefault(),false);
 await assert.rejects(store.writeDefault('false'));await writeFile(store.preferencesPath,JSON.stringify({version:1,defaultEnabled:'false'}),{mode:0o600});await assert.rejects(store.readDefault());
 if(process.platform!=='win32')assert.equal((await stat(store.preferencesPath)).mode&0o777,0o600);
}));
test('new dialogs freeze defaults while legacy dialogs migrate master intent without secret/assistant text inspection',()=>{
 assert.equal(sessionEnabled(initialSessionPolicy([],false,true)),false);
 assert.equal(sessionEnabled(initialSessionPolicy([],true,false)),true);
 const branch=[{type:'message',message:{role:'user',content:'never inspect this text'}}];assert.equal(sessionEnabled(initialSessionPolicy(branch,false,true)),true);
 assert.equal(initialSessionPolicy(branch,true,false).origin,'legacy-master');assert.equal(sessionEnabled(initialSessionPolicy(branch,true,false)),false);
 assert.deepEqual(initialSessionPolicy([entry(off)],true,true),off);
});
test('active branch wins; snapshots/explicit states remain independent of later global defaults',()=>{
 const snapshot={version:1,mode:'default',defaultEnabled:false,origin:'new-default'};
 assert.equal(sessionEnabled(initialSessionPolicy([entry(snapshot)],true,true)),false);
 assert.equal(sessionEnabled(readSessionPolicy([entry(on),entry(off)])),false);
 assert.equal(sessionEnabled(readSessionPolicy([entry(off),entry(on)])),true);
 for(const bad of [null,{...on,version:2},{...on,mode:'guess'},{...on,defaultEnabled:'on'},{...on,url:'https://secret.invalid'}])assert.throws(()=>validateSessionPolicy(bad));
 assert.throws(()=>readSessionPolicy([entry(on),entry({...off,mode:'unknown'})]));
});
test('real SessionManager resume/fork/tree and compaction retain raw custom policy, never model context',()=>fixture(async root=>{
 let manager=SessionManager.create(root,join(root,'sessions'));
 const original=manager.appendCustomEntry(TYPE,on);
 manager.appendMessage({role:'user',content:'fixture task',timestamp:Date.now()});manager.appendMessage(assistant());
 const offId=manager.appendCustomEntry(TYPE,off);manager.appendMessage(assistant());const file=manager.getSessionFile();
 manager=SessionManager.open(file);assert.equal(sessionEnabled(readSessionPolicy(manager.getBranch())),false);
 const fork=SessionManager.forkFrom(file,join(root,'fork-work'),join(root,'fork-sessions'));assert.equal(sessionEnabled(readSessionPolicy(fork.getBranch())),false);
 manager.branch(original);assert.equal(sessionEnabled(readSessionPolicy(manager.getBranch())),true,'Abandoned off branch must not contaminate selected on history');
 manager.branch(offId);const recent=manager.appendMessage({role:'user',content:'recent task',timestamp:Date.now()});
 manager.appendCompaction('No AI summary; test boundary',recent,10000,{acmPassive:{version:1,noModelCalls:true}},true);
 assert.equal(sessionEnabled(readSessionPolicy(manager.getBranch())),false);
 assert(!JSON.stringify(manager.buildSessionContext().messages).includes(TYPE),'Custom entries must never enter model context');
 assert.equal(manager.getEntries().filter(e=>e.customType===TYPE).length,2,'No policy rewrite or source deletion');
}));
