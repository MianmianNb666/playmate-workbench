import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";

const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const $=id=>document.getElementById(id);
const state={session:null,customer:null,benefits:[],loading:false};

function safe(v){return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
function num(v){const n=Number(v||0);return Number.isFinite(n)?n:0}
function qty(v){const n=num(v);return Number.isInteger(n)?String(n):n.toFixed(2).replace(/0+$/,"").replace(/\.$/,"")}
function isReadonly(){return document.body.classList.contains("paimini-readonly")}
function bridge(){return window.paiMiniOrderBridge||null}
function ctx(){return bridge()?.getContext?.()||null}
function currentShop(){return ctx()?.shop||null}
function money(v){return (currentShop()?.currency_symbol||"¥")+num(v).toFixed(2)}
function toast(message,bad=false){
  if(bridge()?.toast){bridge().toast(message);return}
  const el=$("toast");if(!el)return;el.textContent=message;el.classList.add("show");if(bad)el.style.background="#fff0f2";
  clearTimeout(toast.t);toast.t=setTimeout(()=>{el.classList.remove("show");el.style.background=""},2400);
}
function stagedLines(){return window.paiMiniMultiOrder?.lines||[]}
function currentOrderTotal(){
  const multi=window.paiMiniMultiOrder;
  if(multi?.lines?.length)return num(multi.total);
  return num(($("calcTotal")?.textContent||"").replace(/[^0-9.-]/g,""));
}
function prepaidValue(){return Math.max(0,num($("orderPrepaidUse")?.value))}
function selectedBenefits(){
  return [...document.querySelectorAll("[data-order-benefit-use]")].map(input=>({
    benefit_id:input.dataset.orderBenefitUse,
    quantity:Math.max(0,num(input.value))
  })).filter(x=>x.quantity>0);
}
function hasUsage(){return prepaidValue()>0||selectedBenefits().length>0}

function injectStyle(){
  if($("orderWalletStyle"))return;
  const s=document.createElement("style");s.id="orderWalletStyle";s.textContent=`
    .order-wallet-card{margin-top:14px}.order-wallet-headline{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.order-wallet-pill{display:inline-flex;padding:5px 9px;border-radius:999px;background:var(--pink-soft);font-size:11px;color:var(--ink)}
    .order-wallet-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin:12px 0}.order-wallet-stat{border:1px solid var(--line);border-radius:14px;padding:10px 12px;background:var(--paper)}.order-wallet-stat span{display:block;color:var(--muted);font-size:10px}.order-wallet-stat b{display:block;margin-top:4px;font-size:17px}
    .order-wallet-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.order-wallet-box{border:1px solid var(--line);border-radius:16px;padding:13px}.order-wallet-box h3{font-size:14px;margin:0 0 5px}.order-wallet-box p{margin:0 0 10px;color:var(--muted);font-size:10px;line-height:1.55}
    .order-wallet-row{display:flex;gap:8px;align-items:end;flex-wrap:wrap}.order-wallet-row label{flex:1 1 180px}.order-wallet-benefits{display:grid;gap:8px}.order-wallet-benefit{display:grid;grid-template-columns:minmax(0,1fr) 110px;gap:10px;align-items:center;border:1px solid var(--line);border-radius:13px;padding:10px}.order-wallet-benefit small{display:block;color:var(--muted);margin-top:3px}.order-wallet-benefit input{width:100%}.order-wallet-empty{padding:14px;text-align:center;color:var(--muted);font-size:11px}
    @media(max-width:780px){.order-wallet-grid{grid-template-columns:1fr}.order-wallet-summary{grid-template-columns:1fr 1fr}}
    @media(max-width:520px){.order-wallet-benefit{grid-template-columns:1fr}.order-wallet-summary{grid-template-columns:1fr 1fr}.order-wallet-row .btn{flex:1}}
  `;document.head.appendChild(s);
}

function injectCard(){
  const page=$("page-calculator");if(!page||$("orderWalletCard"))return false;
  const card=document.createElement("div");card.id="orderWalletCard";card.className="card order-wallet-card";
  card.innerHTML=`
    <div class="card-title"><div><b>⑤ 预存 / 权益</b><small>已有老板可在保存订单时直接扣预存、使用权益</small></div><div id="orderWalletBossTag" class="order-wallet-pill">未选择老板</div></div>
    <div id="orderWalletSummary" class="order-wallet-summary"></div>
    <div class="order-wallet-grid">
      <div class="order-wallet-box">
        <h3>预存抵扣</h3>
        <p>预存抵扣不会减少“累计消费”，只会减少这次还需要另外支付的金额。</p>
        <div class="order-wallet-row">
          <label>本次使用预存<input id="orderPrepaidUse" type="number" min="0" step="0.01" value="0"></label>
          <button id="orderPrepaidMaxBtn" class="btn soft" type="button">可用最大</button>
          <button id="orderPrepaidClearBtn" class="btn ghost" type="button">清零</button>
        </div>
      </div>
      <div class="order-wallet-box">
        <h3>使用权益</h3>
        <p>权益属于通用库存，这里只扣数量并记录使用情况，不会自动改变订单价格。</p>
        <div id="orderBenefitList" class="order-wallet-benefits"></div>
      </div>
    </div>`;
  const actions=page.querySelector(".action-row");
  if(actions)actions.insertAdjacentElement("beforebegin",card);else page.appendChild(card);
  bindCard();render();return true;
}

function availableBenefits(){
  const now=Date.now();
  return state.benefits.filter(b=>num(b.quantity)>0 && (!b.expires_at || new Date(b.expires_at).getTime()>=now));
}

function render(){
  const chosen=new Map(selectedBenefits().map(x=>[x.benefit_id,x.quantity]));
  const total=currentOrderTotal();
  const c=state.customer;
  const balance=num(c?.prepaid_balance);
  const prepaid=Math.min(prepaidValue(),balance,total);
  const due=Math.max(0,total-prepaid);
  const tag=$("orderWalletBossTag");if(tag)tag.textContent=c?`${c.name} · 已建档`:"未匹配到老板档案";
  const summary=$("orderWalletSummary");if(summary)summary.innerHTML=`
    <div class="order-wallet-stat"><span>本单消费</span><b>${money(total)}</b></div>
    <div class="order-wallet-stat"><span>预存余额</span><b>${money(balance)}</b></div>
    <div class="order-wallet-stat"><span>预存抵扣</span><b>${money(prepaid)}</b></div>
    <div class="order-wallet-stat"><span>本次另付</span><b>${money(due)}</b></div>`;

  const input=$("orderPrepaidUse");
  if(input){
    input.max=String(Math.max(0,Math.min(balance,total)));
    input.disabled=!c||isReadonly();
    if(num(input.value)>Math.min(balance,total))input.value=String(Math.max(0,Math.min(balance,total)));
  }
  ["orderPrepaidMaxBtn","orderPrepaidClearBtn"].forEach(id=>{const el=$(id);if(el)el.disabled=!c||isReadonly()});

  const list=$("orderBenefitList");if(!list)return;
  const rows=availableBenefits();
  if(!c){list.innerHTML='<div class="order-wallet-empty">先选择一个已经建立档案的老板。</div>';return}
  list.innerHTML=rows.length?rows.map(b=>{
    const value=Math.min(num(chosen.get(b.id)),num(b.quantity));
    return `<div class="order-wallet-benefit">
      <div><b>${safe(b.name)}</b><small>剩余 ${qty(b.quantity)} ${safe(b.unit_label||"个")}${b.expires_at?` · 有效至 ${safe(new Date(b.expires_at).toLocaleDateString("zh-CN"))}`:""}</small></div>
      <label>本次使用<input data-order-benefit-use="${safe(b.id)}" type="number" min="0" max="${safe(b.quantity)}" step="0.01" value="${safe(value)}" ${isReadonly()?"disabled":""}></label>
    </div>`;
  }).join(""):'<div class="order-wallet-empty">这个老板当前没有可用权益。</div>';
}

async function refreshCustomer(){
  if(state.loading)return;
  const cctx=ctx();if(!cctx?.state?.shopId)return;
  const name=($("customerName")?.value||"").trim();
  state.customer=null;state.benefits=[];
  if(!name){render();return}
  state.loading=true;
  try{
    const customer=(cctx.state.customers||[]).find(c=>c.shop_id===cctx.state.shopId && String(c.name||"")===name)||null;
    if(!customer){render();return}
    const [fresh,benefits]=await Promise.all([
      supabase.from("customers").select("*").eq("id",customer.id).maybeSingle(),
      supabase.from("customer_benefits").select("*").eq("customer_id",customer.id).order("updated_at",{ascending:false})
    ]);
    if(fresh.error)throw fresh.error;if(benefits.error)throw benefits.error;
    state.customer=fresh.data||customer;state.benefits=benefits.data||[];
  }catch(error){console.warn("order wallet load failed",error)}finally{state.loading=false;render()}
}

function parseMeasure(raw,unitMinutes){
  const text=String(raw||"").trim();
  if(!text)return 1;
  let n=Number(text);if(Number.isFinite(n))return n;
  const h=text.match(/([0-9.]+)\s*(?:h|小时)/i);if(h&&unitMinutes)return Number(h[1])*60/unitMinutes;
  const m=text.match(/([0-9.]+)\s*(?:m|分)/i);if(m&&unitMinutes)return Number(m[1])/unitMinutes;
  return 1;
}

function dateParts(){const d=new Date();return {date:d.toLocaleDateString("zh-CN"),time:d.toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})}}
function discountLabel(rate){const n=num(rate);return n>=100?"10折":`${qty(n/10)}折`}
function buildReport(record,history,next,cctx){
  const p=dateParts();
  const vars={
    "{老板}":record.customer_name_snapshot||"",
    "{项目}":record.item_name_snapshot||"",
    "{陪陪}":record.companion_name||"",
    "{单价}":qty(record.unit_price_snapshot),
    "{单位}":record.unit_label_snapshot||"次",
    "{时长}":record.duration_input||qty(record.quantity),
    "{数量}":qty(record.quantity),
    "{原价}":qty(record.original_amount??record.amount),
    "{折扣}":discountLabel(record.discount_rate_snapshot??100),
    "{总价}":qty(record.amount),
    "{历史累计}":qty(history),
    "{累计消费}":qty(next),
    "{备注}":record.note||"",
    "{日期}":p.date,
    "{时间}":p.time
  };
  let text=cctx.state?.template?.template_text||"消费项目：{项目}\n陪陪：{陪陪}\n单价：{单价}/{单位}\n时长/数量：{时长}\n总价：{总价}\n累计消费：{累计消费}";
  Object.entries(vars).forEach(([k,v])=>{text=text.split(k).join(String(v))});
  return text;
}

