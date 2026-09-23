// PaiMini 报备规则：按店铺保存团抽/派抽/到手比例，并为本单提供来源与自动金额。
// 独立模块，不接管核心启动；仅对“复制报备”按钮做按钮级 capture，避免影响其他功能。

let started=false;
const $=id=>document.getElementById(id);
const state={shopId:null,rules:new Map(),order:{teamPct:0,dispatchPct:0,takehomePct:100,autoTakehome:true,source:''}};
const DB_TIMEOUT_MS=12000;

function ctx(){try{return window.paiMiniOrderBridge?.getContext?.()||null}catch{return null}}
function supabase(){return ctx()?.supabase||null}
function toast(message){window.paiMiniOrderBridge?.toast?.(message)}
function num(v){const n=Number(v);return Number.isFinite(n)?n:0}
function clampPct(v){return Math.max(0,Math.min(100,num(v)))}
function moneyNumberFromText(text){const m=String(text||'').replace(/,/g,'').match(/-?\d+(?:\.\d+)?/);return m?num(m[0]):0}
function plain(v){const n=num(v);return Number.isInteger(n)?String(n):n.toFixed(2).replace(/0+$/,'').replace(/\.$/,'')}
function pctText(v){return plain(clampPct(v))+'%'}
function currentShop(){return ctx()?.shop||null}
function currentUserId(){return ctx()?.state?.session?.user?.id||null}
function shopStorageKey(shopId){return `paimini-report-rule-${currentUserId()||'guest'}-${shopId||'none'}`}
function orderSourceKey(){return `paimini-report-source-${currentUserId()||'guest'}`}
function timeout(label){return new Promise((_,reject)=>setTimeout(()=>reject(new Error(label+' timeout')),DB_TIMEOUT_MS))}
async function query(promise,label){const r=await Promise.race([promise,timeout(label)]);if(r?.error)throw r.error;return r?.data}
function defaultRule(){return {team_pct:0,dispatch_pct:0,takehome_pct:100,auto_takehome:true,default_source:''}}
function normalizeRule(r){const x={...defaultRule(),...(r||{})};x.team_pct=clampPct(x.team_pct);x.dispatch_pct=clampPct(x.dispatch_pct);x.auto_takehome=x.auto_takehome!==false;x.takehome_pct=x.auto_takehome?Math.max(0,100-x.team_pct-x.dispatch_pct):clampPct(x.takehome_pct);return x}
function loadLocal(shopId){try{return normalizeRule(JSON.parse(localStorage.getItem(shopStorageKey(shopId))||'null'))}catch{return defaultRule()}}
function saveLocal(shopId,rule){try{localStorage.setItem(shopStorageKey(shopId),JSON.stringify(normalizeRule(rule)))}catch{}}

function ensureStyle(){
  if($('reportRulesSafeStyle'))return;
  const s=document.createElement('style');s.id='reportRulesSafeStyle';s.textContent=`
  .report-rule-card{margin-top:14px}.report-rule-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.report-rule-grid .wide{grid-column:1/-1}.report-rule-inline{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.report-rule-inline label{margin:0}.report-rule-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px}.report-rule-stat{border:1px solid var(--line);border-radius:13px;padding:10px;background:var(--paper)}.report-rule-stat span{display:block;color:var(--muted);font-size:10px}.report-rule-stat b{display:block;margin-top:4px;font-size:16px}.report-rule-note{color:var(--muted);font-size:11px;line-height:1.55;margin-top:8px}.variable-box span[data-report-insert]{cursor:pointer;user-select:none}.variable-box span[data-report-insert]:active{transform:scale(.97)}.report-quick-label{width:100%;margin-top:7px;color:var(--muted);font-size:10px}.report-parse-help{width:100%;margin-top:9px;padding:9px 10px;border:1px dashed var(--line);border-radius:12px;background:var(--bg,#fff);color:var(--muted);font-size:10px;line-height:1.65}.report-token-name{font-weight:800}.report-custom-pct{display:flex;gap:6px;align-items:center;width:100%;margin-top:7px}.report-custom-pct input{max-width:110px}
  @media(max-width:720px){.report-rule-grid{grid-template-columns:1fr 1fr}.report-rule-summary{grid-template-columns:1fr 1fr}}@media(max-width:520px){.report-rule-grid,.report-rule-summary{grid-template-columns:1fr}}
  `;document.head.appendChild(s);
}

