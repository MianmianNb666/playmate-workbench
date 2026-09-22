// PaiMini isolated order wallet module.
// Stage 1: read-only prepaid/benefit preview only. Never intercepts save buttons.

let mounted=false;
let destroyed=false;
let loading=false;
let customer=null;
let benefits=[];
let refreshTimer=null;
const RPC_TIMEOUT_MS=16000;

const $=id=>document.getElementById(id);
function num(v){const n=Number(v||0);return Number.isFinite(n)?n:0}
function safe(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
function bridge(){return window.paiMiniOrderBridge||null}
function ctx(){try{return bridge()?.getContext?.()||null}catch{return null}}
function currentShop(){return ctx()?.shop||null}
function money(v){return (currentShop()?.currency_symbol||'¥')+num(v).toFixed(2)}
function currentOrderTotal(){
  const multi=window.paiMiniMultiOrder;
  if(multi?.lines?.length)return num(multi.total);
  return num(($('#calcTotal')?.textContent||'').replace(/[^0-9.-]/g,''));
}
function timeoutPromise(ms,label){
  return new Promise((_,reject)=>setTimeout(()=>{
    const e=new Error(label||'wallet timeout');e.name='OrderWalletTimeoutError';reject(e);
  },ms));
}
async function guarded(promise,label){return Promise.race([promise,timeoutPromise(RPC_TIMEOUT_MS,label)])}

function ensureStyle(){
  if($('orderWalletSafeStyle'))return;
  const s=document.createElement('style');
  s.id='orderWalletSafeStyle';
  s.textContent=`
    .order-wallet-safe{margin-top:14px}.order-wallet-safe .ow-pill{display:inline-flex;padding:5px 9px;border-radius:999px;background:var(--pink-soft);font-size:11px}
    .order-wallet-safe .ow-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-top:12px}.order-wallet-safe .ow-stat{border:1px solid var(--line);border-radius:14px;padding:10px 12px;background:var(--paper)}
    .order-wallet-safe .ow-stat span{display:block;color:var(--muted);font-size:10px}.order-wallet-safe .ow-stat b{display:block;margin-top:4px;font-size:16px}.order-wallet-safe .ow-benefits{display:grid;gap:8px;margin-top:12px}
    .order-wallet-safe .ow-benefit{display:flex;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--line);border-radius:13px}.order-wallet-safe .ow-benefit small{display:block;color:var(--muted);margin-top:3px}.order-wallet-safe .ow-state{margin-top:10px;padding:11px 12px;border:1px dashed var(--line);border-radius:13px;color:var(--muted);font-size:12px}
    @media(max-width:640px){.order-wallet-safe .ow-summary{grid-template-columns:1fr}.order-wallet-safe .ow-benefit{flex-direction:column}}
  `;
  document.head.appendChild(s);
}

function render(){
  const tag=$('orderWalletSafeTag');
  if(tag)tag.textContent=customer?`${customer.name||'老板'} · 已建档`:'未匹配老板档案';
  const total=currentOrderTotal();
  const balance=num(customer?.prepaid_balance);
  const summary=$('orderWalletSafeSummary');
  if(summary)summary.innerHTML=`
    <div class="ow-stat"><span>本单消费</span><b>${money(total)}</b></div>
    <div class="ow-stat"><span>预存余额</span><b>${money(balance)}</b></div>
    <div class="ow-stat"><span>本次另付</span><b>${money(total)}</b></div>`;
  const list=$('orderWalletSafeBenefits');
  if(!list)return;
  if(!customer){list.innerHTML='<div class="ow-state">选择一个已经建立顾客档案的老板后，这里会显示预存余额和可用权益。</div>';return;}
  const now=Date.now();
  const rows=benefits.filter(b=>num(b.quantity)>0&&(!b.expires_at||new Date(b.expires_at).getTime()>=now));
  list.innerHTML=rows.length?rows.map(b=>`<div class="ow-benefit"><div><b>${safe(b.name||'权益')}</b><small>${b.expires_at?`有效至 ${safe(new Date(b.expires_at).toLocaleDateString('zh-CN'))}`:'长期有效'}</small></div><strong>${safe(b.quantity)} ${safe(b.unit_label||'个')}</strong></div>`).join(''):'<div class="ow-state">这个老板当前没有可用权益。</div>';
}

async function refresh(){
  if(loading||destroyed)return;
  const c=ctx();
  const shopId=c?.state?.shopId;
  const name=($('#customerName')?.value||'').trim();
  customer=null;benefits=[];
  if(!shopId||!name){render();return;}
  const known=(c?.state?.customers||[]).find(x=>x.shop_id===shopId&&String(x.name||'')===name)||null;
  if(!known){render();return;}
  const supabase=c?.supabase;
  if(!supabase?.from){render();return;}
  loading=true;
  const stateBox=$('orderWalletSafeState');
  if(stateBox)stateBox.textContent='正在读取老板预存与权益…';
  try{
    const [fresh,benefitRows]=await Promise.all([
      guarded(supabase.from('customers').select('*').eq('id',known.id).maybeSingle(),'customer wallet timeout'),
      guarded(supabase.from('customer_benefits').select('*').eq('customer_id',known.id).order('updated_at',{ascending:false}),'benefit wallet timeout')
    ]);
    if(fresh?.error)throw fresh.error;
    if(benefitRows?.error)throw benefitRows.error;
    customer=fresh?.data||known;
    benefits=Array.isArray(benefitRows?.data)?benefitRows.data:[];
    if(stateBox)stateBox.textContent='预存 / 权益读取成功。当前阶段只展示，不会扣款。';
    window.__paiMiniOrderWalletStatus='readonly-ok';
  }catch(error){
    console.warn('order wallet safe read degraded',error);
    if(stateBox)stateBox.textContent=error?.name==='OrderWalletTimeoutError'?'预存 / 权益读取等待超时，主程序不受影响。':'预存 / 权益读取失败，主程序不受影响。';
    window.__paiMiniOrderWalletStatus='readonly-degraded';
  }finally{loading=false;render();}
}

function scheduleRefresh(delay=250){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>refresh(),delay)}
function bind(){
  $('#customerName')?.addEventListener('input',()=>scheduleRefresh(300));
  $('#calcShop')?.addEventListener('change',()=>scheduleRefresh(500));
  $('#orderWalletSafeRefresh')?.addEventListener('click',()=>refresh());
  ['calcTotal','orderGrandTotal'].forEach(id=>{
    const el=$(id);if(el)new MutationObserver(()=>render()).observe(el,{childList:true,subtree:true,characterData:true});
  });
}

