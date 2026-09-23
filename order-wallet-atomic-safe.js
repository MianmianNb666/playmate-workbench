// PaiMini 原子结算。仅在用户选择“使用预存余额 / 使用权益”时接管保存入口。
// 不创建第二 Supabase client，不使用全局捕获，不影响普通保存。

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
function orderTotal(){const lines=window.paiMiniMultiOrder?.lines;if(Array.isArray(lines)&&lines.length)return lines.reduce((s,x)=>s+num(x.total),0);const el=$('calcTotal');if(el)return num((el.textContent||'').replace(/[^0-9.-]/g,''));return num(ctx()?.state?.calc?.total)}
function selectedCustomer(){
  const c=ctx();
  const selectedId=window.paiMiniSettlementSelection?.customer_id||$('settlementCustomerSelect')?.value||null;
  if(selectedId){
    const byId=(c?.state?.customers||[]).find(x=>String(x.id)===String(selectedId));
    if(byId)return byId;
  }
  const name=($('#customerName')?.value||'').trim();
  const shopId=c?.state?.shopId||c?.shop?.id;
  return (c?.state?.customers||[]).find(x=>x.shop_id===shopId&&String(x.name||'').trim()===name)||null;
}
function discountRate(){return num(ctx()?.discountRate)||100}
function parseMeasure(raw,unitMinutes){const text=String(raw||'').trim();if(!text)return 1;const direct=Number(text);if(Number.isFinite(direct))return direct;const h=text.match(/([0-9.]+)\s*(?:h|小时)/i);if(h&&unitMinutes)return Number(h[1])*60/unitMinutes;const m=text.match(/([0-9.]+)\s*(?:m|分)/i);if(m&&unitMinutes)return Number(m[1])/unitMinutes;return 1}