function recordsForSave(mode,cctx){
  const customerName=cctx.customerName;
  const note=cctx.note||"";
  const staged=stagedLines();
  const history=num(cctx.state?.historyTotal);
  let running=history;
  if(mode==="multi"){
    return staged.map(x=>{
      const original=x.discountRate>0?num(x.total)/(num(x.discountRate)/100):num(x.total);
      const record={
        item_id:null,customer_name_snapshot:customerName,item_name:x.item,item_name_snapshot:x.item,
        companion_name:x.companion,unit_price_snapshot:num(x.price),unit_label:x.unit||"次",unit_label_snapshot:x.unit||"次",
        unit_minutes_snapshot:x.unitMinutes||null,quantity:num(x.quantity)||1,duration_input:x.measure||"",amount:num(x.total),
        original_amount:original,discount_rate_snapshot:num(x.discountRate)||100,note
      };
      const next=running+record.amount;record.report_text=buildReport(record,running,next,cctx);running=next;return record;
    });
  }

  const calc=cctx.state?.calc;
  const item=cctx.state?.selectedItem;
  const itemName=($("calcItemName")?.value||"").trim();
  const unit=($("calcUnitLabel")?.value||"").trim()||"次";
  const unitMinutes=num($("calcUnitMinutes")?.value)||null;
  const amount=num(($("calcTotal")?.textContent||"").replace(/[^0-9.-]/g,""));
  const discount=num(cctx.discountRate)||100;
  const record={
    item_id:item?.id||null,customer_name_snapshot:customerName,item_name:itemName,item_name_snapshot:itemName,
    companion_name:($("companionName")?.value||"").trim(),unit_price_snapshot:num($("calcUnitPrice")?.value),
    unit_label:unit,unit_label_snapshot:unit,unit_minutes_snapshot:unitMinutes,
    quantity:calc?.quantity??parseMeasure($("durationInput")?.value,unitMinutes),duration_input:($("durationInput")?.value||"").trim(),
    amount,original_amount:calc?.originalTotal??(discount>0?amount/(discount/100):amount),discount_rate_snapshot:discount,note
  };
  record.report_text=buildReport(record,history,history+amount,cctx);
  return [record];
}

