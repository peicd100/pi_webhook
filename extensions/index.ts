import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { VERSION, Store, validateEndpoint, resolveDestination, deliver, notificationId, settledSnapshot } from '../src/core_v1.0.3.mjs';
import { maskedInput } from '../src/secret-ui.ts';

export default function webhookNotifier(pi: ExtensionAPI) {
  const store = new Store(join(getAgentDir(),'config','webhook-notifier'));
  let candidate: any;
  let freshTerminal: any;
  let runStarted = 0;
  const jobs = new Set<AbortController>();
  const operations = new Set<Promise<any>>();
  let stopped = false;
  const show = (ctx: ExtensionContext, text: string, kind: 'info'|'warning'|'error'='info') => ctx.ui.notify(text,kind);
  const dispatch = async (ctx: ExtensionContext, event: any, config: any) => {
    if(stopped)return;
    const controller=new AbortController(); jobs.add(controller);
    const operation=deliver(store,config,event,{signal:controller.signal}); operations.add(operation);
    try {
      const result=await operation;
      if(result.state==='ACCEPTED')show(ctx,'Webhook endpoint accepted the notification.');
      else if(!['SKIPPED','DUPLICATE_NO_RESEND'].includes(result.state))show(ctx,`Webhook ${result.state}; no automatic retry. See /webhook-status.`,'warning');
    } catch {
      show(ctx,'Webhook receipt/storage failure; do not resend blindly. See /webhook-status.','error');
    } finally {jobs.delete(controller);operations.delete(operation);}
  };
  pi.on('session_start',()=>{candidate=undefined;freshTerminal=undefined;runStarted=0;stopped=false;});
  pi.on('agent_start',()=>{runStarted=Date.now();candidate=undefined;freshTerminal=undefined;});
  pi.on('turn_end',(event)=>{
    freshTerminal=runStarted ? {entryId:event.messageEntryId,outcome:event.outcome} : undefined;
  });
  pi.on('agent_before_settle',(event,ctx)=>{
    // Capture only fresh persisted facts, never historical completion/backfill.
    const snapshot=settledSnapshot(ctx.sessionManager.getBranch(),ctx.sessionManager.getSessionId(),event.outcome,
      ctx.sessionManager.getSessionFile() ?? ctx.cwd);
    candidate=snapshot && freshTerminal?.entryId===snapshot.terminalEntryId &&
      freshTerminal.outcome===event.outcome && !ctx.signal?.aborted
      ? {...snapshot,sessionName:ctx.sessionManager.getSessionName(),cwd:ctx.cwd,
        elapsedMs:runStarted?Date.now()-runStarted:0} : undefined;
  });
  pi.on('agent_settled',async(_event,ctx)=>{
    const event=candidate;candidate=undefined;freshTerminal=undefined;
    // Personal TUI Main only: child/print/SDK/RPC sessions do not emit automatic alerts.
    if(!event||stopped||ctx.signal?.aborted||ctx.mode!=='tui')return;
    try {const config=await store.readConfig();if(config)await dispatch(ctx,event,config);}
    catch {show(ctx,'Webhook configuration invalid/unavailable; notification not submitted.','error');}
  });
  pi.on('session_shutdown',async()=>{
    stopped=true;candidate=undefined;freshTerminal=undefined;
    for(const controller of jobs)controller.abort();
    await Promise.allSettled([...operations]);
  });
  const commands=['status','setup','test','on','off','events','clear'];
  const usage='Use '+commands.map(name=>`/webhook-${name}`).join(', ')+'. Secrets must be entered only in the masked setup dialog.';
  pi.registerCommand('webhook',{
    description:'List webhook commands',
    handler:async(_args,ctx)=>{show(ctx,usage,'info');},
  });
  const handler=(command:string)=>async(args:string,ctx:ExtensionContext)=>{
      if(args.trim()) {show(ctx,usage,'warning');return;}
      try {
        const config=command==='setup'||command==='clear'?null:await store.readConfig();
        if(command==='status') {
          const receipts=await store.recent();
          show(ctx,JSON.stringify({loaded_version:VERSION,configured:!!config,enabled:config?.enabled??false,
            endpoint_host:config?new URL(config.url).hostname:'not set',key:config?.key?'configured (hidden)':'none',
            format:config?.format??'generic',notifyOn:config?.notifyOn??['completed'],
            receipts:receipts.map((row:any)=>({id:row.notification_id,state:row.state,http_status:row.http_status,
              status:row.status,test:row.test,started_at:row.started_at}))},null,2));return;
        }
        if(command==='setup') {
          if(ctx.mode!=='tui') {show(ctx,'Masked webhook setup requires interactive Pi TUI. No secrets accepted via command arguments.','error');return;}
          const format=await ctx.ui.select('Webhook payload',['discord','slack','generic']);
          if(!format)return;
          const endpoint=await maskedInput(ctx,'HTTPS webhook URL (masked; Enter to confirm)');
          if(endpoint===undefined)return;
          const url=validateEndpoint(endpoint.trim());
          // Endpoint pinning is revalidated at actual send, not trusted from setup.
          await resolveDestination(url);
          const key=format==='discord'?'':await maskedInput(ctx,'Bearer key (masked; optional; leave empty if not required)');
          if(key===undefined)return;
          if(!await ctx.ui.confirm('Enable webhook?',`Send metadata-only completed-turn notifications to ${url.hostname}? No conversation, answer or file contents.`))return;
          await store.writeConfig({version:1,enabled:true,url:url.href,key,format,notifyOn:['completed']});
          show(ctx,'Webhook configured and enabled. Use /webhook-test for one explicit test.');return;
        }
        if(command==='clear') {
          if(ctx.mode!=='tui') {show(ctx,'Clearing credentials requires interactive confirmation.','warning');return;}
          if(await ctx.ui.confirm('Clear webhook configuration?','Remove local URL/key; retain receipts to prevent duplicate delivery.')) {
            await store.clear();show(ctx,'Webhook credentials cleared; receipts retained.');
          }
          return;
        }
        if(!config) {show(ctx,'No webhook configured. Run /webhook-setup.','warning');return;}
        if(command==='on'||command==='off') {
          await store.writeConfig({...config,enabled:command==='on'});
          if(command==='off')for(const controller of jobs)controller.abort();
          show(ctx,`Webhook ${command==='on'?'enabled':'disabled'}.`);return;
        }
        if(command==='events') {
          if(ctx.mode!=='tui') {show(ctx,'Event preferences require interactive mode.','warning');return;}
          const choice=await ctx.ui.select('Notify which runtime outcomes?',['completed only','completed + errors','completed + errors + cancellations']);
          if(!choice)return;
          const notifyOn=choice==='completed only'?['completed']:choice==='completed + errors'?['completed','error']:['completed','error','aborted'];
          await store.writeConfig({...config,notifyOn});show(ctx,'Webhook event preferences saved.');return;
        }
        if(command==='test') {
          if(!config.enabled) {show(ctx,'Webhook is disabled; use /webhook-on before testing.','warning');return;}
          const sessionId=ctx.sessionManager.getSessionId();
          await dispatch(ctx,{id:notificationId(sessionId,`explicit-test:${randomUUID()}`,'completed'),sessionId,
            sessionName:ctx.sessionManager.getSessionName(),cwd:ctx.cwd,outcome:'completed',elapsedMs:0,test:true},
            {...config,notifyOn:['completed']});
        }
      } catch {show(ctx,'Webhook command failed safely. Check public HTTPS endpoint/storage; no secret details logged.','error');}
  };
  for(const command of commands)pi.registerCommand(`webhook-${command}`,{
    description:`Webhook ${command}; never put secrets in command arguments`,
    handler:handler(command),
  });
}