function recordsForRpcWithCustomer(customer){
  const c=ctx();if(!c||!customer)return [];
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

function recordsForRpc(){return recordsForRpcWithCustomer(selectedCustomer())}

function currentPrepaid(){const sel=window.paiMiniSettlementSelection||{};if(!sel.use_prepaid)return 0;return Math.max(0,Math.min(num(sel.prepaid_amount),num(sel.available_prepaid),orderTotal()))}
function currentBenefits(){const rows=window.paiMiniSettlementSelection?.benefits_used;return Array.isArray(rows)?rows.map(x=>({benefit_id:x.benefit_id,quantity:Math.max(0,num(x.quantity))})).filter(x=>x.benefit_id&&x.quantity>0):[]}
function usesSettlement(){return currentPrepaid()>0||currentBenefits().length>0}
function syncButtons(){const use=usesSettlement();const coreSingle=$('saveRecordBtn');const coreMulti=$('saveWholeOrderBtn');if(coreSingle){coreSingle.disabled=saving;coreSingle.textContent=saving?'保存中…':'保存记录'}if(coreMulti)coreMulti.classList.add('hidden')}
function friendly(err){const m=String(err?.message||err||'');if(m.includes('prepaid_exceeds_order_total'))return '预存抵扣不能超过本单金额';if(m.includes('insufficient_prepaid_balance'))return '老板预存余额不足';if(m.includes('benefit_expired'))return '选择的权益已过期，请刷新后重试';if(m.includes('insufficient_benefit_quantity'))return '选择的权益数量不足，请刷新后重试';if(m.includes('benefit_not_found'))return '选择的权益已变化，请刷新后重试';if(m.includes('customer_not_found'))return '请先从老板档案中选择老板';if(m.includes('account_read_only_expired'))return '账号已到期，当前不能结算';if(m.includes('does not exist')||m.includes('save_order_with_wallet'))return '预存结算数据库还没升级';return m||'保存失败'}

async function saveAtomic(){
  if(saving)return;
  const c=ctx(),s=supabase();
  let customer=selectedCustomer();
  const selectedId=window.paiMiniSettlementSelection?.customer_id||$('settlementCustomerSelect')?.value||null;
  if(!customer&&s&&selectedId){
    const direct=await s.from('customers').select('*').eq('id',selectedId).maybeSingle();
    if(!direct?.error&&direct?.data)customer=direct.data;
  }
  if(!c?.shop?.id||!s||!customer){toast('先从老板档案中选择老板');return}
  const records=recordsForRpcWithCustomer(customer);const prepaid=currentPrepaid();const benefits=currentBenefits();if(!records.length||orderTotal()<=0){toast('先把本单项目算好');return}if(prepaid<=0&&!benefits.length){toast('先选择本单要使用的预存或权益');return}
  saving=true;syncButtons();const btn=$('settlementAtomicSave');const old=btn?.textContent;if(btn)btn.textContent='保存并结算中…';
  try{
    const res=await Promise.race([s.rpc('save_order_with_wallet',{p_shop_id:c.shop.id,p_customer_id:customer.id,p_records:records,p_prepaid_used:prepaid,p_benefits_used:benefits}),timeout('save_order_with_wallet')]);
    if(res?.error)throw res.error;
    const data=res?.data||{};
    if(data.prepaid_balance_after!=null){
      customer.prepaid_balance=num(data.prepaid_balance_after);
      window.dispatchEvent(new CustomEvent('paimini:prepaid-updated',{detail:{customerId:customer.id,balance:customer.prepaid_balance}}));
    }
    window.paiMiniMultiOrder?.clear?.();
    if($('#settlementUsePrepaid'))$('#settlementUsePrepaid').checked=false;
    if($('#settlementPrepaidAmount')){$('#settlementPrepaidAmount').value='';$('#settlementPrepaidAmount').disabled=true}
    window.paiMiniSettlementSelection={customer_id:customer.id,use_prepaid:false,prepaid_amount:0,available_prepaid:num(data.prepaid_balance_after),benefits:window.paiMiniSettlementSelection?.benefits||[],benefits_used:[]};
    await window.paiMiniOrderBridge?.refreshAfterSave?.();
    document.getElementById('settlementRefresh')?.click();
    const parts=[];if(prepaid>0)parts.push('预存 '+plain(prepaid));if(benefits.length)parts.push('权益 '+benefits.length+' 项');
    toast('已保存并结算'+(parts.length?'：'+parts.join(' · '):'')+' ♡');
  }catch(e){console.warn('atomic settlement save failed',e);const msg=friendly(e);toast('扣款失败：'+msg);window.alert('这单没有扣款成功。\n\n原因：'+msg)}finally{saving=false;if(btn)btn.textContent=old||'保存并结算';setTimeout(syncButtons,50)}
}

function mount(){
  const body=$('settlementBody');if(!body)return false;
  $('settlementAtomicSave')?.closest('.mini-actions')?.remove();
  $('settlementUsePrepaid')?.addEventListener('change',()=>setTimeout(syncButtons,0));
  $('settlementPrepaidAmount')?.addEventListener('input',()=>setTimeout(syncButtons,0));
  $('settlementBenefits')?.addEventListener('change',()=>setTimeout(syncButtons,0));
  $('settlementBenefits')?.addEventListener('input',()=>setTimeout(syncButtons,0));
  $('#customerName')?.addEventListener('input',()=>setTimeout(syncButtons,250));
  ['durationInput','calcUnitPrice','customerDiscount'].forEach(id=>$(id)?.addEventListener('input',()=>setTimeout(syncButtons,50)));
  $('#addOrderLineBtn')?.addEventListener('click',()=>setTimeout(syncButtons,100));
  window.addEventListener('paimini:settlement-changed',()=>setTimeout(syncButtons,0));
  window.addEventListener('paimini:prepaid-updated',()=>setTimeout(syncButtons,50));
  window.paiMiniAtomicSettlement={save:saveAtomic,usesSettlement};
  syncButtons();return true;
}

export async function initOrderWalletAtomicSafe(){
  if(started)return;started=true;
  if(!mount()){started=false;throw new Error('settlement ui not ready')}
}
