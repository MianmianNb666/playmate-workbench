// PaiMini 顾客档案预存余额标记。combined total refresh v2
// 只增强顾客卡片显示，不改顾客保存 / 删除逻辑。

let started=false;
let observer=null;
let refreshTimer=null;
const balances=new Map();
const $=id=>document.getElementById(id);
const TIMEOUT_MS=12000;

function ctx(){try{return window.paiMiniOrderBridge?.getContext?.()||null}catch{return null}}
function supabase(){return ctx()?.supabase||null}
function safeMoney(v,customerId){const c=(ctx()?.state?.customers||[]).find(x=>x.id===customerId);const shop=(ctx()?.state?.shops||[]).find(x=>x.id===c?.shop_id);return (shop?.currency_symbol||'¥')+Number(v||0).toFixed(2)}
function timeout(){return new Promise((_,reject)=>setTimeout(()=>reject(new Error('customer prepaid timeout')),TIMEOUT_MS))}

function ensureStyle(){
  if($('customerPrepaidBadgeStyle'))return;
  const s=document.createElement('style');s.id='customerPrepaidBadgeStyle';s.textContent=`
  .customer-prepaid-badge{display:inline-flex;align-items:center;gap:5px;margin-top:7px;padding:5px 9px;border:1px solid var(--line);border-radius:999px;background:var(--pink-soft);font-size:11px}.customer-prepaid-badge span{color:var(--muted)}.customer-prepaid-badge b{font-size:12px}
  `;document.head.appendChild(s);
}

function applyBadges(){
  const list=$('customerProfileList');if(!list)return;
  list.querySelectorAll('.customer-profile-card').forEach(card=>{
    const checkout=card.querySelector('[data-use-customer]');
    if(checkout&&checkout.textContent.trim()!=='去结账')checkout.textContent='去结账';
    const id=card.querySelector('[data-edit-customer]')?.dataset.editCustomer||checkout?.dataset.useCustomer;
    if(!id)return;
    const customer=(ctx()?.state?.customers||[]).find(x=>x.id===id);const balance=balances.has(id)?balances.get(id):(Number(customer?.prepaid_balance||0)+Number(customer?.gift_balance||0));
    const text=safeMoney(balance,id);
    let badge=card.querySelector('.customer-prepaid-badge');
    if(!badge){
      badge=document.createElement('div');badge.className='customer-prepaid-badge';badge.innerHTML='<span>预存余额</span><b></b>';
      const head=card.querySelector('.customer-profile-head > div')||card.querySelector('.customer-profile-head')||card;head.appendChild(badge);
    }
    if(badge.dataset.balanceText===text)return;
    badge.dataset.balanceText=text;
    const value=badge.querySelector('b');if(value)value.textContent=text;
  });
}

async function refresh(){
  const s=supabase();if(!s)return applyBadges();
  try{
    const result=await Promise.race([s.from('customers').select('id,prepaid_balance,gift_balance'),timeout()]);
    if(result?.error)throw result.error;
    (result?.data||[]).forEach(c=>balances.set(c.id,Number(c.prepaid_balance||0)+Number(c.gift_balance||0)));
  }catch(e){console.warn('customer prepaid badges refresh failed',e)}
  applyBadges();
}

function scheduleRefresh(delay=120){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>void refresh(),delay)}

export async function initCustomerPrepaidBadgesSafe(){
  if(started)return;started=true;ensureStyle();
  const list=$('customerProfileList');if(!list){started=false;throw new Error('customer profile list not ready')}
  observer=new MutationObserver(()=>queueMicrotask(applyBadges));
  observer.observe(list,{childList:true,subtree:true});
  document.querySelector('.nav-tab[data-page="customers"]')?.addEventListener('click',()=>scheduleRefresh(120));
  $('customerProfileSearch')?.addEventListener('input',()=>setTimeout(applyBadges,20));
  window.addEventListener('paimini:prepaid-updated',e=>{const id=e.detail?.customerId;if(id)balances.set(id,Number(e.detail?.balance||0));applyBadges()});
  await refresh();
  try{
    const detail=await import('./customer-detail-safe.js?v=20260923-customer-detail1');
    await detail.initCustomerDetailSafe?.();
  }catch(error){
    console.warn('customer detail safe load failed',error);
  }
}
