// Non-context, secret-free state on the ACTIVE branch, never an LLM decision.
export const SESSION_POLICY_TYPE='webhook-notifier-session-policy';
export function validateSessionPolicy(input) {
  if(!input || Object.keys(input).sort().join()!=='defaultEnabled,mode,origin,version' || input.version!==1 ||
    !['on','off','default'].includes(input.mode) || typeof input.defaultEnabled!=='boolean' ||
    !['new-default','legacy-master','explicit'].includes(input.origin)) throw new Error('Invalid webhook session policy.');
  return {version:1,mode:input.mode,defaultEnabled:input.defaultEnabled,origin:input.origin};
}
export function readSessionPolicy(branch) {
  let policy=null;
  for(const e of branch)if(e.type==='custom'&&e.customType===SESSION_POLICY_TYPE)policy=validateSessionPolicy(e.data);
  return policy;
}
export function initialSessionPolicy(branch,defaultEnabled,legacyMasterEnabled) {
  if(typeof defaultEnabled!=='boolean'||typeof legacyMasterEnabled!=='boolean')throw new Error('Invalid webhook preference.');
  const saved=readSessionPolicy(branch);if(saved)return saved;
  const legacy=branch.some(e=>e.type==='message'&&['user','assistant'].includes(e.message?.role));
  return {version:1,mode:'default',defaultEnabled:legacy?legacyMasterEnabled:defaultEnabled,origin:legacy?'legacy-master':'new-default'};
}
export function sessionEnabled(policy) {
  policy=validateSessionPolicy(policy);
  return policy.mode==='on'||(policy.mode==='default'&&policy.defaultEnabled);
}
