// PaiMini 独立“预存”管理模块。
// 复用核心 Supabase，不创建第二客户端；不参与核心启动；所有请求独立超时。

let started=false;
let busy=false;
const RPC_TIMEOUT_MS=16000;
const $=id=>document.getElementById(id);
const state={customers:[],shops:[],customerId:null,prepaid:[],benefits:[],benefitLedger:[]};

function ctx(){try{return window.paiMiniOrderBridge?.getContext?.()||null}catch{return null}}
function supabase(){return ctx()?.supabase||null}
function isReadonly(){return document.body.classList.contains('paimini-readonly')}
function safe(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
function num(v){const n=Number(v||0);return Number.isFinite(n)?n:0}
function qty(v){const n=num(v);return Number.isInteger(n)?String(n):n.toFixed(2).replace(/0+$/,'').replace(/\.$/,'')}
function dateText(v){if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}
function currentCustomer(){return state.customers.find(c=>c.id===state.customerId)||null}
function currentShop(){const c=currentCustomer();return state.shops.find(s=>s.id===c?.shop_id)||null}
function money(v){return (currentShop()?.currency_symbol||'¥')+num(v).toFixed(2)}
function toast(message){window.paiMiniOrderBridge?.toast?.(message)}
function timeout(ms,label){return new Promise((_,reject)=>setTimeout(()=>{const e=new Error(label||'timeout');e.name='PrepaidTimeoutError';reject(e)},ms))}
async function callRpc(name,args={}){const s=supabase();if(!s?.rpc)throw new Error('CORE_SUPABASE_NOT_READY');const r=await Promise.race([s.rpc(name,args),timeout(RPC_TIMEOUT_MS,name+' timeout')]);if(r?.error)throw r.error;return r?.data}
async function query(promise,label){const r=await Promise.race([promise,timeout(RPC_TIMEOUT_MS,label+' timeout')]);if(r?.error)throw r.error;return r?.data||[]}

function ensureStyle(){
  if($('prepaidManagerSafeStyle'))return;
  const s=document.createElement('style');s.id='prepaidManagerSafeStyle';s.textContent=`
  .prepaid-safe-card{margin-top:14px}.prepaid-safe-toolbar{display:flex;gap:8px;align-items:end;flex-wrap:wrap}.prepaid-safe-toolbar label{flex:1 1 240px}
  .prepaid-safe-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin:13px 0}.prepaid-safe-stat{border:1px solid var(--line);border-radius:14px;padding:11px;background:var(--paper)}.prepaid-safe-stat span{display:block;color:var(--muted);font-size:11px}.prepaid-safe-stat b{display:block;margin-top:4px;font-size:18px}
  .prepaid-safe-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.prepaid-safe-box{border:1px solid var(--line);border-radius:16px;padding:14px}.prepaid-safe-box h3{margin:0 0 4px}.prepaid-safe-box p{margin:0 0 10px;color:var(--muted);font-size:11px;line-height:1.55}
  .prepaid-safe-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.prepaid-safe-form .wide{grid-column:1/-1}.prepaid-safe-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:9px}
  .prepaid-safe-list{display:grid;gap:8px;margin-top:10px;max-height:420px;overflow:auto}.prepaid-safe-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;border:1px solid var(--line);border-radius:13px;padding:10px 11px}.prepaid-safe-row p{margin:3px 0 0;color:var(--muted);font-size:10px;line-height:1.45}.prepaid-safe-empty{padding:14px;color:var(--muted);font-size:11px;text-align:center}.prepaid-safe-good{color:#4f936d}.prepaid-safe-bad{color:#c65f76}
  @media(max-width:850px){.prepaid-safe-summary{grid-template-columns:1fr 1fr}.prepaid-safe-grid{grid-template-columns:1fr}}@media(max-width:560px){.prepaid-safe-form{grid-template-columns:1fr}.prepaid-safe-form .wide{grid-column:auto}.prepaid-safe-row{grid-template-columns:1fr}}
  `;document.head.appendChild(s);
}

function mount(){
  const mount=$('prepaidPageMount');if(!mount)return false;
  $('bossWalletCard')?.remove();
  let card=$('prepaidManagerSafeCard');
  if(!card){card=document.createElement('div');card.id='prepaidManagerSafeCard';card.className='card prepaid-safe-card';mount.prepend(card)}
  // 旧版布局整理器曾给此卡片写入内联 display；每次挂载都强制恢复可见。
  card.style.removeProperty('display');
  card.hidden=false;
  card.innerHTML=`
    <div class="card-title"><div><b>老板预存余额 ♡【赠送余额版】</b><small>实充余额 + 赠送余额 + 权益，分开记账</small></div></div>
    <div class="prepaid-safe-toolbar">
      <label>选择老板<select id="prepaidSafeCustomer"></select></label>
      <button id="prepaidSafeRefresh" class="btn ghost" type="button">刷新</button>
      <button id="prepaidSafeExport" class="btn soft" type="button">导出 CSV</button>
    </div>
    <div id="prepaidSafeSummary" class="prepaid-safe-summary"></div>
    <div class="prepaid-safe-grid">
      <div class="prepaid-safe-box">
        <h3>预存余额</h3><p>实充与赠送余额分开记录；派单抵扣时默认先用赠送余额。</p>
        <div class="prepaid-safe-form">
          <label>调整金额<input id="prepaidSafeAmount" type="number" min="0" step="0.01" placeholder="例如 100"></label>
          <label>余额类型<select id="prepaidSafeBalanceType"><option value="paid">实充余额</option><option value="gift">赠送余额</option></select></label>
          <label>操作<select id="prepaidSafeDirection"><option value="add">增加余额</option><option value="subtract">扣减余额</option></select></label>
          <label class="wide">备注（选填）<input id="prepaidSafeNote" maxlength="160" placeholder="例如 充值 / 补录 / 更正"></label>
        </div>
        <div class="prepaid-safe-actions"><button id="prepaidSafeAdjust" class="btn primary" type="button">确认调整</button></div>
        <div id="prepaidSafeLedger" class="prepaid-safe-list"></div>
      </div>
      <div class="prepaid-safe-box">
        <h3>权益</h3><p>可以补发或扣减权益，也会保留完整变动记录。</p>
        <div id="prepaidSafeBenefits" class="prepaid-safe-list"></div>
        <div class="prepaid-safe-form" style="margin-top:12px">
          <label>权益名称<input id="prepaidSafeBenefitName" placeholder="例如 赠送时长 / 券"></label>
          <label>数量<input id="prepaidSafeBenefitAmount" type="number" min="0" step="0.01" value="1"></label>
          <label>单位<input id="prepaidSafeBenefitUnit" value="个" placeholder="个 / 次 / 张 / 分钟"></label>
          <label>操作<select id="prepaidSafeBenefitDirection"><option value="add">增加权益</option><option value="subtract">扣减权益</option></select></label>
          <label>有效期<input id="prepaidSafeBenefitExpiry" type="date"></label>
          <label>备注（选填）<input id="prepaidSafeBenefitNote" maxlength="160"></label>
        </div>
        <div class="prepaid-safe-actions"><button id="prepaidSafeBenefitAdjust" class="btn primary" type="button">确认权益调整</button></div>
        <div id="prepaidSafeBenefitLedger" class="prepaid-safe-list"></div>
      </div>
    </div>`;
  bind();return true;
}

function renderSelector(){
  const sel=$('prepaidSafeCustomer');if(!sel)return;
  const keep=state.customerId||sel.value;
  sel.innerHTML=state.customers.length?state.customers.map(c=>`<option value="${safe(c.id)}">${safe(c.name)} · ${safe(state.shops.find(s=>s.id===c.shop_id)?.name||'店铺')}</option>`).join(''):'<option value="">还没有老板档案</option>';
  if(keep&&state.customers.some(c=>c.id===keep))sel.value=keep;
  state.customerId=sel.value||null;
}
function kindText(kind){return ({topup:'充值',consume:'消费扣款',refund:'退款 / 撤销',adjust:'手动调整'})[kind]||kind||'变动'}
function benefitKind(kind){return ({grant:'发放',consume:'使用',return:'退回 / 撤销',adjust:'手动调整'})[kind]||kind||'变动'}
function render(){
  const c=currentCustomer(),summary=$('prepaidSafeSummary'),ledger=$('prepaidSafeLedger'),benefits=$('prepaidSafeBenefits'),bl=$('prepaidSafeBenefitLedger');if(!summary||!ledger||!benefits||!bl)return;
  if(!c){summary.innerHTML='<div class="prepaid-safe-empty">先建立老板档案。</div>';ledger.innerHTML=benefits.innerHTML=bl.innerHTML='';return}
  const plus=state.prepaid.filter(x=>num(x.delta)>0).reduce((a,b)=>a+num(b.delta),0),minus=Math.abs(state.prepaid.filter(x=>num(x.delta)<0).reduce((a,b)=>a+num(b.delta),0));
  const active=state.benefits.filter(x=>num(x.quantity)>0);
  const paid=num(c.prepaid_balance),gift=num(c.gift_balance),total=paid+gift;
  summary.innerHTML=`<div class="prepaid-safe-stat"><span>可用总余额</span><b>${money(total)}</b></div><div class="prepaid-safe-stat"><span>实充余额</span><b>${money(paid)}</b></div><div class="prepaid-safe-stat"><span>赠送余额</span><b>${money(gift)}</b></div><div class="prepaid-safe-stat"><span>当前权益</span><b>${active.length} 种</b></div>`;
  const reversed=new Set(state.prepaid.map(x=>x.reversal_of_id).filter(Boolean));
  ledger.innerHTML=state.prepaid.length?state.prepaid.map(r=>{const n=num(r.delta),can=r.kind==='topup'&&n>0&&!reversed.has(r.id)&&(!r.preset_id||r.package_issue_id);const type=r.balance_type==='gift'?'赠送余额':'实充余额';return `<div class="prepaid-safe-row"><div><b>${safe(type)} · ${safe(kindText(r.kind))}</b><p>${safe(dateText(r.created_at))}${r.note?' · '+safe(r.note):''}</p><p>${money(r.balance_before)} → ${money(r.balance_after)}</p></div><div><strong class="${n>=0?'prepaid-safe-good':'prepaid-safe-bad'}">${n>=0?'+':''}${money(n)}</strong>${can?`<div style="margin-top:6px"><button class="tiny-btn" data-prepaid-reverse="${safe(r.id)}" type="button">撤销这笔</button></div>`:''}</div></div>`}).join(''):'<div class="prepaid-safe-empty">还没有预存流水。</div>';
  benefits.innerHTML=active.length?active.map(b=>`<div class="prepaid-safe-row"><div><b>${safe(b.name)}</b><p>${b.expires_at?'有效至 '+safe(dateText(b.expires_at)):'长期有效'}</p></div><strong>${qty(b.quantity)} ${safe(b.unit_label||'个')}</strong></div>`).join(''):'<div class="prepaid-safe-empty">当前没有可用权益。</div>';
  bl.innerHTML=state.benefitLedger.length?state.benefitLedger.map(r=>{const n=num(r.delta);return `<div class="prepaid-safe-row"><div><b>${safe(r.benefit_name)} · ${safe(benefitKind(r.kind))}</b><p>${safe(dateText(r.created_at))}${r.note?' · '+safe(r.note):''}</p></div><strong class="${n>=0?'prepaid-safe-good':'prepaid-safe-bad'}">${n>=0?'+':''}${qty(n)}</strong></div>`}).join(''):'<div class="prepaid-safe-empty">还没有权益流水。</div>';
  const ro=isReadonly();['prepaidSafeAdjust','prepaidSafeBenefitAdjust'].forEach(id=>{const el=$(id);if(el)el.disabled=ro});
}

async function loadBase(){
  const c=ctx();const s=supabase();if(!c?.state?.session?.user?.id||!s)return;
  try{
    const [customers,shops]=await Promise.all([query(s.from('customers').select('*').order('name'),'customers'),query(s.from('shops').select('*').order('name'),'shops')]);
    state.customers=customers;state.shops=shops;renderSelector();await loadWallet();
  }catch(e){console.warn('prepaid base load failed',e);toast('预存资料读取失败，请点刷新重试')}
}
async function loadWallet(){
  const c=currentCustomer(),s=supabase();if(!c||!s){state.prepaid=[];state.benefits=[];state.benefitLedger=[];render();return}
  try{
    const [pre,benefits,ledger,fresh]=await Promise.all([
      query(s.from('customer_prepaid_ledger').select('*').eq('customer_id',c.id).order('created_at',{ascending:false}),'prepaid ledger'),
      query(s.from('customer_benefits').select('*').eq('customer_id',c.id).order('updated_at',{ascending:false}),'benefits'),
      query(s.from('customer_benefit_ledger').select('*').eq('customer_id',c.id).order('created_at',{ascending:false}),'benefit ledger'),
      Promise.race([s.from('customers').select('*').eq('id',c.id).maybeSingle(),timeout(RPC_TIMEOUT_MS,'customer refresh timeout')])
    ]);
    state.prepaid=pre;state.benefits=benefits;state.benefitLedger=ledger;if(fresh?.data)state.customers=state.customers.map(x=>x.id===fresh.data.id?fresh.data:x);render();
  }catch(e){console.warn('prepaid wallet load failed',e);toast('余额 / 权益读取失败，请稍后重试')}
}
function setBusy(next){busy=next;['prepaidSafeAdjust','prepaidSafeBenefitAdjust','prepaidSafeRefresh'].forEach(id=>{const el=$(id);if(el)el.disabled=next||isReadonly()})}
async function adjustPrepaid(){
  if(busy||isReadonly())return;const c=currentCustomer();const amount=num($('prepaidSafeAmount')?.value);if(!c){toast('先选择老板');return}if(!(amount>0)){toast('调整金额要大于 0');return}
  const delta=$('prepaidSafeDirection')?.value==='subtract'?-amount:amount;const type=$('prepaidSafeBalanceType')?.value||'paid';setBusy(true);
  try{await callRpc(type==='gift'?'adjust_customer_gift_balance':'adjust_customer_prepaid',{p_customer_id:c.id,p_delta:delta,p_kind:'adjust',p_note:$('prepaidSafeNote')?.value.trim()||null,p_related_record_id:null});$('prepaidSafeAmount').value='';$('prepaidSafeNote').value='';await loadWallet();toast(type==='gift'?'赠送余额已修改 ♡':'实充余额已修改 ♡')}catch(e){console.warn('prepaid adjust failed',e);toast(String(e?.message||e).includes('insufficient_prepaid_balance')?'余额不足，不能扣成负数':'预存修改失败，请稍后重试')}finally{setBusy(false)}
}
async function adjustBenefit(){
  if(busy||isReadonly())return;const c=currentCustomer();const name=$('prepaidSafeBenefitName')?.value.trim();const amount=num($('prepaidSafeBenefitAmount')?.value);if(!c){toast('先选择老板');return}if(!name){toast('先填写权益名称');return}if(!(amount>0)){toast('权益数量要大于 0');return}
  const delta=$('prepaidSafeBenefitDirection')?.value==='subtract'?-amount:amount;const expiry=$('prepaidSafeBenefitExpiry')?.value;setBusy(true);
  try{await callRpc('adjust_customer_benefit',{p_customer_id:c.id,p_name:name,p_delta:delta,p_kind:'adjust',p_unit_label:$('prepaidSafeBenefitUnit')?.value.trim()||'个',p_expires_at:expiry?new Date(expiry+'T23:59:59').toISOString():null,p_note:$('prepaidSafeBenefitNote')?.value.trim()||null,p_related_record_id:null});$('prepaidSafeBenefitName').value='';$('prepaidSafeBenefitAmount').value='1';$('prepaidSafeBenefitNote').value='';await loadWallet();toast('权益已修改 ♡')}catch(e){console.warn('benefit adjust failed',e);toast(String(e?.message||e).includes('insufficient_benefit_quantity')?'权益数量不足，不能扣成负数':'权益修改失败，请稍后重试')}finally{setBusy(false)}
}
async function reverseTopup(id){if(busy||isReadonly())return;const row=state.prepaid.find(x=>x.id===id);if(!row||!confirm(`撤销这笔 ${money(row.delta)} 充值？`))return;setBusy(true);try{await callRpc('reverse_prepaid_topup',{p_ledger_id:id,p_note:null});await loadWallet();toast('这笔充值已撤销 ♡')}catch(e){console.warn('reverse topup failed',e);toast('撤销失败：'+String(e?.message||e))}finally{setBusy(false)}}
function csvCell(v){return '"'+String(v??'').replaceAll('"','""')+'"'}
function exportCsv(){const c=currentCustomer();if(!c){toast('先选择老板');return}const rows=[['类型','时间','名称/操作','变动','变动前','变动后','备注']];state.prepaid.slice().reverse().forEach(r=>rows.push([r.balance_type==='gift'?'赠送余额':'实充余额',dateText(r.created_at),kindText(r.kind),num(r.delta),num(r.balance_before),num(r.balance_after),r.note||'']));state.benefitLedger.slice().reverse().forEach(r=>rows.push(['权益',dateText(r.created_at),`${r.benefit_name} · ${benefitKind(r.kind)}`,num(r.delta),num(r.quantity_before),num(r.quantity_after),r.note||'']));const blob=new Blob(['\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=(c.name||'老板').replace(/[\\/:*?"<>|]/g,'-')+'-预存明细.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function bind(){
  $('prepaidSafeCustomer')?.addEventListener('change',async()=>{state.customerId=$('prepaidSafeCustomer').value||null;await loadWallet()});
  $('prepaidSafeRefresh')?.addEventListener('click',loadBase);$('prepaidSafeExport')?.addEventListener('click',exportCsv);$('prepaidSafeAdjust')?.addEventListener('click',adjustPrepaid);$('prepaidSafeBenefitAdjust')?.addEventListener('click',adjustBenefit);$('prepaidSafeLedger')?.addEventListener('click',e=>{const b=e.target.closest('[data-prepaid-reverse]');if(b)reverseTopup(b.dataset.prepaidReverse)});
}

export async function initPrepaidManagerSafe(){
  if(started){
    const card=$('prepaidManagerSafeCard');
    if(card){card.style.removeProperty('display');card.hidden=false}
    return;
  }
  started=true;ensureStyle();
  if(!mount()){started=false;throw new Error('prepaid page not ready')}
  await loadBase();
}