function friendly(message){
  const m=String(message||"");
  if(m.includes("prepaid_exceeds_order_total"))return "预存抵扣不能超过本单金额";
  if(m.includes("insufficient_prepaid_balance"))return "预存余额不足";
  if(m.includes("insufficient_benefit_quantity"))return "权益数量不足";
  if(m.includes("benefit_expired"))return "选择的权益已经过期";
  if(m.includes("account_read_only_expired"))return "账号已到期，当前为只读模式";
  if(m.includes("save_order_with_wallet")||m.includes("function")&&m.includes("does not exist"))return "派单联动数据库还没有升级，请先运行最新 SQL";
  return m;
}

async function saveWithWallet(mode,button){
  if(isReadonly()){toast("账号已到期，当前为只读模式",true);return}
  const cctx=ctx();if(!cctx?.state?.shopId){toast("先选择店铺",true);return}
  if(!cctx.customerName){toast("先填写老板 / 顾客",true);return}
  if(!state.customer || state.customer.name!==cctx.customerName){toast("预存 / 权益只能用于已经建立档案的老板",true);return}
  if(mode==="multi"&&!stagedLines().length){toast("先添加至少一个项目",true);return}
  const records=recordsForSave(mode,cctx);
  if(!records.length){toast(mode==="multi"?"先添加至少一个项目":"先把本单信息填写完整",true);return}
  if(records.some(r=>!r.item_name_snapshot||!r.companion_name||!(r.amount>=0))){toast("项目、陪陪或金额还没有填写完整",true);return}

  const prepaid=Math.min(prepaidValue(),num(state.customer.prepaid_balance),records.reduce((s,r)=>s+num(r.amount),0));
  const benefits=selectedBenefits();
  for(const use of benefits){
    const stock=state.benefits.find(b=>b.id===use.benefit_id);
    if(!stock||use.quantity>num(stock.quantity)){toast("权益使用数量超过当前库存",true);return}
  }

  const old=button?.textContent;if(button){button.disabled=true;button.textContent="保存并扣款中…"}
  try{
    const {data,error}=await supabase.rpc("save_order_with_wallet",{
      p_shop_id:cctx.state.shopId,p_customer_id:state.customer.id,p_records:records,p_prepaid_used:prepaid,p_benefits_used:benefits
    });
    if(error)throw error;
    if(mode==="multi")window.paiMiniMultiOrder?.clear?.();
    if($("orderPrepaidUse"))$("orderPrepaidUse").value="0";
    await bridge()?.refreshAfterSave?.();
    await refreshCustomer();
    toast(`整单已保存 ♡${num(data?.prepaid_used)>0?` · 预存抵扣 ${money(data.prepaid_used)}`:""}`);
  }catch(error){console.error("save order with wallet failed",error);const detail=friendly(error?.message||error);toast("保存失败："+detail,true);window.alert("这单没有保存成功。\n\n原因："+detail)}
  finally{if(button){button.disabled=false;button.textContent=old||"保存"}}
}