function shopOptions(){const shops=ctx()?.state?.shops||[];return shops.map(s=>`<option value="${String(s.id)}">${String(s.name||'未命名店铺')}</option>`).join('')}

function mountShopSettings(){
  const page=$('page-shops');if(!page||$('reportRuleSettingsCard'))return;
  const card=document.createElement('div');card.id='reportRuleSettingsCard';card.className='card report-rule-card';
  card.innerHTML=`
    <div class="card-title"><div><b>报备规则 ♡</b><small>每个店铺可设置默认团抽、派抽与到手比例；派单时仍可临时修改</small></div></div>
    <div class="report-rule-grid">
      <label>店铺<select id="reportRuleShop">${shopOptions()}</select></label>
      <label>团抽 %<input id="reportRuleTeamPct" type="number" min="0" max="100" step="0.01" value="0"></label>
      <label>派抽 %<input id="reportRuleDispatchPct" type="number" min="0" max="100" step="0.01" value="0"></label>
      <label>到手 %<input id="reportRuleTakehomePct" type="number" min="0" max="100" step="0.01" value="100"></label>
      <label>默认来源<input id="reportRuleSource" maxlength="80" placeholder="例如 群派 / 店铺 / 老板直找"></label>
      <label class="report-rule-inline"><input id="reportRuleAuto" type="checkbox" checked> 到手自动计算</label>
    </div>
    <p class="report-rule-note">开启后：到手% = 100% - 团抽% - 派抽%。关闭后可手动填写到手比例。</p>
    <button id="saveReportRuleBtn" class="btn primary" type="button">保存报备规则</button>`;
  const head=page.querySelector('.page-head');head?.insertAdjacentElement('afterend',card);
}

function mountOrderCard(){
  const page=$('page-calculator');if(!page||$('orderReportRuleCard'))return;
  const card=document.createElement('div');card.id='orderReportRuleCard';card.className='card report-rule-card';
  card.innerHTML=`
    <div class="card-title"><div><b>⑤ 报备结算</b><small>自动带出当前店铺默认比例，本单可单独修改</small></div></div>
    <div class="report-rule-grid">
      <label>团抽 %<input id="orderTeamPct" type="number" min="0" max="100" step="0.01"></label>
      <label>派抽 %<input id="orderDispatchPct" type="number" min="0" max="100" step="0.01"></label>
      <label>到手 %<input id="orderTakehomePct" type="number" min="0" max="100" step="0.01"></label>
      <label>来源<input id="orderSource" maxlength="80" placeholder="例如 群派 / 店铺 / 老板直找"></label>
      <label class="report-rule-inline"><input id="orderAutoTakehome" type="checkbox" checked> 到手自动计算</label>
    </div>
    <div class="report-rule-summary">
      <div class="report-rule-stat"><span>团抽金额</span><b id="orderTeamAmount">¥0.00</b></div>
      <div class="report-rule-stat"><span>派抽金额</span><b id="orderDispatchAmount">¥0.00</b></div>
      <div class="report-rule-stat"><span>到手金额</span><b id="orderTakehomeAmount">¥0.00</b></div>
    </div>`;
  const actions=page.querySelector('.action-row');actions?.insertAdjacentElement('beforebegin',card);
}

