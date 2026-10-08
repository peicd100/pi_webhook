import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
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
  assert.equal(extension.tools.size,0);assert.deepEqual([...extension.commands.keys()],['webhook']);
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
  await extension.commands.get('webhook').handler('status',ctx);
  assert.equal(JSON.parse(notices.at(-1)).configured,false);
  assert.equal(JSON.parse(notices.at(-1)).loaded_version,'1.0.2');
  await extension.commands.get('webhook').handler('key dummy-do-not-echo',ctx);
  assert.ok(!notices.at(-1).includes('dummy-do-not-echo'));
  await extension.commands.get('webhook').handler('setup',ctx);
  assert.match(notices.at(-1),/interactive Pi TUI/);
  await extension.handlers.get('session_shutdown')[0]({},ctx);
}));
test('masked URL dialog draws no secret, cancels without config write or network',()=>fixture(async extension=>{
  let captured;const notices=[];
  const ctx={mode:'tui',cwd:'/private/work',sessionManager,ui:{notify:text=>notices.push(text),
    custom:async factory=>{
      let result;const component=factory({requestRender:()=>{}},{},{},value=>{result=value;});
      component.focused=true;component.handleInput('https://private-secret.invalid/token=dummy');
      captured=component.render(90).join('\n');
      assert.ok(!captured.includes('private-secret'));assert.ok(!captured.includes('token=dummy'));assert.match(captured,/\*{5}/);
      component.handleInput('\u001b');component.dispose();return result;
    }}};
  await extension.commands.get('webhook').handler('setup',ctx);
  assert.ok(captured);assert.equal(notices.length,0);
}));