function bindCard(){
  $("orderPrepaidUse")?.addEventListener("input",render);
  $("orderPrepaidMaxBtn")?.addEventListener("click",()=>{if(!state.customer)return;const el=$("orderPrepaidUse");el.value=String(Math.min(num(state.customer.prepaid_balance),currentOrderTotal()));render()});
  $("orderPrepaidClearBtn")?.addEventListener("click",()=>{const el=$("orderPrepaidUse");el.value="0";render()});
}

// 只有实际选择了“用预存 / 用权益”时才接管保存；普通保存继续走原来的稳定逻辑。
document.addEventListener("click",event=>{
  const button=event.target.closest?.("#saveRecordBtn,#saveWholeOrderBtn");
  if(!button||!hasUsage())return;
  event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
  if(button.id==="saveRecordBtn"&&stagedLines().length){
    toast("已经添加了整单项目，请点「保存整单」使用预存 / 权益",true);
    return;
  }
  saveWithWallet(button.id==="saveWholeOrderBtn"?"multi":"single",button);
},true);

function bindGlobal(){
  $("customerName")?.addEventListener("input",()=>{clearTimeout(bindGlobal.t);bindGlobal.t=setTimeout(refreshCustomer,220)});
  $("calcShop")?.addEventListener("change",()=>setTimeout(refreshCustomer,450));
  ["calcTotal","orderGrandTotal"].forEach(id=>{const el=$(id);if(el)new MutationObserver(render).observe(el,{childList:true,subtree:true,characterData:true})});
  $("orderLineList")&&new MutationObserver(render).observe($("orderLineList"),{childList:true,subtree:true});
  $("customerProfileList")?.addEventListener("click",e=>{if(e.target.closest("[data-use-customer]"))setTimeout(refreshCustomer,450)});
}

injectStyle();
if(!injectCard()){
  const observer=new MutationObserver(()=>{if(injectCard()){observer.disconnect();bindGlobal();refreshCustomer()}});
  observer.observe(document.documentElement,{childList:true,subtree:true});setTimeout(()=>observer.disconnect(),12000);
}else{bindGlobal();refreshCustomer()}

const {data}=await supabase.auth.getSession();state.session=data.session;
supabase.auth.onAuthStateChange((_event,session)=>{state.session=session;if(session)setTimeout(refreshCustomer,100)});

window.paiMiniOrderWallet={refresh:refreshCustomer,getUsage:()=>({customer:state.customer,prepaid:prepaidValue(),benefits:selectedBenefits()})};