function insertTemplateToken(token){
  const ta=$('reportTemplateText');if(!ta)return;
  const start=Number.isFinite(ta.selectionStart)?ta.selectionStart:ta.value.length;
  const end=Number.isFinite(ta.selectionEnd)?ta.selectionEnd:start;
  ta.value=ta.value.slice(0,start)+token+ta.value.slice(end);
  const next=start+token.length;ta.focus();ta.setSelectionRange(next,next);
  ta.dispatchEvent(new Event('input',{bubbles:true}));
}
function makeInsertChip(text,token=text,title='点击插入模板'){
  const span=document.createElement('span');span.textContent=text;span.dataset.reportInsert=token;span.title=title;span.tabIndex=0;
  const insert=()=>insertTemplateToken(token);
  span.addEventListener('click',insert);
  span.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();insert()}});
  return span;
}
function addVariableChips(){
  const box=document.querySelector('#page-shops .variable-box');if(!box||box.dataset.reportRulesAdded==='1')return;
  box.dataset.reportRulesAdded='1';

  box.querySelectorAll('span').forEach(span=>{
    const token=(span.textContent||'').trim();
    if(!token||span.dataset.reportInsert)return;
    span.dataset.reportInsert=token;span.title='点击插入模板';span.tabIndex=0;
    const insert=()=>insertTemplateToken(token);
    span.addEventListener('click',insert);
    span.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();insert()}});
  });

  [
    ['团抽金额','{团抽金额}','按当前团抽比例自动算金额'],
    ['团抽比例','{团抽比例}','例如 20%'],
    ['派抽金额','{派抽金额}','按当前派抽比例自动算金额'],
    ['派抽比例','{派抽比例}','例如 10%'],
    ['到手金额','{到手金额}','按当前到手比例自动算金额'],
    ['到手比例','{到手比例}','例如 70%'],
    ['来源','{来源}','插入本单来源']
  ].forEach(([label,token,title])=>box.appendChild(makeInsertChip(label,token,title+' · 插入 '+token)));

  const label=document.createElement('div');label.className='report-quick-label';
  label.textContent='快捷百分比计算 · 直接算“本单总价 × 百分比”';
  box.appendChild(label);
  [5,10,15,20,25,30].forEach(p=>box.appendChild(makeInsertChip('× '+p+'%','{'+p+'%}','插入 '+p+'% 自动计算金额')));

  const custom=document.createElement('div');custom.className='report-custom-pct';
  custom.innerHTML='<input id="reportCustomPct" type="number" min="0" max="100" step="0.01" placeholder="自定义 %"><button id="insertCustomPctBtn" class="tiny-btn" type="button">插入计算</button>';
  box.appendChild(custom);
  custom.querySelector('#insertCustomPctBtn')?.addEventListener('click',()=>{
    const value=clampPct(custom.querySelector('#reportCustomPct')?.value);
    if(value<=0)return toast('先填一个百分比');
    insertTemplateToken('{'+plain(value)+'%}');
  });

  const help=document.createElement('div');help.className='report-parse-help';
  help.innerHTML='<b>解析说明</b><br>团抽金额 = 本单总价 × 团抽比例；团抽比例只显示百分比。<br>例如模板写「团抽：{20%}」，本单总价 157.5 时复制出来就是「团抽：31.5」。<br>旧模板里的 {团抽} / {派抽} / {到手} 继续兼容，都会按金额解析。';
  box.appendChild(help);
}

async function loadRule(shopId){
  if(!shopId)return defaultRule();
  if(state.rules.has(shopId))return state.rules.get(shopId);
  let rule=loadLocal(shopId);
  const s=supabase(),uid=currentUserId();
  if(s&&uid){
    try{
      const data=await query(s.from('user_shop_report_rules').select('*').eq('user_id',uid).eq('shop_id',shopId).maybeSingle(),'report rule');
      if(data)rule=normalizeRule(data);
    }catch(e){console.warn('report rule db read fallback to local',e)}
  }
  state.rules.set(shopId,rule);saveLocal(shopId,rule);return rule;
}

async function saveRule(){
  const shopId=$('reportRuleShop')?.value||currentShop()?.id;if(!shopId)return toast('先选择店铺');
  const rule=normalizeRule({team_pct:$('reportRuleTeamPct')?.value,dispatch_pct:$('reportRuleDispatchPct')?.value,takehome_pct:$('reportRuleTakehomePct')?.value,auto_takehome:$('reportRuleAuto')?.checked,default_source:$('reportRuleSource')?.value.trim()||''});
  saveLocal(shopId,rule);state.rules.set(shopId,rule);
  const s=supabase(),uid=currentUserId();
  if(s&&uid){
    try{
      const row={user_id:uid,shop_id:shopId,team_pct:rule.team_pct,dispatch_pct:rule.dispatch_pct,takehome_pct:rule.takehome_pct,auto_takehome:rule.auto_takehome,default_source:rule.default_source,updated_at:new Date().toISOString()};
      const r=await Promise.race([s.from('user_shop_report_rules').upsert(row,{onConflict:'user_id,shop_id'}),timeout('save report rule')]);
      if(r?.error)throw r.error;
      toast('报备规则已保存 ♡');
    }catch(e){console.warn('report rule db save failed, local kept',e);toast('已保存到当前设备；同步表未就绪时不会影响使用')}
  }else toast('报备规则已保存 ♡');
  if(currentShop()?.id===shopId)applyRuleToOrder(rule,true);
}

