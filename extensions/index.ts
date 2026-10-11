import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { VERSION, Store, validateEndpoint, resolveDestination, deliver, notificationId, settledSnapshot } from '../src/core_v1.1.1.mjs';
import { SESSION_POLICY_TYPE, readSessionPolicy, initialSessionPolicy, sessionEnabled } from '../src/session-policy_v1.1.0.mjs';
import { maskedInput } from '../src/secret-ui.ts';

import { formatStatus, stateLabel, onOff } from '../src/presentation_v1.1.1.mjs';

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
      if(result.state==='ACCEPTED')show(ctx,'Webhook 端點已接受通知。');
      else if(!['SKIPPED','DUPLICATE_NO_RESEND'].includes(result.state))show(ctx,`Webhook：${stateLabel(result.state)}；不會自動重試。請查看 /webhook-status。`,'warning');
    } catch {show(ctx,'Webhook 收據或保存失敗；請勿盲目重送，請查看 /webhook-status。','error');}
    finally {jobs.delete(controller);operations.delete(operation);}
  };
  const restore=async(_event:any,ctx:ExtensionContext)=>{
    abortOwned();candidate=undefined;freshTerminal=undefined;runStarted=0;stopped=false;
    if(ctx.mode==='tui')try {await ensurePolicy(ctx);}catch {show(ctx,'無法確認此對話的通知選擇；自動通知保持阻擋。','warning');}
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
    }catch {show(ctx,'Webhook 設定或對話選擇無效；未送出通知。','error');}
  });
  pi.on('session_shutdown',async()=>{
    stopped=true;candidate=undefined;freshTerminal=undefined;abortOwned();await Promise.allSettled([...operations]);
  });
  const commands=['status','setup','test','on','off','events','clear','default','session'];
  const usage='指令：'+commands.map(name=>`/webhook-${name}`).join('、')+'。新對話預設：/webhook-default [on|off]；此對話：/webhook-session [on|off|default]；技術欄位：/webhook-status json。秘密只能在遮蔽的設定視窗輸入。';
  pi.registerCommand('webhook',{description:'列出通知插件指令與中文說明',handler:async(_args,ctx)=>show(ctx,usage)});
  const handler=(command:string)=>async(args:string,ctx:ExtensionContext)=>{
    const text=args.trim().toLowerCase();
    if(text&&!['default','session'].includes(command)&&!(command==='status'&&text==='json')){show(ctx,usage,'warning');return;}
    try {
      if(command==='default'||command==='session') {
        const options=command==='default'?['on','off']:['on','off','default'];
        if(text&&!options.includes(text)){show(ctx,usage,'warning');return;}
        if(isBusy(ctx)){show(ctx,'請等工作完成且訊息佇列清空，再修改通知偏好。','warning');return;}
        const key=ctx.sessionManager?sessionKey(ctx):undefined,defaultEnabled=await store.readDefault();
        let choice=text;
        if(!choice){
          const saved=command==='session'&&ctx.sessionManager?readSessionPolicy(ctx.sessionManager.getBranch()):null;
          show(ctx,command==='session'?`此對話：${saved?onOff(sessionEnabled(saved)):'尚未初始化'}；新對話預設：${onOff(defaultEnabled)}。`:`新對話預設：${onOff(defaultEnabled)}；不修改已有對話的選擇。`);
          if(ctx.mode!=='tui')return;
          const labels={'on':'開啟（on）','off':'關閉（off）','default':'重新採用目前全域預設（default）'};
          const picked=await ctx.ui.select(command==='default'?'新對話通知預設':'此對話通知選擇',options.map(x=>labels[x]));
          choice=options.find(x=>labels[x]===picked)??'';
          if(!choice)return;
        }
        if(!options.includes(choice)||isBusy(ctx)||(key!==undefined&&!sameSession(ctx,key)))throw new Error('Preference context changed.');
        if(command==='default'){
          await store.writeDefault(choice==='on');show(ctx,`新對話預設已保存：${onOff(choice==='on')}。既有對話不變；全域總開關獨立控制。`);return;
        }
        if(!ctx.sessionManager)throw new Error('No session.');
        const previous=await ensurePolicy(ctx),currentDefault=choice==='default'?await store.readDefault():previous.defaultEnabled;
        if(isBusy(ctx)||!sameSession(ctx,key!))throw new Error('Session changed.');
        if(choice==='off'||(choice==='default'&&!currentDefault))abortOwned();
        pi.appendEntry(SESSION_POLICY_TYPE,{version:1,mode:choice,defaultEnabled:currentDefault,origin:'explicit'});
        const saved=readSessionPolicy(ctx.sessionManager.getBranch());
        if(!saved||saved.mode!==choice||saved.defaultEnabled!==currentDefault)throw new Error('Preference persistence failed.');
        if(!sessionEnabled(saved))abortOwned();
        show(ctx,`此對話選擇已保存：${onOff(sessionEnabled(saved))}${choice==='default'?'（採用當下全域預設）':''}。全域總開關關閉時仍禁止所有通知。`);return;
      }
      const config=command==='setup'||command==='clear'?null:await store.readConfig();
      if(command==='status'){
        const receipts=await store.recent(),defaultEnabled=await store.readDefault();
        const policy=ctx.sessionManager?readSessionPolicy(ctx.sessionManager.getBranch()):null;
        const status={loaded_version:VERSION,configured:!!config,enabled:config?.enabled??false,master_enabled:config?.enabled??false,
          default_enabled:defaultEnabled,session_policy:policy,automatic_mode_supported:ctx.mode==='tui',effective_automatic_enabled:ctx.mode==='tui'&&!!config?.enabled&&!!policy&&sessionEnabled(policy),
          endpoint_host:config?new URL(config.url).hostname:'not set',key:config?.key?'configured (hidden)':'none',format:config?.format??'generic',notifyOn:config?.notifyOn??['completed'],
          receipts:receipts.map((row:any)=>({id:row.notification_id,state:row.state,http_status:row.http_status,status:row.status,test:row.test,started_at:row.started_at}))};
        show(ctx,text==='json'?JSON.stringify(status,null,2):formatStatus(status));return;
      }
      if(command==='setup'){
        if(ctx.mode!=='tui'){show(ctx,'遮蔽設定需要 Pi 互動式 TUI；禁止在指令參數輸入秘密。','error');return;}
        const picked=await ctx.ui.select('通知資料格式',['Discord','Slack','一般 JSON']);
        const format={Discord:'discord',Slack:'slack','一般 JSON':'generic'}[picked??''];if(!format)return;
        const endpoint=await maskedInput(ctx,'HTTPS Webhook 網址（遮蔽；Enter 確認）');if(endpoint===undefined)return;
        const url=validateEndpoint(endpoint.trim());await resolveDestination(url);
        const key=format==='discord'?'':await maskedInput(ctx,'Bearer 金鑰（遮蔽；非必填，不需要時留空）');if(key===undefined)return;
        if(!await ctx.ui.confirm('開啟全域通知總開關？',`允許傳送必要通知資訊至 ${url.hostname}？每個對話另有開關；不傳送對話、回答或檔案內容。`))return;
        await store.writeConfig({version:1,enabled:true,url:url.href,key,format,notifyOn:['completed']});
        show(ctx,'Webhook 已設定並開啟全域總開關。新對話預設另行控制；此對話可用 /webhook-session on，明確測試用 /webhook-test。');return;
      }
      if(command==='clear'){
        if(ctx.mode!=='tui'){show(ctx,'清除端點與金鑰需要互動確認。','warning');return;}
        if(await ctx.ui.confirm('清除 Webhook 端點與金鑰？','刪除本機端點與金鑰；保留新對話預設及防重送收據。')){
          abortOwned();await store.clear();show(ctx,'端點與金鑰已清除；偏好與收據保留。');
        }return;
      }
      if(!config){show(ctx,'尚未設定通知端點；請執行 /webhook-setup。','warning');return;}
      if(command==='on'||command==='off'){
        await store.writeConfig({...config,enabled:command==='on'});if(command==='off')abortOwned();
        show(ctx,`全域通知總開關已${onOff(command==='on')}；對話選擇不變。`);return;
      }
      if(command==='events'){
        if(ctx.mode!=='tui'){show(ctx,'通知事件選擇需要互動模式。','warning');return;}
        const choice=await ctx.ui.select('哪些結果需要通知？',['只有完成','完成與錯誤','完成、錯誤與取消']);if(!choice)return;
        const notifyOn=choice==='只有完成'?['completed']:choice==='完成與錯誤'?['completed','error']:['completed','error','aborted'];
        await store.writeConfig({...config,notifyOn});show(ctx,'通知事件偏好已保存。');return;
      }
      if(command==='test'){
        if(!config.enabled){show(ctx,'全域總開關已關閉；明確測試前請先 /webhook-on。','warning');return;}
        const sessionId=ctx.sessionManager.getSessionId();
        await dispatch(ctx,{id:notificationId(sessionId,`explicit-test:${randomUUID()}`,'completed'),sessionId,sessionName:ctx.sessionManager.getSessionName(),cwd:ctx.cwd,outcome:'completed',elapsedMs:0,test:true},{...config,notifyOn:['completed']});
      }
    }catch {show(ctx,'通知指令未成功執行；請檢查偏好、對話狀態、公開 HTTPS 端點與保存權限。未記錄秘密內容。','error');}
  };
  for(const command of commands)pi.registerCommand(`webhook-${command}`,{description:({status:'查看通知狀態',setup:'遮蔽設定端點與金鑰',test:'明確傳送一則測試通知',on:'開啟全域總開關',off:'關閉全域總開關',events:'選擇通知事件',clear:'確認清除端點與金鑰',default:'設定新對話預設',session:'設定並保存此對話選擇'}[command])+'；禁止在參數輸入秘密',handler:handler(command)});
}
