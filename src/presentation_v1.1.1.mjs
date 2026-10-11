const states={SENDING:'送出中',ACCEPTED:'端點已接受',HTTP_REJECTED:'端點拒絕',UNKNOWN:'結果未知，禁止盲目重送',FAILED_PRECHECK:'送出前驗證失敗',DUPLICATE_NO_RESEND:'已處理，不重送',SKIPPED:'已略過'};
export const stateLabel=value=>states[value]??'未知狀態';
export const onOff=value=>value?'開啟':'關閉';
export const outcomeLabel=value=>({completed:'完成',error:'錯誤',aborted:'取消'}[value]??'未知');
export function formatStatus(s) {
 const policy=s.session_policy;
 return [`Webhook 狀態（版本 ${s.loaded_version}）`,`端點：${s.configured?s.endpoint_host:'尚未設定'}；金鑰：${s.key==='configured (hidden)'?'已設定（隱藏）':'無'}`,
 `全域總開關：${onOff(s.master_enabled)}；新對話預設：${onOff(s.default_enabled)}`,
 `此對話：${policy?(policy.mode==='default'?'沿用已保存預設':'明確選擇')+'／'+onOff(policy.mode==='on'||policy.mode==='default'&&policy.defaultEnabled):'尚未初始化'}`,
 `目前可自動通知：${onOff(s.effective_automatic_enabled)}${s.automatic_mode_supported?'':'（此執行模式不自動通知）'}`,
 `格式：${s.format}；通知事件：${s.notifyOn.map(outcomeLabel).join('、')}`,
 ...s.receipts.slice(0,5).map(r=>`${r.test?'測試':'通知'}：${stateLabel(r.state)}；HTTP ${r.http_status??'未知'}；${r.started_at??'時間未知'}`),
 '新對話預設不修改既有選擇；總開關關閉時禁止所有送出。','原始技術欄位：/webhook-status json。'].join('\n');
}
