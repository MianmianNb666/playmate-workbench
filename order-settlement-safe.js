// PaiMini 派单页老板预存 / 本单扣除。
// 只显示当前老板的预存、权益与本单扣除，不搬消费历史到派单页。
// 保存与扣款仍由 order-wallet-atomic-safe.js 原子完成。

let started=false;
let loadSeq=0;
const $=id=>document.getElementById(id);
const TIMEOUT_MS=16000;
const state={customer:null,benefits:[],balance:0};

function ctx(){try{return window.paiMiniOrderBridge?.getContext?.()||null}catch{return null}}
function supabase(){return ctx()?.supabase||null}
function safe(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
function num(v){const n=Number(v||0);return Number.isFinite(n)?n:0}
function money(v){return (ctx()?.shop?.currency_symbol||'¥')+num(v).toFixed(2)}
function toast(message){window.paiMiniOrderBridge?.toast?.(message)}
function timeout(label){return new Promise((_,reject)=>setTimeout(()=>reject(new Error(label+' timeout')),TIMEOUT_MS))}
async function query(promise,label){const r=await Promise.race([promise,timeout(label)]);if(r?.error)throw r.error;return r?.data||[]}

function orderTotal(){
  const lines=window.paiMiniMultiOrder?.lines;
  if(Array.isArray(lines)&&lines.length)return lines.reduce((sum,x)=>sum+num(x.total),0);
  const totalEl=$('calcTotal');
  if(totalEl)return num((totalEl.textContent||'').replace(/[^0-9.-]/g,''));
  return num(ctx()?.state?.calc?.total);
}

function selectedCustomer(){
  const c=ctx();
  const name=($('#customerName')?.value||'').trim();
  const shopId=c?.shop?.id;
  return (c?.state?.customers||[]).find(x=>x.shop_id===shopId&&String(x.name||'').trim()===name)||null;
}

function shopCustomers(){
  const c=ctx();
  const shopId=c?.state?.shopId||c?.shop?.id;
  return (c?.state?.customers||[]).filter(x=>x.shop_id===shopId);
}

function customerById(id){
  if(!id)return null;
  return (ctx()?.state?.customers||[]).find(x=>String(x.id)===String(id))||null;
}

function syncCustomerSelector(){
  const sel=$('settlementCustomerSelect');if(!sel)return;
  const rows=shopCustomers();
  const old=sel.value;
  sel.innerHTML='<option value="">请选择老板</option>'+rows.map(x=>'<option value="'+safe(x.id)+'">'+safe(x.name)+'</option>').join('');
  if(old&&rows.some(x=>x.id===old)) sel.value=old;
  if(!sel.value){
    const current=selectedCustomer();
    if(current) sel.value=current.id;
  }
}

function currentDeduct(){
  if(!$('settlementUsePrepaid')?.checked)return 0;
  return Math.min(Math.max(0,num($('settlementPrepaidAmount')?.value)),state.balance,orderTotal());
}

function selectedBenefits(){
  return [...document.querySelectorAll('#settlementBenefits [data-benefit-use]:checked')].map(check=>{
    const stock=state.benefits.find(x=>x.id===check.dataset.benefitUse);
    if(!stock)return null;
    const input=document.querySelector(`#settlementBenefits [data-benefit-qty="${stock.id}"]`);
    const quantity=Math.min(Math.max(0,num(input?.value)||1),num(stock.quantity));
    return quantity>0?{benefit_id:stock.id,quantity}:null;
  }).filter(Boolean);
}

function writeSelection(){
  const enabled=!!$('settlementUsePrepaid')?.checked;
  const deduct=currentDeduct();
  window.paiMiniSettlementSelection={
    customer_id:state.customer?.id||null,
    use_prepaid:enabled,
    prepaid_amount:enabled?deduct:0,
    available_prepaid:state.balance,
    benefits:state.benefits.map(x=>({id:x.id,name:x.name,quantity:num(x.quantity),unit_label:x.unit_label||'个'})),
    benefits_used:selectedBenefits()
  };
  renderEstimate();
  window.dispatchEvent(new CustomEvent('paimini:settlement-changed',{detail:window.paiMiniSettlementSelection}));
}

function ensureStyle(){
  if($('orderSettlementSafeStyle'))return;
  const s=document.createElement('style');
  s.id='orderSettlementSafeStyle';
  s.textContent=`
    .settlement-safe-card{margin-top:12px;padding:12px;border-top:1px dashed var(--line);background:transparent}
    .settlement-safe-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap}
    .settlement-safe-head small{display:block;color:var(--muted);margin-top:3px}
    .settlement-safe-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:10px 0}
    .settlement-safe-stat{border:1px solid var(--line);border-radius:12px;padding:9px 10px;background:var(--paper)}
    .settlement-safe-stat span{display:block;color:var(--muted);font-size:10px}.settlement-safe-stat b{display:block;margin-top:3px;font-size:15px}
    .settlement-safe-controls{display:grid;grid-template-columns:1fr 1fr;gap:9px;align-items:end}
    .settlement-safe-benefits{display:grid;gap:7px;margin-top:9px}.settlement-safe-benefit{border:1px solid var(--line);border-radius:12px;padding:8px 10px;font-size:10px}.settlement-safe-benefit-use{display:grid;grid-template-columns:auto 1fr 90px;gap:8px;align-items:center}.settlement-safe-benefit-use input[type="number"]{margin:0}.settlement-safe-benefit-use small{color:var(--muted)}
    .settlement-safe-note{font-size:10px;color:var(--muted);margin-top:8px;line-height:1.45}
    @media(max-width:720px){.settlement-safe-summary{grid-template-columns:1fr 1fr}}
    @media(max-width:520px){.settlement-safe-summary,.settlement-safe-controls{grid-template-columns:1fr}}
  `;
  document.head.appendChild(s);
}

function mount(){
  const page=$('page-calculator');
  if(!page)return false;
  if($('orderSettlementSafeCard')){bind();return true;}
  const totalBox=page.querySelector('.multi-order-total');
  if(!totalBox)return false;
  const card=document.createElement('div');
  card.id='orderSettlementSafeCard';
  card.className='settlement-safe-card';
  card.innerHTML=`
    <div class="settlement-safe-head">
      <div><b>老板预存 · 本单扣除【新版】</b><small>新版结算区已加载 · 跟本单合计一起看，直接处理这一单</small></div>
      <button id="settlementRefresh" class="tiny-btn" type="button">刷新</button>
    </div>
    <div class="settlement-safe-controls" style="margin-top:10px">
      <label>选择老板档案
        <select id="settlementCustomerSelect">
          <option value="">请选择老板</option>
        </select>
      </label>
      <div class="settlement-safe-note" style="align-self:end">选择后会自动读取预存余额，并同步到本单老板。</div>
    </div>
    <div id="settlementEmpty" class="empty-state">选择已有老板档案后显示预存余额。</div>
    <div id="settlementBody" class="hidden">
      <div class="settlement-safe-summary">
        <div class="settlement-safe-stat"><span>剩余预存</span><b id="settlementBalance">¥0.00</b></div>
        <div class="settlement-safe-stat"><span>本单合计</span><b id="settlementOrderTotal">¥0.00</b></div>
        <div class="settlement-safe-stat"><span>本单扣除</span><b id="settlementDeduct">¥0.00</b></div>
        <div class="settlement-safe-stat"><span>扣后余额</span><b id="settlementAfter">¥0.00</b></div>
      </div>
      <div class="settlement-safe-controls">
        <label class="check-label"><input id="settlementUsePrepaid" type="checkbox"> 本单使用预存</label>
        <label>本单扣除金额<input id="settlementPrepaidAmount" type="number" min="0" step="0.01" placeholder="0.00" disabled></label>
      </div>
      <div id="settlementBenefits" class="settlement-safe-benefits"></div>
      <div class="mini-actions" style="margin-top:10px">
        <button id="settlementAtomicSave" class="btn primary hidden" type="button">扣款并保存本单</button>
        <small style="align-self:center;color:var(--muted)">勾选预存或权益后，用这个按钮保存并自动扣减。</small>
      </div>
      <p class="settlement-safe-note">这里仅处理本单结算；过往消费继续在「消费记录 / 老板档案」查看。</p>
    </div>`;
  totalBox.insertAdjacentElement('afterend',card);
  bind();
  return true;
}

function renderEstimate(){
  const total=orderTotal();
  const deduct=currentDeduct();
  if($('settlementOrderTotal'))$('settlementOrderTotal').textContent=money(total);
  if($('settlementBalance'))$('settlementBalance').textContent=money(state.balance);
  if($('settlementDeduct'))$('settlementDeduct').textContent=money(deduct);
  if($('settlementAfter'))$('settlementAfter').textContent=money(Math.max(0,state.balance-deduct));
}

function render(){
  syncCustomerSelector();
  const empty=$('settlementEmpty'),body=$('settlementBody');
  if(!empty||!body)return;
  if(!state.customer){
    empty.textContent=$('settlementCustomerSelect')?.value?'正在读取该老板的预存余额…':'选择已有老板档案后显示预存余额。';empty.classList.remove('hidden');body.classList.add('hidden');
    window.paiMiniSettlementSelection={customer_id:null,use_prepaid:false,prepaid_amount:0,available_prepaid:0,benefits:[],benefits_used:[]};
    return;
  }
  empty.classList.add('hidden');body.classList.remove('hidden');
  const total=orderTotal();
  const check=$('settlementUsePrepaid'),amount=$('settlementPrepaidAmount');
  if(state.balance<=0){
    if(check){check.checked=false;check.disabled=true}
    if(amount){amount.value='';amount.disabled=true}
  }else{
    if(check)check.disabled=false;
    if(amount)amount.disabled=!check?.checked;
  }
  const b=$('settlementBenefits');
  if(b)b.innerHTML=state.benefits.length
    ?'<div class="settlement-safe-benefit"><b>本单使用权益</b><small style="display:block;margin-top:3px;color:var(--muted)">勾选后与订单一起原子保存并自动扣减数量。</small></div>'+state.benefits.map(x=>`<label class="settlement-safe-benefit settlement-safe-benefit-use"><input type="checkbox" data-benefit-use="${safe(x.id)}"><span><b>${safe(x.name)}</b><small>可用 ${safe(x.quantity)} ${safe(x.unit_label||'个')}</small></span><input type="number" data-benefit-qty="${safe(x.id)}" min="0.01" max="${safe(x.quantity)}" step="0.01" value="1" disabled aria-label="${safe(x.name)}使用数量"></label>`).join('')
    :'<span class="settlement-safe-benefit">暂无可用权益</span>';
  if(check?.checked&&amount&&num(amount.value)===0)amount.value=Math.min(total,state.balance).toFixed(2);
  writeSelection();
}

async function refresh(){
  const seq=++loadSeq;
  const explicitId=$('settlementCustomerSelect')?.value||'';
  const c=explicitId ? customerById(explicitId) : selectedCustomer();
  state.customer=c;state.benefits=[];state.balance=num(c?.prepaid_balance);
  render();
  if(!c)return;
  const s=supabase();if(!s)return;
  try{
    const [fresh,benefits]=await Promise.all([
      Promise.race([s.from('customers').select('id,prepaid_balance').eq('id',c.id).maybeSingle(),timeout('customer balance')]),
      query(s.from('customer_benefits').select('id,name,quantity,unit_label,expires_at').eq('customer_id',c.id).gt('quantity',0).order('updated_at',{ascending:false}),'customer benefits')
    ]);
    if(seq!==loadSeq)return;
    if(fresh?.error)throw fresh.error;
    state.balance=num(fresh?.data?.prepaid_balance);
    state.benefits=(benefits||[]).filter(x=>!x.expires_at||new Date(x.expires_at).getTime()>Date.now());
    render();
  }catch(e){console.warn('settlement refresh failed',e);toast('预存余额读取失败，请点刷新重试')}
}

function bind(){
  const card=$('orderSettlementSafeCard');
  if(!card||card.dataset.bound==='1')return;
  card.dataset.bound='1';
  $('settlementRefresh')?.addEventListener('click',()=>void refresh());
  const handleSettlementCustomer=()=>{
    const id=$('settlementCustomerSelect')?.value||'';
    const customer=customerById(id);
    if(customer&&$('customerName')){
      $('customerName').value=customer.name||'';
      $('customerName').dispatchEvent(new Event('input',{bubbles:true}));
    }
    void refresh();
  };
  $('settlementCustomerSelect')?.addEventListener('change',handleSettlementCustomer);
  $('settlementCustomerSelect')?.addEventListener('input',handleSettlementCustomer);
  $('settlementUsePrepaid')?.addEventListener('change',()=>{
    const on=$('settlementUsePrepaid').checked;
    const amount=$('settlementPrepaidAmount');
    if(amount){amount.disabled=!on;if(on&&num(amount.value)===0)amount.value=Math.min(orderTotal(),state.balance).toFixed(2)}
    writeSelection();
  });
  $('settlementPrepaidAmount')?.addEventListener('input',()=>{
    const el=$('settlementPrepaidAmount');
    if(el){const capped=Math.min(Math.max(0,num(el.value)),state.balance,orderTotal());if(num(el.value)!==capped)el.value=capped.toFixed(2)}
    writeSelection();
  });
  $('settlementBenefits')?.addEventListener('change',e=>{
    const check=e.target.closest?.('[data-benefit-use]');
    if(check){
      const input=document.querySelector(`#settlementBenefits [data-benefit-qty="${check.dataset.benefitUse}"]`);
      if(input){input.disabled=!check.checked;if(check.checked&&num(input.value)<=0)input.value='1'}
    }
    const qty=e.target.closest?.('[data-benefit-qty]');
    if(qty){
      const stock=state.benefits.find(x=>x.id===qty.dataset.benefitQty);
      const capped=Math.min(Math.max(0.01,num(qty.value)||1),num(stock?.quantity));
      qty.value=String(capped);
    }
    writeSelection();
  });
  $('settlementBenefits')?.addEventListener('input',e=>{if(e.target.closest?.('[data-benefit-qty]'))writeSelection()});
  $('customerName')?.addEventListener('input',()=>{
    clearTimeout(bind.customerTimer);
    bind.customerTimer=setTimeout(()=>{
      const current=selectedCustomer();
      if($('settlementCustomerSelect')) $('settlementCustomerSelect').value=current?.id||'';
      refresh();
    },220)
  });
  ['durationInput','calcUnitPrice','customerDiscount'].forEach(id=>$(id)?.addEventListener('input',()=>setTimeout(renderEstimate,30)));
  $('addOrderLineBtn')?.addEventListener('click',()=>setTimeout(renderEstimate,80));
  const grand=$('orderGrandTotal');
  if(grand&&typeof MutationObserver!=='undefined'){
    new MutationObserver(()=>{renderEstimate();writeSelection()}).observe(grand,{childList:true,characterData:true,subtree:true});
  }
}


function installSettlementWatchdog(){
  if(window.__paiMiniSettlementWatchdog)return;
  window.__paiMiniSettlementWatchdog=true;

  let timer=null;
  const heal=()=>{
    clearTimeout(timer);
    timer=setTimeout(async()=>{
      const page=$('page-calculator');
      if(!page)return;
      if($('orderSettlementSafeCard')){
        syncCustomerSelector();
        const chosen=$('settlementCustomerSelect')?.value||'';
        if(chosen && (!state.customer || String(state.customer.id)!==String(chosen))) void refresh();
      }
    },80);
  };

  const page=$('page-calculator');
  if(page&&typeof MutationObserver!=='undefined'){
    new MutationObserver(heal).observe(page,{childList:true,subtree:true});
  }
  window.addEventListener('paimini:prepaid-updated',heal);
  window.addEventListener('resize',heal);
}

export async function initOrderSettlementSafe(){
  if(started)return;
  started=true;ensureStyle();
  if(!mount()){started=false;throw new Error('order total section not ready')}
  installSettlementWatchdog();
  await refresh();
}
