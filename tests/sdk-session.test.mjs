import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import dns from 'node:dns/promises';
import https from 'node:https';
import {EventEmitter} from 'node:events';
import {syncBuiltinESMExports} from 'node:module';
import {createAssistantMessageEventStream,InMemoryCredentialStore} from '@earendil-works/pi-ai';
import {fromHost} from './runtime.mjs';
import {Store} from '../src/core.mjs';
import {readSessionPolicy,sessionEnabled,SESSION_POLICY_TYPE} from '../src/session-policy_v1.1.0.mjs';
const core=await fromHost('dist/index.js');
const {loadExtensions}=await fromHost('dist/core/extensions/loader.js');
const path=fileURLToPath(new URL('../extensions/index.ts',import.meta.url));
test('actual AgentSession TUI binding persists private policy, commands never call models, reload and automatic dedup work without real network',async t=>{
 const root=await mkdtemp(join(tmpdir(),'webhook actual SDK ')),old=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=root;let session;
 const sent=[],notices=[],errors=[];let requests=0;
 t.mock.method(dns,'lookup',async()=>[{address:'8.8.8.8',family:4}]);syncBuiltinESMExports();
 t.mock.method(https,'request',(_url,_options,callback)=>{const r=new EventEmitter();r.destroy=()=>{};r.end=b=>{sent.push(JSON.parse(b));queueMicrotask(()=>callback({statusCode:204,destroy:()=>{}}));};return r;});
 try {
  const store=new Store(join(root,'config/webhook-notifier'));await store.writeConfig({version:1,enabled:true,url:'https://notify.example.invalid/test',key:'dummy',format:'generic',notifyOn:['completed']});
  let extensions=await loadExtensions([path],root);assert.deepEqual(extensions.errors,[]);
  const registry=await core.ModelRuntime.create({credentials:new InMemoryCredentialStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false});registry.hasConfiguredAuth=()=>true;registry.checkAuth=async()=>true;registry.getAuth=async()=>({auth:{apiKey:'fixture-only-no-network'},source:'FIXTURE'});
  const model=registry.getModel('openai-codex','gpt-6.1-sol');registry.streamSimple=()=>{throw new Error('Forbidden nested model');};
  const manager=core.SessionManager.create(root,join(root,'sessions'));
  const loader={getExtensions:()=>extensions,getSkills:()=>({skills:[],diagnostics:[]}),getPrompts:()=>({prompts:[],diagnostics:[]}),getThemes:()=>({themes:[],diagnostics:[]}),getAgentsFiles:()=>({agentsFiles:[]}),getSystemPrompt:()=> 'Fixture only',getSystemPromptSource:()=>undefined,getAppendSystemPrompt:()=>[],getAppendSystemPromptSources:()=>[],extendResources:()=>{},reload:async()=>{extensions=await loadExtensions([path],root);}};
  ({session}=await core.createAgentSession({cwd:root,agentDir:root,modelRuntime:registry,model,thinkingLevel:'off',settingsManager:core.SettingsManager.create(root,root),sessionManager:manager,resourceLoader:loader,tools:[]}));
  session.agent.streamFunction=(m,context)=>{
   requests++;assert(!JSON.stringify(context).includes(SESSION_POLICY_TYPE));const stream=createAssistantMessageEventStream();queueMicrotask(()=>{const usage={input:8,output:2,cacheRead:0,cacheWrite:0,totalTokens:10,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},message={role:'assistant',api:m.api,provider:m.provider,model:m.id,timestamp:Date.now(),content:[{type:'text',text:'PRIVATE_ANSWER_FIXTURE'}],stopReason:'stop',usage};stream.push({type:'done',reason:'stop',message});stream.end();});return stream;
  };
  await session.bindExtensions({mode:'tui',onError:e=>errors.push(e),uiContext:{notify:text=>notices.push(text),select:async()=>undefined},commandContextActions:{waitForIdle:async()=>{},reload:async()=>session.reload()}});
  assert.equal(sessionEnabled(readSessionPolicy(manager.getBranch())),false);
  await session.prompt('/webhook-default on');assert.equal(requests,0);assert.equal(sessionEnabled(readSessionPolicy(manager.getBranch())),false);
  await session.prompt('PRIVATE_PROMPT_FIXTURE');assert.equal(requests,1);assert.equal(sent.length,0);
  await session.prompt('/webhook-session on');assert.equal(requests,1);await session.prompt('PRIVATE_PROMPT_FIXTURE');assert.equal(sent.length,1);
  assert(!JSON.stringify(sent).includes('PRIVATE_'));await session.reload();assert.equal(sessionEnabled(readSessionPolicy(manager.getBranch())),true);assert.equal(sent.length,1,'Reload never backfills/resends old terminal');
  await session.prompt('/webhook-default off');assert.equal(sessionEnabled(readSessionPolicy(manager.getBranch())),true);await session.prompt('/webhook-session default');assert.equal(sessionEnabled(readSessionPolicy(manager.getBranch())),false);
  assert.equal(requests,2);assert.deepEqual(errors,[]);assert.equal((await store.recent()).length,1);
 } finally {session?.dispose();t.mock.restoreAll();syncBuiltinESMExports();if(old===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=old;await rm(root,{recursive:true,force:true});}
});