function mount(){
  const page=$('page-calculator');
  if(!page)return false;
  ensureStyle();
  let card=$('orderWalletSafeCard');
  if(!card){
    card=document.createElement('div');card.id='orderWalletSafeCard';card.className='card order-wallet-safe';
    card.innerHTML=`
      <div class="card-title"><div><b>⑤ 预存 / 权益</b><small>先安全读取老板余额与权益，暂不接管保存</small></div><span id="orderWalletSafeTag" class="ow-pill">未匹配老板档案</span></div>
      <div id="orderWalletSafeSummary" class="ow-summary"></div>
      <div id="orderWalletSafeBenefits" class="ow-benefits"></div>
      <div id="orderWalletSafeState" class="ow-state">当前为安全读取阶段，不会扣预存、不会扣权益、不会改保存逻辑。</div>
      <div class="mini-actions"><button id="orderWalletSafeRefresh" class="tiny-btn" type="button">重新读取</button></div>`;
    const actions=page.querySelector('.action-row');
    if(actions)actions.insertAdjacentElement('beforebegin',card);else page.appendChild(card);
  }
  bind();render();mounted=true;return true;
}

export async function initOrderWalletSafe(){
  destroyed=false;
  if(!mount())throw new Error('calculator page not ready');
  queueMicrotask(()=>refresh());
  return {status:'ready',phase:'wallet-readonly'};
}

export function destroyOrderWalletSafe(){
  destroyed=true;clearTimeout(refreshTimer);
  $('orderWalletSafeCard')?.remove();$('orderWalletSafeStyle')?.remove();mounted=false;
}