function fillSettings(rule){
  if(!$('reportRuleTeamPct'))return;
  $('reportRuleTeamPct').value=plain(rule.team_pct);$('reportRuleDispatchPct').value=plain(rule.dispatch_pct);$('reportRuleTakehomePct').value=plain(rule.takehome_pct);$('reportRuleAuto').checked=rule.auto_takehome!==false;$('reportRuleTakehomePct').disabled=rule.auto_takehome!==false;$('reportRuleSource').value=rule.default_source||'';
}

function updateAutoSettings(){if(!$('reportRuleAuto')?.checked)return;const t=clampPct($('reportRuleTeamPct')?.value),p=clampPct($('reportRuleDispatchPct')?.value);$('reportRuleTakehomePct').value=plain(Math.max(0,100-t-p));$('reportRuleTakehomePct').disabled=true}
function updateAutoOrder(){
  if(!$('orderAutoTakehome'))return;
  const auto=$('orderAutoTakehome').checked,t=clampPct($('orderTeamPct').value),p=clampPct($('orderDispatchPct').value);
  $('orderTakehomePct').disabled=auto;if(auto)$('orderTakehomePct').value=plain(Math.max(0,100-t-p));
  state.order={teamPct:t,dispatchPct:p,takehomePct:clampPct($('orderTakehomePct').value),autoTakehome:auto,source:$('orderSource')?.value.trim()||''};
  try{localStorage.setItem(orderSourceKey(),state.order.source)}catch{}
  renderAmounts();
}
function currentTotal(){return num(ctx()?.state?.calc?.total)||moneyNumberFromText($('calcTotal')?.textContent)||moneyNumberFromText($('orderGrandTotal')?.textContent)}
function currency(){return currentShop()?.currency_symbol||'¥'}
function amounts(){const total=currentTotal(),team=total*state.order.teamPct/100,dispatch=total*state.order.dispatchPct/100,take=total*state.order.takehomePct/100;return {total,team,dispatch,take}}
function renderAmounts(){const a=amounts();if($('orderTeamAmount'))$('orderTeamAmount').textContent=currency()+a.team.toFixed(2);if($('orderDispatchAmount'))$('orderDispatchAmount').textContent=currency()+a.dispatch.toFixed(2);if($('orderTakehomeAmount'))$('orderTakehomeAmount').textContent=currency()+a.take.toFixed(2)}

function applyRuleToOrder(rule,forceSource=false){
  const r=normalizeRule(rule);state.order.teamPct=r.team_pct;state.order.dispatchPct=r.dispatch_pct;state.order.takehomePct=r.takehome_pct;state.order.autoTakehome=r.auto_takehome;
  if($('orderTeamPct')){$('orderTeamPct').value=plain(r.team_pct);$('orderDispatchPct').value=plain(r.dispatch_pct);$('orderTakehomePct').value=plain(r.takehome_pct);$('orderAutoTakehome').checked=r.auto_takehome!==false;$('orderTakehomePct').disabled=r.auto_takehome!==false}
  let last='';try{last=localStorage.getItem(orderSourceKey())||''}catch{}
  const source=(forceSource?r.default_source:'')||last||r.default_source||'';if($('orderSource'))$('orderSource').value=source;state.order.source=source;renderAmounts();
}

async function syncCurrentShop(){
  const shopId=currentShop()?.id;if(!shopId||shopId===state.shopId)return;
  state.shopId=shopId;const rule=await loadRule(shopId);applyRuleToOrder(rule);
  if($('reportRuleShop')){$('reportRuleShop').value=shopId;fillSettings(rule)}
}

