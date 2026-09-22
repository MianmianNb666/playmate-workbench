// PaiMini 派单页安全结算选择器。
// 当前阶段只负责选择“是否使用预存 / 使用多少”与展示权益，不改核心保存按钮。
// 选择会暴露到 window.paiMiniSettlementSelection，下一阶段由原子保存 RPC 接管。

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
  return num(ctx()?.state?.calc?.total);
}

function selectedCustomer(){
  const c=ctx();const name=($('#customerName')?.value||'').trim();const shopId=c?.shop?.id;
  return (c?.state?.customers||[]).find(x=>x.shop_id===shopId&&String(x.name||'').trim()===name)||null;
}

function writeSelection(){
  const enabled=!!$('settlementUsePrepaid')?.checked;
  const requested=Math.max(0,num($('settlementPrepaidAmount')?.value));
  window.paiMiniSettlementSelection={
    customer_id:state.customer?.id||null,
    use_prepaid:enabled,
    prepaid_amount:enabled?Math.min(requested,state.balance):0,
    available_prepaid:state.balance,
    benefits:state.benefits.map(x=>({id:x.id,name:x.name,quantity:num(x.quantity),unit_label:x.unit_label||'个'}))
  };
  renderEstimate();
}

function ensureStyle(){
  if($('orderSettlementSafeStyle'))return;
  const s=document.createElement('style');s.id='orderSettlementSafeStyle';s.textContent=`
  .settlement-safe-card{margin-top:14px}.settlement-safe-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap}.settlement-safe-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:11px 0}.settlement-safe-stat{border:1px solid var(--line);border-radius:14px;padding:10px;background:var(--paper)}.settlement-safe-stat span{display:block;color:var(--muted);font-size:11px}.settlement-safe-stat b{display:block;margin-top:4px;font-size:17px}.settlement-safe-controls{display:grid;grid-template-columns:1fr 1fr;gap:9px}.settlement-safe-benefits{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}.settlement-safe-benefit{border:1px solid var(--line);border-radius:999px;padding:6px 9px;font-size:11px}.settlement-safe-note{font-size:11px;color:var(--muted);margin-top:9px;line-height:1.5}
  @media(max-width:620px){.settlement-safe-summary{grid-template-columns:1fr}.settlement-safe-controls{grid-template-columns:1fr}}
  `;document.head.appendChild(s);
}

function mount(){
  const page=$('page-calculator');if(!page)return false;
  if($('orderSettlementSafeCard'))return true;
  const card=document.createElement('div');card.id='orderSettlementSafeCard';card.className='card settlement-safe-card';
  card.innerHTML=`
    <div class="settlement-safe-head"><div><b>⑤ 本单结算</b><small style="display:block;color:var(--muted);margin-top:3px">选择老板后可查看预存余额与权益</small></div><button id="settlementRefresh" class="tiny-btn" type="button">刷新</button></div>
    <div id="settlementEmpty" class="empty-state">先从已有老板档案中选择老板，才可以使用预存。</div>
    <div id="settlementBody" class="hidden">
      <div class="settlement-safe-summary"><div class="settlement-safe-stat"><span>本单金额</span><b id="settlementOrderTotal">¥0.00</b></div><div class="settlement-safe-stat"><span>当前预存</span><b id="settlementBalance">¥0.00</b></div><div class="settlement-safe-stat"><span>预计余额</span><b id="settlementAfter">¥0.00</b></div></div>
      <div class="settlement-safe-controls">
        <label class="check-label"><input id="settlementUsePrepaid" type="checkbox"> 使用预存余额</label>
        <label>本单扣预存金额<input id="settlementPrepaidAmount" type="number" min="0" step="0.01" placeholder="0.00" disabled></label>
      </div>
      <div id="settlementBenefits" class="settlement-safe-benefits"></div>
      <p class="settlement-safe-note">这一版先把“选择预存”接回派单页。当前普通保存按钮暂时不会真的扣款，等原子保存接口接好后再开启，避免出现订单存了但余额没扣的半单。</p>
    </div>`;
  const action=page.querySelector('.action-row');
  page.insertBefore(card,action||null);
  bind();return true;
}

