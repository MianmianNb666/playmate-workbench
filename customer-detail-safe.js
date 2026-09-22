// PaiMini 顾客详情页：点击顾客卡片查看个人资料、预存余额、权益和过往单子。
// 独立增强模块，不接管核心顾客保存/删除逻辑。

let started=false;
let activeCustomerId=null;
const $=id=>document.getElementById(id);
const TIMEOUT_MS=14000;

function ctx(){try{return window.paiMiniOrderBridge?.getContext?.()||null}catch{return null}}
function supabase(){return ctx()?.supabase||null}
function safe(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
function num(v){const n=Number(v||0);return Number.isFinite(n)?n:0}
function money(v,shopId){const shop=(ctx()?.state?.shops||[]).find(s=>s.id===shopId);return (shop?.currency_symbol||'¥')+num(v).toFixed(2)}
function fmtDate(v){if(!v)return '未填写';const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleDateString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'})}
function fmtDateTime(v){if(!v)return '-';const d=new Date(v);return d.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}
function timeout(label){return new Promise((_,reject)=>setTimeout(()=>reject(new Error(label+' timeout')),TIMEOUT_MS))}
async function query(promise,label){const r=await Promise.race([promise,timeout(label)]);if(r?.error)throw r.error;return r?.data}
function toast(msg){window.paiMiniOrderBridge?.toast?.(msg)}

function ensureStyle(){
  if($('customerDetailSafeStyle'))return;
  const s=document.createElement('style');s.id='customerDetailSafeStyle';s.textContent=`
  .customer-profile-card{cursor:pointer}.customer-detail-hint{font-size:10px;color:var(--muted);margin-top:6px}
  .customer-detail-dialog{border:0;padding:0;background:transparent;width:min(900px,calc(100vw - 22px));max-width:900px}.customer-detail-dialog::backdrop{background:rgba(50,42,39,.32)}
  .customer-detail-shell{background:var(--bg);border:1px solid var(--line);border-radius:22px;max-height:min(88vh,920px);overflow:auto;padding:18px;box-shadow:0 20px 50px rgba(70,55,50,.18)}
  .customer-detail-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.customer-detail-top h3{margin:0;font-size:24px}.customer-detail-top p{margin:5px 0 0;color:var(--muted);font-size:12px}.customer-detail-close{border:1px solid var(--line);background:var(--paper);border-radius:999px;width:34px;height:34px;font-size:20px;cursor:pointer}
  .customer-detail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:13px}.customer-detail-card{background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:14px}.customer-detail-card.wide{grid-column:1/-1}.customer-detail-card h4{margin:0 0 10px;font-size:14px}.customer-detail-kv{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.customer-detail-kv div{padding:9px;border:1px solid var(--line);border-radius:12px}.customer-detail-kv span{display:block;color:var(--muted);font-size:10px}.customer-detail-kv b{display:block;margin-top:3px;font-size:13px;word-break:break-word}
  .customer-detail-balance{font-size:28px;font-weight:900;margin:2px 0 8px}.customer-detail-sub{display:flex;gap:8px;flex-wrap:wrap}.customer-detail-sub span{font-size:11px;padding:5px 8px;border-radius:999px;background:var(--pink-soft)}
  .customer-benefit-list{display:flex;gap:7px;flex-wrap:wrap}.customer-benefit-chip{border:1px solid var(--line);border-radius:999px;padding:7px 10px;font-size:11px}.customer-benefit-chip.expired{opacity:.55;text-decoration:line-through}
  .customer-order-list{display:grid;gap:7px}.customer-order-row{display:grid;grid-template-columns:90px 1fr auto;gap:8px;align-items:center;border:1px solid var(--line);border-radius:12px;padding:9px}.customer-order-row small{color:var(--muted)}.customer-order-row strong{white-space:nowrap}.customer-order-more{font-size:11px;color:var(--muted);text-align:center;margin-top:8px}
  .customer-detail-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:13px}.customer-detail-form{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.customer-detail-form label{font-size:11px;color:var(--muted)}.customer-detail-form input,.customer-detail-form textarea{width:100%;margin-top:4px}.customer-detail-form .wide{grid-column:1/-1}.customer-detail-empty{color:var(--muted);font-size:12px;padding:8px 0}
  @media(max-width:680px){.customer-detail-grid,.customer-detail-form{grid-template-columns:1fr}.customer-detail-card.wide,.customer-detail-form .wide{grid-column:auto}.customer-detail-kv{grid-template-columns:1fr}.customer-order-row{grid-template-columns:74px 1fr}.customer-order-row strong{grid-column:2}.customer-detail-shell{padding:13px;border-radius:18px}}
  `;document.head.appendChild(s);
}

function ensureDialog(){
  if($('customerDetailDialog'))return;
  const d=document.createElement('dialog');d.id='customerDetailDialog';d.className='customer-detail-dialog';
  d.innerHTML=`<div class="customer-detail-shell">
    <div class="customer-detail-top"><div><h3 id="customerDetailName">老板档案</h3><p id="customerDetailSubtitle">正在读取…</p></div><button id="customerDetailClose" class="customer-detail-close" type="button">×</button></div>
    <div id="customerDetailContent" class="customer-detail-grid"></div>
    <div class="customer-detail-actions">
      <button id="customerDetailCheckout" class="btn primary" type="button">去结账</button>
      <button id="customerDetailEditExtra" class="btn soft" type="button">编辑个人资料</button>
      <button id="customerDetailRecords" class="btn soft" type="button">查看消费记录</button>
    </div>
    <div id="customerDetailEditBox" class="customer-detail-card hidden" style="margin-top:10px">
      <h4>个人资料</h4>
      <div class="customer-detail-form">
        <label>生日<input id="customerDetailBirthday" type="date"></label>
        <label>地区<input id="customerDetailRegion" maxlength="100" placeholder="例如 上海 / 墨尔本"></label>
        <label class="wide">偏好 / 常点内容<textarea id="customerDetailPreferences" rows="3" maxlength="800" placeholder="例如常点项目、喜欢的陪陪、沟通偏好等"></textarea></label>
      </div>
      <div class="customer-detail-actions"><button id="customerDetailCancelEdit" class="btn ghost" type="button">取消</button><button id="customerDetailSaveExtra" class="btn primary" type="button">保存个人资料</button></div>
    </div>
  </div>`;
  document.body.appendChild(d);
  $('customerDetailClose')?.addEventListener('click',()=>d.close());
  d.addEventListener('click',e=>{if(e.target===d)d.close()});
  $('customerDetailEditExtra')?.addEventListener('click',()=>$('customerDetailEditBox')?.classList.toggle('hidden'));
  $('customerDetailCancelEdit')?.addEventListener('click',()=>$('customerDetailEditBox')?.classList.add('hidden'));
  $('customerDetailSaveExtra')?.addEventListener('click',saveExtra);
  $('customerDetailCheckout')?.addEventListener('click',goCheckout);
  $('customerDetailRecords')?.addEventListener('click',goRecords);
}

function customerFromState(id){return (ctx()?.state?.customers||[]).find(c=>c.id===id)||null}

async function fetchCustomer(id){
  const s=supabase();if(!s)return customerFromState(id);
  const full=await Promise.race([s.from('customers').select('id,shop_id,name,contact,notes,discount_rate,prepaid_balance,birthday,region,preferences').eq('id',id).maybeSingle(),timeout('customer detail')]);
  if(!full?.error)return full?.data||customerFromState(id);
  if(String(full.error?.message||'').includes('birthday')||String(full.error?.message||'').includes('region')||String(full.error?.message||'').includes('preferences')){
    const basic=await query(s.from('customers').select('id,shop_id,name,contact,notes,discount_rate,prepaid_balance').eq('id',id).maybeSingle(),'customer basic');
    return basic||customerFromState(id);
  }
  throw full.error;
}

async function fetchDetails(customer){
  const s=supabase();if(!s)return {benefits:[],orders:[],ledger:[]};
  const [benefits,orders,ledger]=await Promise.all([
    query(s.from('customer_benefits').select('id,name,quantity,unit_label,expires_at,note').eq('customer_id',customer.id).order('updated_at',{ascending:false}),'benefits'),
    query(s.from('consumption_records').select('id,item_name_snapshot,companion_name,duration_input,quantity,amount,occurred_at,note').eq('customer_id',customer.id).order('occurred_at',{ascending:false}).limit(100),'orders'),
    query(s.from('customer_prepaid_ledger').select('kind,delta,balance_after,created_at,note').eq('customer_id',customer.id).order('created_at',{ascending:false}).limit(200),'prepaid ledger')
  ]);
  return {benefits:benefits||[],orders:orders||[],ledger:ledger||[]};
}

function render(customer,details){
  const shop=(ctx()?.state?.shops||[]).find(s=>s.id===customer.shop_id);
  const orders=details.orders||[];const benefits=details.benefits||[];const ledger=details.ledger||[];
  const topup=ledger.filter(x=>num(x.delta)>0).reduce((s,x)=>s+num(x.delta),0);
  const used=Math.abs(ledger.filter(x=>num(x.delta)<0).reduce((s,x)=>s+num(x.delta),0));
  const totalOrders=orders.reduce((s,x)=>s+num(x.amount),0);
  const activeBenefits=benefits.filter(x=>num(x.quantity)>0&&(!x.expires_at||new Date(x.expires_at).getTime()>Date.now()));
  $('customerDetailName').textContent=customer.name||'老板档案';
  $('customerDetailSubtitle').textContent=(shop?.name||'店铺')+' · '+orders.length+' 笔历史订单';
  $('customerDetailContent').innerHTML=`
    <section class="customer-detail-card"><h4>👤 个人信息</h4><div class="customer-detail-kv">
      <div><span>昵称</span><b>${safe(customer.name||'-')}</b></div><div><span>联系方式</span><b>${safe(customer.contact||'未填写')}</b></div>
      <div><span>生日</span><b>${safe(customer.birthday?fmtDate(customer.birthday):'未填写')}</b></div><div><span>地区</span><b>${safe(customer.region||'未填写')}</b></div>
      <div><span>折扣</span><b>${safe(customer.discount_rate??100)}%</b></div><div><span>所属店铺</span><b>${safe(shop?.name||'-')}</b></div>
    </div>${customer.preferences?`<p style="font-size:12px"><b>偏好：</b>${safe(customer.preferences)}</p>`:''}${customer.notes?`<p style="font-size:12px"><b>备注：</b>${safe(customer.notes)}</p>`:''}</section>
    <section class="customer-detail-card"><h4>💰 预存余额</h4><div class="customer-detail-balance">${money(customer.prepaid_balance,customer.shop_id)}</div><div class="customer-detail-sub"><span>累计增加 ${money(topup,customer.shop_id)}</span><span>累计使用 ${money(used,customer.shop_id)}</span><span>历史消费 ${money(totalOrders,customer.shop_id)}</span></div></section>
    <section class="customer-detail-card wide"><h4>🎁 当前权益</h4><div class="customer-benefit-list">${activeBenefits.length?activeBenefits.map(x=>`<span class="customer-benefit-chip">${safe(x.name)} × ${safe(x.quantity)} ${safe(x.unit_label||'个')}${x.expires_at?` · ${safe(fmtDate(x.expires_at))}到期`:''}</span>`).join(''):'<span class="customer-detail-empty">暂无可用权益</span>'}</div></section>
    <section class="customer-detail-card wide"><h4>🧾 过往单子</h4><div class="customer-order-list">${orders.length?orders.slice(0,12).map(r=>`<div class="customer-order-row"><small>${safe(fmtDateTime(r.occurred_at))}</small><div><b>${safe(r.item_name_snapshot||'未命名项目')}</b><small>${r.companion_name?`陪陪 ${safe(r.companion_name)} · `:''}${safe(r.duration_input||r.quantity||'')}</small></div><strong>${money(r.amount,customer.shop_id)}</strong></div>`).join(''):'<div class="customer-detail-empty">还没有消费记录</div>'}</div>${orders.length>12?`<div class="customer-order-more">这里先显示最近 12 笔，共 ${orders.length} 笔，可点下方“查看消费记录”看更多。</div>`:''}</section>`;
  $('customerDetailBirthday').value=customer.birthday?String(customer.birthday).slice(0,10):'';
  $('customerDetailRegion').value=customer.region||'';
  $('customerDetailPreferences').value=customer.preferences||'';
  const extraReady=('birthday' in customer)||('region' in customer)||('preferences' in customer);
  $('customerDetailEditExtra').disabled=!extraReady;
  $('customerDetailEditExtra').title=extraReady?'编辑生日、地区和偏好':'请先运行顾客详情数据库升级 SQL';
}

async function openCustomer(id){
  ensureDialog();activeCustomerId=id;
  $('customerDetailName').textContent='老板档案';$('customerDetailSubtitle').textContent='正在读取…';$('customerDetailContent').innerHTML='<div class="customer-detail-card wide">正在读取老板余额、权益和过往单子…</div>';
  $('customerDetailEditBox')?.classList.add('hidden');$('customerDetailDialog').showModal();
  try{const customer=await fetchCustomer(id);if(!customer)throw new Error('customer_not_found');const details=await fetchDetails(customer);if(activeCustomerId!==id)return;render(customer,details)}catch(e){console.warn('customer detail load failed',e);$('customerDetailContent').innerHTML='<div class="customer-detail-card wide">老板档案读取失败，请稍后再试。</div>';toast('老板档案读取失败')}
}

async function saveExtra(){
  if(!activeCustomerId)return;const s=supabase();if(!s)return;
  const btn=$('customerDetailSaveExtra');btn.disabled=true;const old=btn.textContent;btn.textContent='保存中…';
  try{
    const payload={birthday:$('customerDetailBirthday').value||null,region:$('customerDetailRegion').value.trim()||null,preferences:$('customerDetailPreferences').value.trim()||null};
    const r=await Promise.race([s.from('customers').update(payload).eq('id',activeCustomerId).select('id').maybeSingle(),timeout('save customer detail')]);
    if(r?.error)throw r.error;
    const c=customerFromState(activeCustomerId);if(c)Object.assign(c,payload);
    $('customerDetailEditBox').classList.add('hidden');toast('老板个人资料已保存 ♡');await openCustomer(activeCustomerId);
  }catch(e){console.warn('customer detail save failed',e);toast(String(e?.message||'保存失败').includes('column')?'请先运行顾客详情数据库升级 SQL':'个人资料保存失败')}
  finally{btn.disabled=false;btn.textContent=old}
}

function goCheckout(){
  const c=customerFromState(activeCustomerId);if(!c)return;
  $('customerDetailDialog')?.close();
  document.querySelector('.nav-tab[data-page="calculator"]')?.click();
  setTimeout(()=>{const name=$('customerName');if(name){name.value=c.name||'';name.dispatchEvent(new Event('input',{bubbles:true}));name.dispatchEvent(new Event('change',{bubbles:true}))}},80);
}

function goRecords(){
  const c=customerFromState(activeCustomerId);if(!c)return;
  $('customerDetailDialog')?.close();document.querySelector('.nav-tab[data-page="records"]')?.click();
  setTimeout(()=>{const q=$('recordSearch');if(q){q.value=c.name||'';q.dispatchEvent(new Event('input',{bubbles:true}))}},80);
}

function bindCards(){
  const list=$('customerProfileList');if(!list)return false;
  list.addEventListener('click',e=>{
    if(e.target.closest('button,input,select,textarea,a'))return;
    const card=e.target.closest('.customer-profile-card');if(!card)return;
    const id=card.querySelector('[data-edit-customer]')?.dataset.editCustomer||card.querySelector('[data-use-customer]')?.dataset.useCustomer;
    if(id)void openCustomer(id);
  });
  return true;
}

export async function initCustomerDetailSafe(){
  if(started)return;started=true;ensureStyle();ensureDialog();if(!bindCards()){started=false;throw new Error('customer list not ready')}
}