function replaceAllVars(template,vars){
  let out=String(template||'');
  const total=num(ctx()?.state?.calc?.total)||currentTotal();

  // 快捷百分比：{20%}、{团抽20%}、{派抽10%}、{到手70%}
  // 都按“本单总价 × 百分比”解析成金额。
  out=out.replace(/\{\s*(?:团抽|派抽|到手)?\s*(\d+(?:\.\d+)?)%\s*\}/g,(_,pct)=>plain(total*clampPct(pct)/100));

  Object.entries(vars).forEach(([k,v])=>{out=out.split(k).join(String(v??''))});
  return out;
}
function reportVars(){
  const c=ctx(),calc=c?.state?.calc||{},item=c?.state?.selectedItem||{};const a=amounts();
  const total=num(calc.total)||a.total,history=num(c?.state?.historyTotal),newTotal=history+total;
  const date=new Date();const dateText=date.toLocaleDateString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'}),timeText=date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
  const itemName=$('calcItemName')?.value.trim()||item.name||'';const unit=$('calcUnitLabel')?.value.trim()||item.unit_label||'次';const unitPrice=num($('calcUnitPrice')?.value)||num(calc.unitPrice);const measure=$('durationInput')?.value.trim()||calc.measure||'';const quantity=calc.quantity??'';const original=num(calc.originalTotal)||total;const discount=num(calc.discountRate)||100;
  return {
    '{老板}':$('customerName')?.value.trim()||'', '{项目}':itemName, '{陪陪}':$('companionName')?.value.trim()||'', '{单价}':plain(unitPrice), '{单位}':unit, '{时长}':measure, '{数量}':plain(quantity), '{原价}':plain(original), '{折扣}':pctText(discount), '{总价}':plain(total), '{历史累计}':plain(history), '{累计消费}':plain(newTotal), '{备注}':$('calcNote')?.value.trim()||'', '{日期}':dateText, '{时间}':timeText,
    '{团抽}':plain(a.team), '{团抽比例}':pctText(state.order.teamPct), '{团抽金额}':plain(a.team), '{派抽}':plain(a.dispatch), '{派抽比例}':pctText(state.order.dispatchPct), '{派抽金额}':plain(a.dispatch), '{到手}':plain(a.take), '{到手比例}':pctText(state.order.takehomePct), '{到手金额}':plain(a.take), '{来源}':state.order.source||''
  };
}
async function copyText(text){try{await navigator.clipboard.writeText(text);toast('报备已复制 ♡')}catch{const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();toast('报备已复制 ♡')}}
function interceptCopyReport(e){
  e.stopImmediatePropagation();e.preventDefault();
  const template=ctx()?.state?.template?.template_text||$('reportTemplateText')?.value||'';
  const vars=reportVars();
  if(!template){toast('先设置报备模板');return}
  void copyText(replaceAllVars(template,vars));
}

function bind(){
  $('reportRuleShop')?.addEventListener('change',async()=>fillSettings(await loadRule($('reportRuleShop').value)));
  ['reportRuleTeamPct','reportRuleDispatchPct'].forEach(id=>$(id)?.addEventListener('input',updateAutoSettings));
  $('reportRuleAuto')?.addEventListener('change',()=>{if($('reportRuleTakehomePct'))$('reportRuleTakehomePct').disabled=$('reportRuleAuto').checked;updateAutoSettings()});
  $('saveReportRuleBtn')?.addEventListener('click',()=>void saveRule());
  ['orderTeamPct','orderDispatchPct','orderTakehomePct','orderSource'].forEach(id=>$(id)?.addEventListener('input',updateAutoOrder));
  $('orderAutoTakehome')?.addEventListener('change',updateAutoOrder);
  $('copyReportBtn')?.addEventListener('click',interceptCopyReport,true);
  const total=$('calcTotal');if(total&&typeof MutationObserver!=='undefined'){new MutationObserver(renderAmounts).observe(total,{childList:true,characterData:true,subtree:true})}
  $('calcShop')?.addEventListener('change',()=>setTimeout(()=>void syncCurrentShop(),0));
}

export async function initReportRulesSafe(){
  if(started)return;started=true;ensureStyle();mountShopSettings();mountOrderCard();addVariableChips();bind();
  const current=currentShop()?.id;if($('reportRuleShop')&&current)$('reportRuleShop').value=current;
  await syncCurrentShop();if(current&&$('reportRuleShop'))fillSettings(await loadRule(current));renderAmounts();
}
