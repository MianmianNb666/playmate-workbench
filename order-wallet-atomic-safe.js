// PaiMini 原子预存结算。仅在用户勾选“使用预存余额”时接管保存入口。
// 不创建第二 Supabase client，不使用全局捕获，不影响未使用预存的普通保存。

let started=false;
let saving=false;
const $=id=>document.getElementById(id);
const TIMEOUT_MS=18000;

function ctx(){try{return window.paiMiniOrderBridge?.getContext?.()||null}catch{return null}}
function supabase(){return ctx()?.supabase||null}
function num(v){const n=Number(v||0);return Number.isFinite(n)?n:0}
function plain(v){const n=num(v);return Number.isInteger(n)?String(n):n.toFixed(2).replace(/0+$/,'').replace(/\.$/,'')}
function toast(message){window.paiMiniOrderBridge?.toast?.(message)}
function timeout(label){return new Promise((_,reject)=>setTimeout(()=>reject(new Error(label+' timeout')),TIMEOUT_MS))}
function orderTotal(){const lines=window.paiMiniMultiOrder?.lines;if(Array.isArray(lines)&&lines.length)return lines.reduce((s,x)=>s+num(x.total),0);return num(ctx()?.state?.calc?.total)||num(($('#calcTotal')?.textContent||'').replace(/[^0-9.-]/g,''))}
function selectedCustomer(){const c=ctx();const name=($('#customerName')?.value||'').trim();const shopId=c?.shop?.id;return (c?.state?.customers||[]).find(x=>x.shop_id===shopId&&String(x.name||'').trim()===name)||null}
function discountRate(){return num(ctx()?.discountRate)||100}
function parseMeasure(raw,unitMinutes){const text=String(raw||'').trim();if(!text)return 1;const direct=Number(text);if(Number.isFinite(direct))return direct;const h=text.match(/([0-9.]+)\s*(?:h|小时)/i);if(h&&unitMinutes)return Number(h[1])*60/unitMinutes;const m=text.match(/([0-9.]+)\s*(?:m|分)/i);if(m&&unitMinutes)return Number(m[1])/unitMinutes;return 1}

function recordsForRpc(){
  const c=ctx();const customer=selectedCustomer();if(!c||!customer)return [];
  const note=c.note||'';const staged=window.paiMiniMultiOrder?.lines||[];
  if(staged.length){
    return staged.map(x=>({
      item_id:null,
      customer_name_snapshot:customer.name,
      item_name:x.item||'',item_name_snapshot:x.item||'',
      companion_name:x.companion||'',
      unit_price_snapshot:num(x.price),
      unit_label:x.unit||'次',unit_label_snapshot:x.unit||'次',
      unit_minutes_snapshot:x.unitMinutes||null,
      quantity:num(x.quantity)||1,
      duration_input:x.measure||'',
      amount:num(x.total),
      original_amount:num(x.discountRate)>0?num(x.total)/(num(x.discountRate)/100):num(x.total),
      discount_rate_snapshot:num(x.discountRate)||100,
      note,
      report_text:''
    }));
  }
  const calc=c.state?.calc||{};const item=c.state?.selectedItem||{};const itemName=($('#calcItemName')?.value||'').trim()||item.name||'';const unit=($('#calcUnitLabel')?.value||'').trim()||item.unit_label||'次';const unitMinutes=num($('#calcUnitMinutes')?.value)||null;const amount=orderTotal();const discount=discountRate();
  return [{
    item_id:item?.id||null,
    customer_name_snapshot:customer.name,
    item_name:itemName,item_name_snapshot:itemName,
    companion_name:($('#companionName')?.value||'').trim(),
    unit_price_snapshot:num($('#calcUnitPrice')?.value)||num(calc.unitPrice),
    unit_label:unit,unit_label_snapshot:unit,
    unit_minutes_snapshot:unitMinutes,
    quantity:calc.quantity??parseMeasure($('#durationInput')?.value,unitMinutes),
    duration_input:($('#durationInput')?.value||'').trim(),
    amount,
    original_amount:num(calc.originalTotal)||(discount>0?amount/(discount/100):amount),
    discount_rate_snapshot:discount,
    note,
    report_text:''
  }];
}

