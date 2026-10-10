import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { VERSION, Store, validateEndpoint, resolveDestination, deliver, notificationId, settledSnapshot } from '../src/core_v1.1.0.mjs';
import { SESSION_POLICY_TYPE, readSessionPolicy, initialSessionPolicy, sessionEnabled } from '../src/session-policy_v1.1.0.mjs';
import { maskedInput } from '../src/secret-ui.ts';

export default function webhookNotifier(pi: ExtensionAPI) {
  const store=new Store(join(getAgentDir(),'config','webhook-notifier'));
  let candidate:any, freshTerminal:any, runStarted=0, stopped=false;
  const jobs=new Set<AbortController>(),operations=new Set<Promise<any>>();
  const show=(ctx:ExtensionContext,text:string,kind:'info'|'warning'|'error'='info')=>ctx.ui.notify(text,kind);
  const abortOwned=()=>{for(const controller of jobs)controller.abort();};
  const sessionKey=(ctx:ExtensionContext)=>JSON.stringify([ctx.sessionManager.getSessionId(),ctx.sessionManager.getSessionFile()??ctx.cwd]);
  const sameSession=(ctx:ExtensionContext,key:string)=>!stopped&&sessionKey(ctx)===key;
  const isBusy=(ctx:any)=>ctx.isIdle?.()===false||ctx.hasPendingMessages?.()===true;
  const ensurePolicy=async(ctx:ExtensionContext)=>{
    const key=sessionKey(ctx),branch=ctx.sessionManager.getBranch(),saved=readSessionPolicy(branch);
    if(saved)return saved;
    const defaultEnabled=await store.readDefault(),config=await store.readConfig();
    if(!sameSession(ctx,key))throw new Error('Session changed.');
    // Re-read after awaits: never overwrite another command's already-persisted choice.
    const current=ctx.sessionManager.getBranch(),existing=readSessionPolicy(current);
    if(existing)return existing;
    const policy=initialSessionPolicy(current,defaultEnabled,config?.enabled??false);
    pi.appendEntry(SESSION_POLICY_TYPE,policy);
    if(!readSessionPolicy(ctx.sessionManager.getBranch()))throw new Error('Session policy persistence unavailable.');
    return policy;
  };
  const dispatch=async(ctx:ExtensionContext,event:any,config:any)=>{
    if(stopped)return;
    const controller=new AbortController();jobs.add(controller);
    const operation=deliver(store,config,event,{signal:controller.signal});operations.add(operation);
    try {
      const result=await operation;
      if(result.state==='ACCEPTED')show(ctx,'Webhook endpoint accepted the notification.');
      else if(!['SKIPPED','DUPLICATE_NO_RESEND'].includes(result.state))show(ctx,`Webhook ${result.state}; no automatic retry. See /webhook-status.`,'warning');
    } catch {show(ctx,'Webhook receipt/storage failure; do not resend blindly. See /webhook-status.','error');}
    finally {jobs.delete(controller);operations.delete(operation);}
  };
  const restore=async(_event:any,ctx:ExtensionContext)=>{
    abortOwned();candidate=undefined;freshTerminal=undefined;runStarted=0;stopped=false;
    if(ctx.mode==='tui')try {await ensurePolicy(ctx);}catch {show(ctx,'Webhook session policy unavailable; automatic notifications remain blocked.','warning');}
  };
  pi.on('session_start',restore);
  pi.on('session_tree',restore);
  pi.on('agent_start',()=>{runStarted=Date.now();candidate=undefined;freshTerminal=undefined;});
  pi.on('turn_end',event=>{freshTerminal=runStarted?{entryId:event.messageEntryId,outcome:event.outcome}:undefined;});
  pi.on('agent_before_settle',(event,ctx)=>{
    const snapshot=settledSnapshot(ctx.sessionManager.getBranch(),ctx.sessionManager.getSessionId(),event.outcome,ctx.sessionManager.getSessionFile()??ctx.cwd);
    candidate=snapshot&&freshTerminal?.entryId===snapshot.terminalEntryId&&freshTerminal.outcome===event.outcome&&!ctx.signal?.aborted
      ?{...snapshot,sessionName:ctx.sessionManager.getSessionName(),cwd:ctx.cwd,elapsedMs:runStarted?Date.now()-runStarted:0,sessionKey:sessionKey(ctx)}:undefined;
  });
  pi.on('agent_settled',async(_event,ctx)=>{
    const event=candidate;candidate=undefined;freshTerminal=undefined;
    if(!event||stopped||ctx.signal?.aborted||ctx.mode!=='tui')return;
    try {
      const config=await store.readConfig();
      // No lazy migration after a fresh turn: startup must have durably established intent.
      const policy=readSessionPolicy(ctx.sessionManager.getBranch());
      if(config?.enabled&&policy&&sessionEnabled(policy)&&sameSession(ctx,event.sessionKey)&&!ctx.signal?.aborted)await dispatch(ctx,event,config);
    }catch {show(ctx,'Webhook configuration/session policy invalid; notification not submitted.','error');}
  });
  pi.on('session_shutdown',async()=>{
    stopped=true;candidate=undefined;freshTerminal=undefined;abortOwned();await Promise.allSettled([...operations]);
  });
  const commands=['status','setup','test','on','off','events','clear','default','session'];
  const usage='Use '+commands.map(name=>`/webhook-${name}`).join(', ')+'. /webhook-default [on|off]; /webhook-session [on|off|default]. Secrets only in masked setup.';
  pi.registerCommand('webhook',{description:'List webhook commands',handler:async(_args,ctx)=>show(ctx,usage)});
  const handler=(command:string)=>async(args:string,ctx:ExtensionContext)=>{
    const text=args.trim().toLowerCase();
    if(text&&!['default','session'].includes(command)){show(ctx,usage,'warning');return;}
    try {
      if(command==='default'||command==='session') {
        const options=command==='default'?['on','off']:['on','off','default'];
        if(text&&!options.includes(text)){show(ctx,usage,'warning');return;}
        if(isBusy(ctx)){show(ctx,'Change notification preferences while idle with the queue clear.','warning');return;}
        const key=ctx.sessionManager?sessionKey(ctx):undefined,defaultEnabled=await store.readDefault();
        let choice=text;
        if(!choice){
          const saved=command==='session'&&ctx.sessionManager?readSessionPolicy(ctx.sessionManager.getBranch()):null;
          show(ctx,command==='session'?`This dialog: ${saved?`${saved.mode} (${sessionEnabled(saved)?'On':'Off'})`:'not initialized'}. New-dialog default: ${defaultEnabled?'On':'Off'}.`:`New-dialog default: ${defaultEnabled?'On':'Off'}. Existing choices are not changed.`);
          if(ctx.mode!=='tui')return;
          choice=await ctx.ui.select(command==='default'?'New-dialog webhook default':'This dialog webhook (default adopts the current global default)',options)??'';
          if(!choice)return;
        }
        if(!options.includes(choice)||isBusy(ctx)||(key!==undefined&&!sameSession(ctx,key)))throw new Error('Preference context changed.');
        if(command==='default'){
          await store.writeDefault(choice==='on');show(ctx,`New-dialog default saved: ${choice}. Existing dialogs unchanged; the global master switch is separate.`);return;
        }
        if(!ctx.sessionManager)throw new Error('No session.');
        const previous=await ensurePolicy(ctx),currentDefault=choice==='default'?await store.readDefault():previous.defaultEnabled;
        if(isBusy(ctx)||!sameSession(ctx,key!))throw new Error('Session changed.');
        if(choice==='off'||(choice==='default'&&!currentDefault))abortOwned();
        pi.appendEntry(SESSION_POLICY_TYPE,{version:1,mode:choice,defaultEnabled:currentDefault,origin:'explicit'});
        const saved=readSessionPolicy(ctx.sessionManager.getBranch());
        if(!saved||saved.mode!==choice||saved.defaultEnabled!==currentDefault)throw new Error('Preference persistence failed.');
        if(!sessionEnabled(saved))abortOwned();
        show(ctx,`This dialog saved: ${choice} (${sessionEnabled(saved)?'On':'Off'}). Global master Off still blocks all sends.`);return;
      }
      const config=command==='setup'||command==='clear'?null:await store.readConfig();
      if(command==='status'){
        const receipts=await store.recent(),defaultEnabled=await store.readDefault();
        const policy=ctx.sessionManager?readSessionPolicy(ctx.sessionManager.getBranch()):null;
        show(ctx,JSON.stringify({loaded_version:VERSION,configured:!!config,enabled:config?.enabled??false,master_enabled:config?.enabled??false,
          default_enabled:defaultEnabled,session_policy:policy,automatic_mode_supported:ctx.mode==='tui',effective_automatic_enabled:ctx.mode==='tui'&&!!config?.enabled&&!!policy&&sessionEnabled(policy),
          endpoint_host:config?new URL(config.url).hostname:'not set',key:config?.key?'configured (hidden)':'none',format:config?.format??'generic',notifyOn:config?.notifyOn??['completed'],
          receipts:receipts.map((row:any)=>({id:row.notification_id,state:row.state,http_status:row.http_status,status:row.status,test:row.test,started_at:row.started_at}))},null,2));return;
      }
      if(command==='setup'){
        if(ctx.mode!=='tui'){show(ctx,'Masked webhook setup requires interactive Pi TUI. No secrets accepted via command arguments.','error');return;}
        const format=await ctx.ui.select('Webhook payload',['discord','slack','generic']);if(!format)return;
        const endpoint=await maskedInput(ctx,'HTTPS webhook URL (masked; Enter to confirm)');if(endpoint===undefined)return;
        const url=validateEndpoint(endpoint.trim());await resolveDestination(url);
        const key=format==='discord'?'':await maskedInput(ctx,'Bearer key (masked; optional; leave empty if not required)');if(key===undefined)return;
        if(!await ctx.ui.confirm('Enable global webhook master?',`Allow metadata-only notifications to ${url.hostname}? Each dialog has its own preference; no conversation, answer or file contents.`))return;
        await store.writeConfig({version:1,enabled:true,url:url.href,key,format,notifyOn:['completed']});
        show(ctx,'Webhook configured and enabled (global master). New-dialog default is separate; use /webhook-session on for this dialog or /webhook-test for an explicit test.');return;
      }
      if(command==='clear'){
        if(ctx.mode!=='tui'){show(ctx,'Clearing credentials requires interactive confirmation.','warning');return;}
        if(await ctx.ui.confirm('Clear webhook configuration?','Remove local URL/key; retain default preference and dedup receipts.')){
          abortOwned();await store.clear();show(ctx,'Webhook credentials cleared; preferences and receipts retained.');
        }return;
      }
      if(!config){show(ctx,'No webhook configured. Run /webhook-setup.','warning');return;}
      if(command==='on'||command==='off'){
        await store.writeConfig({...config,enabled:command==='on'});if(command==='off')abortOwned();
        show(ctx,`Webhook global master ${command==='on'?'enabled':'disabled'}; dialog choices unchanged.`);return;
      }
      if(command==='events'){
        if(ctx.mode!=='tui'){show(ctx,'Event preferences require interactive mode.','warning');return;}
        const choice=await ctx.ui.select('Notify which runtime outcomes?',['completed only','completed + errors','completed + errors + cancellations']);if(!choice)return;
        const notifyOn=choice==='completed only'?['completed']:choice==='completed + errors'?['completed','error']:['completed','error','aborted'];
        await store.writeConfig({...config,notifyOn});show(ctx,'Webhook event preferences saved.');return;
      }
      if(command==='test'){
        if(!config.enabled){show(ctx,'Webhook is disabled; use /webhook-on before testing.','warning');return;}
        const sessionId=ctx.sessionManager.getSessionId();
        await dispatch(ctx,{id:notificationId(sessionId,`explicit-test:${randomUUID()}`,'completed'),sessionId,sessionName:ctx.sessionManager.getSessionName(),cwd:ctx.cwd,outcome:'completed',elapsedMs:0,test:true},{...config,notifyOn:['completed']});
      }
    }catch {show(ctx,'Webhook command failed safely. Check preferences/session/public HTTPS storage; no secret details logged.','error');}
  };
  for(const command of commands)pi.registerCommand(`webhook-${command}`,{description:`Webhook ${command}; never put secrets in arguments`,handler:handler(command)});
}
