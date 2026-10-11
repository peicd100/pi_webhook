import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fromHost } from './runtime.mjs';
const {loadExtensionsCached,clearExtensionCache}=await fromHost('dist/core/extensions/loader.js');
const source=fileURLToPath(new URL('../',import.meta.url));

test('same-process reload selects versioned core despite a cached legacy core.mjs; no POST or session restart',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pi-webhook-reload-'));
  const oldDir=process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR=join(root,'private-store');
  try {
    await mkdir(join(root,'src'),{recursive:true});await mkdir(join(root,'extensions'));
    await writeFile(join(root,'package.json'),JSON.stringify({type:'module'}));
    const core=await readFile(join(source,'src/core_v1.1.1.mjs'),'utf8');
    const current="  if(format==='discord') return {content:(base.endsWith(' @everyone')?base:`${base} @everyone`)+suffix,allowed_mentions:{parse:['everyone']}};";
    assert.equal(core.split(current).length,2);
    const legacy=core.replace("export const VERSION = '1.1.1';","export const VERSION = 'fixture-old';")
      .replace(current,"  if(format==='discord') return {content:base+suffix,allowed_mentions:{parse:[]}};");
    await writeFile(join(root,'src/core.mjs'),legacy);
    await writeFile(join(root,'src/session-policy_v1.1.0.mjs'),await readFile(join(source,'src/session-policy_v1.1.0.mjs')));
    await writeFile(join(root,'src/presentation_v1.1.1.mjs'),await readFile(join(source,'src/presentation_v1.1.1.mjs')));
    await writeFile(join(root,'src/secret-ui.ts'),await readFile(join(source,'src/secret-ui.ts')));
    const index=await readFile(join(source,'extensions/index.ts'),'utf8');
    await writeFile(join(root,'extensions/index.ts'),index.replace('../src/core_v1.1.1.mjs','../src/core.mjs'));
    const load=async()=>{
      const r=await loadExtensionsCached([join(root,'extensions/index.ts')],root);
      assert.deepEqual(r.errors,[]);assert.equal(r.extensions.length,1);assert.equal(r.extensions[0].tools.size,0);
      return r.extensions[0];
    };
    const status=async extension=>{
      const notices=[];
      await extension.commands.get('webhook-status').handler('json',{mode:'sdk',ui:{notify:text=>notices.push(text)}});
      return JSON.parse(notices.at(-1));
    };
    assert.equal((await status(await load())).loaded_version,'fixture-old');
    const cached=await import(pathToFileURL(join(root,'src/core.mjs')).href);
    const e={id:'fixture',sessionId:'fixture',sessionName:'Main',cwd:'/workspace/YouTube',outcome:'completed'};
    const at=new Date('2026-10-09T03:04:05Z');
    assert.equal(cached.makePayload(e,'discord',at).content.includes(' @everyone'),false);
    for(const name of ['src/core_v1.1.1.mjs','src/core.mjs','extensions/index.ts'])
      await writeFile(join(root,name),await readFile(join(source,name)));
    clearExtensionCache();
    assert.equal((await status(await load())).loaded_version,'1.1.1');
    const updated=await import(pathToFileURL(join(root,'src/core_v1.1.1.mjs')).href);
    assert.equal(updated.VERSION,'1.1.1');
    const suffix=` · ${updated.formatSendTime(at)}`;
    assert.equal(updated.makePayload(e,'discord',at).content,`${cached.makePayload(e,'generic',at).text.slice(0,-suffix.length)} @everyone${suffix}`);
    assert.deepEqual(updated.makePayload(e,'discord',at).allowed_mentions,{parse:['everyone']});
    assert.equal((await import(pathToFileURL(join(root,'src/core.mjs')).href)).VERSION,'fixture-old');
  } finally {
    clearExtensionCache();
    if(oldDir===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=oldDir;
    await rm(root,{recursive:true,force:true});
  }
});