function renderEstimate(){
  const total=orderTotal();const use=!!$('settlementUsePrepaid')?.checked;const requested=use?Math.max(0,num($('settlementPrepaidAmount')?.value)):0;const deduct=Math.min(requested,state.balance);
  if($('settlementOrderTotal'))$('settlementOrderTotal').textContent=money(total);
  if($('settlementBalance'))$('settlementBalance').textContent=money(state.balance);
  if($('settlementAfter'))$('settlementAfter').textContent=money(state.balance-deduct);
}

function render(){
  const empty=$('settlementEmpty'),body=$('settlementBody');if(!empty||!body)return;
  if(!state.customer){empty.classList.remove('hidden');body.classList.add('hidden');window.paiMiniSettlementSelection={customer_id:null,use_prepaid:false,prepaid_amount:0,available_prepaid:0,benefits:[]};return}
  empty.classList.add('hidden');body.classList.remove('hidden');
  const total=orderTotal();$('settlementOrderTotal').textContent=money(total);$('settlementBalance').textContent=money(state.balance);$('settlementAfter').textContent=money(state.balance);
  const b=$('settlementBenefits');b.innerHTML=state.benefits.length?state.benefits.map(x=>`<span class="settlement-safe-benefit">${safe(x.name)} · ${safe(x.quantity)} ${safe(x.unit_label||'个')}</span>`).join(''):'<span class="settlement-safe-benefit">暂无可用权益</span>';
  if($('settlementUsePrepaid')?.checked&&num($('settlementPrepaidAmount')?.value)===0)$('settlementPrepaidAmount').value=Math.min(total,state.balance).toFixed(2);
  writeSelection();
}

async function refresh(){
  const seq=++loadSeq;const c=selectedCustomer();state.customer=c;state.benefits=[];state.balance=num(c?.prepaid_balance);render();if(!c)return;
  const s=supabase();if(!s)return;
  try{
    const [fresh,benefits]=await Promise.all([
      Promise.race([s.from('customers').select('id,prepaid_balance').eq('id',c.id).maybeSingle(),timeout('customer balance')]),
      query(s.from('customer_benefits').select('id,name,quantity,unit_label,expires_at').eq('customer_id',c.id).gt('quantity',0).order('updated_at',{ascending:false}),'customer benefits')
    ]);
    if(seq!==loadSeq)return;
    if(fresh?.error)throw fresh.error;
    state.balance=num(fresh?.data?.prepaid_balance);state.benefits=(benefits||[]).filter(x=>!x.expires_at||new Date(x.expires_at).getTime()>Date.now());render();
  }catch(e){console.warn('settlement refresh failed',e);toast('预存余额读取失败，请点刷新重试')}
}

function bind(){
  $('settlementRefresh')?.addEventListener('click',refresh);
  $('settlementUsePrepaid')?.addEventListener('change',()=>{const on=$('settlementUsePrepaid').checked;$('settlementPrepaidAmount').disabled=!on;if(on&&num($('settlementPrepaidAmount').value)===0)$('settlementPrepaidAmount').value=Math.min(orderTotal(),state.balance).toFixed(2);writeSelection()});
  $('settlementPrepaidAmount')?.addEventListener('input',writeSelection);
  $('customerName')?.addEventListener('input',()=>{clearTimeout(bind.customerTimer);bind.customerTimer=setTimeout(refresh,220)});
  ['durationInput','calcUnitPrice','customerDiscount'].forEach(id=>$(id)?.addEventListener('input',()=>setTimeout(renderEstimate,30)));
  $('addOrderLineBtn')?.addEventListener('click',()=>setTimeout(renderEstimate,80));
}

export async function initOrderSettlementSafe(){
  if(started)return;started=true;ensureStyle();if(!mount()){started=false;throw new Error('calculator not ready')}await refresh();
}