function currentPrepaid(){const sel=window.paiMiniSettlementSelection||{};if(!sel.use_prepaid)return 0;return Math.max(0,Math.min(num(sel.prepaid_amount),num(sel.available_prepaid),orderTotal()))}
function syncButtons(){const use=!!window.paiMiniSettlementSelection?.use_prepaid;const atomic=$('settlementAtomicSave');if(atomic){atomic.disabled=!use||saving||!selectedCustomer()||orderTotal()<=0;atomic.classList.toggle('hidden',!use)}const coreSingle=$('saveRecordBtn'),coreMulti=$('saveWholeOrderBtn');if(coreSingle)coreSingle.disabled=use||saving;if(coreMulti)coreMulti.disabled=use||saving}
function friendly(err){const m=String(err?.message||err||'');if(m.includes('prepaid_exceeds_order_total'))return '预存抵扣不能超过本单金额';if(m.includes('insufficient_prepaid_balance'))return '老板预存余额不足';if(m.includes('customer_not_found'))return '请先从老板档案中选择老板';if(m.includes('account_read_only_expired'))return '账号已到期，当前不能扣预存';if(m.includes('does not exist')||m.includes('save_order_with_wallet'))return '预存结算数据库还没升级';return m||'保存失败'}

async function saveAtomic(){
  if(saving)return;const c=ctx(),s=supabase(),customer=selectedCustomer();if(!c?.shop?.id||!s||!customer){toast('先从老板档案中选择老板');return}
  const records=recordsForRpc();const prepaid=currentPrepaid();if(!records.length||orderTotal()<=0){toast('先把本单项目算好');return}if(prepaid<=0){toast('先填写本单要扣的预存金额');return}
  saving=true;syncButtons();const btn=$('settlementAtomicSave');const old=btn?.textContent;if(btn)btn.textContent='保存并扣款中…';
  try{
    const res=await Promise.race([s.rpc('save_order_with_wallet',{p_shop_id:c.shop.id,p_customer_id:customer.id,p_records:records,p_prepaid_used:prepaid,p_benefits_used:[]}),timeout('save_order_with_wallet')]);
    if(res?.error)throw res.error;
    const data=res?.data||{};
    if(data.prepaid_balance_after!=null){
      customer.prepaid_balance=num(data.prepaid_balance_after);
      window.dispatchEvent(new CustomEvent('paimini:prepaid-updated',{detail:{customerId:customer.id,balance:customer.prepaid_balance}}));
    }
    window.paiMiniMultiOrder?.clear?.();
    if($('#settlementUsePrepaid'))$('#settlementUsePrepaid').checked=false;
    if($('#settlementPrepaidAmount')){$('#settlementPrepaidAmount').value='';$('#settlementPrepaidAmount').disabled=true}
    window.paiMiniSettlementSelection={customer_id:customer.id,use_prepaid:false,prepaid_amount:0,available_prepaid:num(data.prepaid_balance_after),benefits:window.paiMiniSettlementSelection?.benefits||[]};
    await window.paiMiniOrderBridge?.refreshAfterSave?.();
    document.getElementById('settlementRefresh')?.click();
    toast(`已保存并扣预存 ${plain(prepaid)} ♡`);
  }catch(e){console.warn('atomic prepaid save failed',e);toast('保存失败：'+friendly(e))}finally{saving=false;if(btn)btn.textContent=old||'保存并扣预存';setTimeout(syncButtons,50)}
}

function mount(){
  const body=$('settlementBody');if(!body)return false;
  if(!$('settlementAtomicSave')){
    const row=document.createElement('div');row.className='mini-actions';row.style.marginTop='10px';row.innerHTML='<button id="settlementAtomicSave" class="btn primary hidden" type="button">保存并扣预存</button><small style="align-self:center;color:var(--muted)">勾选预存后请用这个按钮保存，订单和扣款会一起完成。</small>';body.appendChild(row);
  }
  $('settlementAtomicSave')?.addEventListener('click',saveAtomic);
  $('settlementUsePrepaid')?.addEventListener('change',()=>setTimeout(syncButtons,0));
  $('settlementPrepaidAmount')?.addEventListener('input',()=>setTimeout(syncButtons,0));
  $('#customerName')?.addEventListener('input',()=>setTimeout(syncButtons,250));
  ['durationInput','calcUnitPrice','customerDiscount'].forEach(id=>$(id)?.addEventListener('input',()=>setTimeout(syncButtons,50)));
  $('#addOrderLineBtn')?.addEventListener('click',()=>setTimeout(syncButtons,100));
  syncButtons();return true;
}

export async function initOrderWalletAtomicSafe(){
  if(started)return;started=true;
  if(!mount()){started=false;throw new Error('settlement ui not ready')}
}
