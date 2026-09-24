import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";

const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const $=id=>document.getElementById(id);
const state={session:null,customers:[],shops:[],customerId:null,prepaid:[],benefits:[],benefitLedger:[]};

function safe(v){return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
function isReadonly(){return document.body.classList.contains("paimini-readonly")}
function toast(message,bad=false){
  if(window.paiMiniOrderBridge?.toast){window.paiMiniOrderBridge.toast(message);return}
  const el=$("toast");if(!el)return;el.textContent=message;el.classList.add("show");if(bad)el.style.background="#fff0f2";
  clearTimeout(toast.t);toast.t=setTimeout(()=>{el.classList.remove("show");el.style.background=""},2400);
}
function money(v,customer=currentCustomer()){
  const shop=state.shops.find(s=>s.id===customer?.shop_id);
  return (shop?.currency_symbol||"¥")+Number(v||0).toFixed(2);
}
function qty(v){const n=Number(v||0);return Number.isInteger(n)?String(n):n.toFixed(2).replace(/0+$/,"").replace(/\.$/,"")}
function dateText(v){if(!v)return "—";const d=new Date(v);if(Number.isNaN(d.getTime()))return "—";return d.toLocaleString("zh-CN",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"})}
function currentCustomer(){return state.customers.find(c=>c.id===state.customerId)||null}

function injectStyle(){
  if($("bossWalletStyle"))return;
  const s=document.createElement("style");s.id="bossWalletStyle";s.textContent=`
    .boss-wallet-card{margin-top:16px}.boss-wallet-toolbar{display:flex;gap:9px;align-items:end;flex-wrap:wrap}.boss-wallet-toolbar label{flex:1 1 240px}
    .boss-wallet-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:14px 0}.boss-wallet-stat{border:1px solid var(--line);border-radius:15px;padding:12px;background:var(--paper)}.boss-wallet-stat span{display:block;color:var(--muted);font-size:11px}.boss-wallet-stat b{display:block;margin-top:5px;font-size:18px}
    .boss-wallet-columns{display:grid;grid-template-columns:1fr 1fr;gap:12px}.boss-wallet-box{border:1px solid var(--line);border-radius:16px;padding:14px}.boss-wallet-box h3{margin:0 0 4px;font-size:15px}.boss-wallet-note{color:var(--muted);font-size:11px;line-height:1.55;margin:0 0 11px}
    .boss-wallet-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.boss-wallet-form .wide{grid-column:1/-1}.boss-wallet-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px}
    .boss-benefit-grid{display:grid;gap:8px;margin-top:10px}.boss-benefit-item{border:1px solid var(--line);border-radius:13px;padding:10px 11px;display:flex;justify-content:space-between;gap:10px;align-items:center}.boss-benefit-item small{display:block;color:var(--muted);margin-top:3px}.boss-benefit-qty{font-weight:900;white-space:nowrap}
    .boss-ledger-list{display:grid;gap:7px;margin-top:10px;max-height:420px;overflow:auto}.boss-ledger-row{border:1px solid var(--line);border-radius:13px;padding:10px 11px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:9px;align-items:center}.boss-ledger-row p{margin:3px 0 0;color:var(--muted);font-size:10px;line-height:1.5}.boss-ledger-row strong{white-space:nowrap}.boss-ledger-positive{color:#4f936d}.boss-ledger-negative{color:#c65f76}.boss-wallet-empty{padding:18px;text-align:center;color:var(--muted);font-size:11px}
    @media(max-width:850px){.boss-wallet-summary{grid-template-columns:1fr 1fr}.boss-wallet-columns{grid-template-columns:1fr}}
    @media(max-width:560px){.boss-wallet-form{grid-template-columns:1fr}.boss-wallet-form .wide{grid-column:auto}.boss-wallet-summary{grid-template-columns:1fr 1fr}.boss-ledger-row{grid-template-columns:1fr}.boss-wallet-actions .btn{flex:1}}
  `;document.head.appendChild(s);
}

function injectCard(){
  const page=$("page-customers");if(!page||$("bossWalletCard"))return false;
  const card=document.createElement("div");card.id="bossWalletCard";card.className="card boss-wallet-card";
  card.innerHTML=`
    <div class="card-title"><div><b>老板余额与权益 ♡</b><small>所有余额和权益变动都会自动留流水，不会静默改账</small><div class="active-shop-chip">当前店铺：<b data-active-shop-name>未选择店铺</b></div></div></div>
    <div class="boss-wallet-toolbar">
      <label>选择老板<select id="bossWalletCustomer"></select></label>
      <button id="bossWalletRefreshBtn" class="btn ghost" type="button">刷新</button>
      <button id="bossWalletExportBtn" class="btn soft" type="button">导出 CSV</button>
    </div>
    <div id="bossWalletSummary" class="boss-wallet-summary"></div>
    <div class="boss-wallet-columns">
      <div class="boss-wallet-box">
        <h3>预存余额</h3><p class="boss-wallet-note">手动增减都会自动留流水，备注可以不填；充错的充值可以从流水里直接撤销。</p>
        <div class="boss-wallet-form">
          <label>调整金额<input id="bossPrepaidAmount" type="number" min="0" step="0.01" placeholder="例如 100"></label>
          <label>操作<select id="bossPrepaidDirection"><option value="add">增加余额</option><option value="subtract">扣减余额</option></select></label>
          <label class="wide">备注（选填）<input id="bossPrepaidNote" maxlength="160" placeholder="例如 手动补录 / 更正金额"></label>
        </div>
        <div class="boss-wallet-actions"><button id="bossPrepaidAdjustBtn" class="btn primary" type="button">确认调整</button></div>
        <div id="bossPrepaidLedger" class="boss-ledger-list"></div>
      </div>
      <div class="boss-wallet-box">
        <h3>权益包</h3><p class="boss-wallet-note">这里可以手动补发或扣减权益；预存套餐附赠的权益也会自动显示。</p>
        <div id="bossBenefitCurrent" class="boss-benefit-grid"></div>
        <div class="boss-wallet-form" style="margin-top:12px">
          <label>权益名称<input id="bossBenefitName" placeholder="冠 / 折扣券 / 赠送时长"></label>
          <label>数量<input id="bossBenefitAmount" type="number" min="0" step="0.01" value="1"></label>
          <label>单位<input id="bossBenefitUnit" placeholder="个 / 次 / 张 / 分钟" value="个"></label>
          <label>操作<select id="bossBenefitDirection"><option value="add">增加权益</option><option value="subtract">扣减权益</option></select></label>
          <label>有效期<input id="bossBenefitExpiry" type="date"></label>
          <label>备注（选填）<input id="bossBenefitNote" maxlength="160" placeholder="例如 补送 / 更正"></label>
        </div>
        <div class="boss-wallet-actions"><button id="bossBenefitAdjustBtn" class="btn primary" type="button">确认权益调整</button></div>
        <div id="bossBenefitLedger" class="boss-ledger-list"></div>
      </div>
    </div>`;
  const grid=page.querySelector(".customer-page-grid");
  if(grid)grid.insertAdjacentElement("afterend",card);else page.appendChild(card);
  bindCard();return true;
}

function injectProfileButtons(){
  const list=$("customerProfileList");if(!list)return;
  list.querySelectorAll("[data-use-customer]").forEach(use=>{
    const id=use.dataset.useCustomer,actions=use.closest(".row-actions");
    if(!id||!actions||actions.querySelector(`[data-wallet-customer="${CSS.escape(id)}"]`))return;
    const b=document.createElement("button");b.className="tiny-btn";b.type="button";b.dataset.walletCustomer=id;b.textContent="余额 / 权益";
    actions.insertBefore(b,actions.children[1]||null);
  });
}

function renderSelector(){
  const sel=$("bossWalletCustomer");if(!sel)return;
  const old=state.customerId||sel.value;
  sel.innerHTML=state.customers.length?state.customers.map(c=>{
    const shop=state.shops.find(s=>s.id===c.shop_id);
    return `<option value="${safe(c.id)}">${safe(c.name)} · ${safe(shop?.name||"店铺")}</option>`;
  }).join(""):`<option value="">还没有老板档案</option>`;
  if(old&&state.customers.some(c=>c.id===old))sel.value=old;
  state.customerId=sel.value||null;
}

function prepaidKindText(kind){return ({topup:"充值",consume:"消费扣款",refund:"退款 / 撤销",adjust:"手动调整"})[kind]||kind||"变动"}
function benefitKindText(kind){return ({grant:"发放",consume:"使用",return:"退回 / 撤销",adjust:"手动调整"})[kind]||kind||"变动"}

function render(){
  const c=currentCustomer();
  const summary=$("bossWalletSummary"),pre=$("bossPrepaidLedger"),benefits=$("bossBenefitCurrent"),bl=$("bossBenefitLedger");
  if(!summary||!pre||!benefits||!bl)return;
  if(!c){
    summary.innerHTML='<div class="boss-wallet-empty">先建立一个老板档案。</div>';pre.innerHTML="";benefits.innerHTML="";bl.innerHTML="";return;
  }

  const topup=state.prepaid.filter(x=>Number(x.delta)>0).reduce((s,x)=>s+Number(x.delta||0),0);
  const deduct=Math.abs(state.prepaid.filter(x=>Number(x.delta)<0).reduce((s,x)=>s+Number(x.delta||0),0));
  const activeBenefits=state.benefits.filter(x=>Number(x.quantity||0)>0);
  summary.innerHTML=`
    <div class="boss-wallet-stat"><span>当前预存余额</span><b>${money(Number(c.prepaid_balance||0)+Number(c.gift_balance||0),c)}</b></div>
    <div class="boss-wallet-stat"><span>累计增加</span><b>${money(topup,c)}</b></div>
    <div class="boss-wallet-stat"><span>累计扣减 / 退款</span><b>${money(deduct,c)}</b></div>
    <div class="boss-wallet-stat"><span>当前权益</span><b>${activeBenefits.length} 种</b></div>`;

  const reversed=new Set(state.prepaid.map(x=>x.reversal_of_id).filter(Boolean));
  pre.innerHTML=state.prepaid.length?state.prepaid.map(row=>{
    const n=Number(row.delta||0),isPaid=String(row.balance_type||"paid")==="paid",canReverse=isPaid&&row.kind==="topup"&&n>0&&!reversed.has(row.id)&&(!row.preset_id||row.package_issue_id);
    const oldPackage=row.kind==="topup"&&row.preset_id&&!row.package_issue_id&&!reversed.has(row.id);
    return `<div class="boss-ledger-row"><div><b>${safe(prepaidKindText(row.kind))}</b><p>${safe(dateText(row.created_at))}${row.note?` · ${safe(row.note)}`:""}</p><p>${money(row.balance_before,c)} → ${money(row.balance_after,c)}${oldPackage?" · 旧版套餐记录需手动调整":""}</p></div><div><strong class="${n>=0?"boss-ledger-positive":"boss-ledger-negative"}">${n>=0?"+":""}${money(n,c)}</strong>${canReverse?`<div style="margin-top:6px"><button class="tiny-btn" data-reverse-topup="${safe(row.id)}" type="button" ${isReadonly()?"disabled":""}>撤回预存</button></div>`:""}</div></div>`;
  }).join(""):'<div class="boss-wallet-empty">还没有预存流水。</div>';

  benefits.innerHTML=activeBenefits.length?activeBenefits.map(b=>`<div class="boss-benefit-item"><div><b>${safe(b.name)}</b><small>${b.expires_at?`有效至 ${safe(dateText(b.expires_at))}`:"长期有效"}${b.note?` · ${safe(b.note)}`:""}</small></div><span class="boss-benefit-qty">${qty(b.quantity)} ${safe(b.unit_label||"个")}</span></div>`).join(""):'<div class="boss-wallet-empty">当前没有可用权益。</div>';

  bl.innerHTML=state.benefitLedger.length?state.benefitLedger.map(row=>{const n=Number(row.delta||0);return `<div class="boss-ledger-row"><div><b>${safe(row.benefit_name)} · ${safe(benefitKindText(row.kind))}</b><p>${safe(dateText(row.created_at))}${row.note?` · ${safe(row.note)}`:""}</p><p>${qty(row.quantity_before)} → ${qty(row.quantity_after)}</p></div><strong class="${n>=0?"boss-ledger-positive":"boss-ledger-negative"}">${n>=0?"+":""}${qty(n)}</strong></div>`}).join(""):'<div class="boss-wallet-empty">还没有权益流水。</div>';

  ["bossPrepaidAdjustBtn","bossBenefitAdjustBtn"].forEach(id=>{const el=$(id);if(el){el.disabled=isReadonly();el.title=isReadonly()?"账号已到期，当前为只读模式":""}});
}

async function loadBase(){
  if(!state.session)return;
  const activeShopId=window.paiMiniOrderBridge?.getContext?.()?.shop?.id||null;
  const customerQuery=activeShopId
    ? supabase.from("customers").select("*").eq("shop_id",activeShopId).order("name")
    : supabase.from("customers").select("*").order("name");
  const [customers,shops]=await Promise.all([
    customerQuery,
    supabase.from("shops").select("*").order("name")
  ]);
  if(customers.error){toast("老板档案读取失败："+customers.error.message,true);return}
  if(activeShopId && window.paiMiniOrderBridge?.getContext?.()?.shop?.id!==activeShopId)return void loadBase();
  state.customerId=null;
  state.customers=customers.data||[];if(!shops.error)state.shops=shops.data||[];
  renderSelector();await loadWallet();injectProfileButtons();
}

async function loadWallet(){
  const c=currentCustomer();
  if(!c){state.prepaid=[];state.benefits=[];state.benefitLedger=[];render();return}
  const [pre,benefits,ledger,fresh]=await Promise.all([
    supabase.from("customer_prepaid_ledger").select("*").eq("customer_id",c.id).order("created_at",{ascending:false}),
    supabase.from("customer_benefits").select("*").eq("customer_id",c.id).order("updated_at",{ascending:false}),
    supabase.from("customer_benefit_ledger").select("*").eq("customer_id",c.id).order("created_at",{ascending:false}),
    supabase.from("customers").select("*").eq("id",c.id).maybeSingle()
  ]);
  const err=pre.error||benefits.error||ledger.error||fresh.error;
  if(err){toast("余额 / 权益读取失败："+err.message,true);return}
  state.prepaid=pre.data||[];state.benefits=benefits.data||[];state.benefitLedger=ledger.data||[];
  if(fresh.data)state.customers=state.customers.map(x=>x.id===fresh.data.id?fresh.data:x);
  render();
}

async function adjustPrepaid(){
  if(isReadonly()){toast("账号已到期，当前为只读模式",true);return}
  const c=currentCustomer(),amount=Number($("bossPrepaidAmount")?.value||0),note=$("bossPrepaidNote")?.value.trim(),dir=$("bossPrepaidDirection")?.value;
  if(!c){toast("先选择老板",true);return}if(!(amount>0)){toast("调整金额要大于 0",true);return}
  const delta=dir==="subtract"?-amount:amount;
  const {error}=await supabase.rpc("adjust_customer_prepaid",{p_customer_id:c.id,p_delta:delta,p_kind:"adjust",p_note:note||null,p_related_record_id:null});
  if(error){toast("调整失败："+friendlyError(error.message),true);return}
  $("bossPrepaidAmount").value="";$("bossPrepaidNote").value="";toast("余额已调整并记录流水 ♡");await loadWallet();
}

async function adjustBenefit(){
  if(isReadonly()){toast("账号已到期，当前为只读模式",true);return}
  const c=currentCustomer(),name=$("bossBenefitName")?.value.trim(),amount=Number($("bossBenefitAmount")?.value||0),unit=$("bossBenefitUnit")?.value.trim()||"个",dir=$("bossBenefitDirection")?.value,note=$("bossBenefitNote")?.value.trim(),expiry=$("bossBenefitExpiry")?.value;
  if(!c){toast("先选择老板",true);return}if(!name){toast("先填写权益名称",true);return}if(!(amount>0)){toast("权益数量要大于 0",true);return}
  const delta=dir==="subtract"?-amount:amount;
  const expiresAt=expiry?new Date(expiry+"T23:59:59").toISOString():null;
  const {error}=await supabase.rpc("adjust_customer_benefit",{p_customer_id:c.id,p_name:name,p_delta:delta,p_kind:"adjust",p_unit_label:unit,p_expires_at:expiresAt,p_note:note||null,p_related_record_id:null});
  if(error){toast("权益调整失败："+friendlyError(error.message),true);return}
  $("bossBenefitName").value="";$("bossBenefitAmount").value="1";$("bossBenefitUnit").value="个";$("bossBenefitExpiry").value="";$("bossBenefitNote").value="";toast("权益已调整并记录流水 ♡");await loadWallet();
}

function friendlyError(message){
  const m=String(message||"");
  if(m.includes("insufficient_prepaid_balance"))return "余额不足，不能扣成负数";
  if(m.includes("insufficient_benefit_quantity"))return "权益数量不足，不能扣成负数";
  if(m.includes("insufficient_prepaid_balance_for_reversal"))return "实充余额已有消费，无法完整撤回这笔预存";
  if(m.includes("insufficient_gift_balance_for_reversal"))return "这笔赠送余额已有消费，无法完整撤回这笔预存";
  if(m.includes("package_benefit_already_used"))return "这笔套餐的赠送权益已经使用过，不能整笔撤销；请改用手动调整";
  if(m.includes("legacy_package_requires_manual_adjustment"))return "这是旧版套餐流水，无法安全自动撤销，请使用手动调整";
  if(m.includes("already_reversed"))return "这笔充值已经撤销过了";
  if(m.includes("account_read_only_expired"))return "账号已到期，当前为只读模式";
  return m;
}

async function reverseTopup(id){
  if(isReadonly()){toast("账号已到期，当前为只读模式",true);return}
  const row=state.prepaid.find(x=>x.id===id);if(!row)return;
  const issue=row.package_issue_id||null;
  const giftRows=issue?state.prepaid.filter(x=>x.package_issue_id===issue&&x.kind==="topup"&&Number(x.delta)>0&&String(x.balance_type||"paid")==="gift"&&!state.prepaid.some(r=>r.reversal_of_id===x.id)):[];
  const gift=giftRows.reduce((sum,x)=>sum+Number(x.delta||0),0);
  const benefitRows=issue?state.benefitLedger.filter(x=>x.package_issue_id===issue&&x.kind==="grant"&&Number(x.delta)>0&&!state.benefitLedger.some(r=>r.reversal_of_id===x.id)):[];
  const benefitText=benefitRows.length?"\n赠送权益："+benefitRows.map(x=>`${x.benefit_name} ${qty(x.delta)}`).join("、"):"";
  const detail=`确认撤回这笔预存？\n\n实充：${money(row.delta)}${gift>0?`\n赠送余额：${money(gift)}`:""}${benefitText}\n\n仅按实际到账回收；任一余额或权益已经消费，整笔都会拒绝，不会部分撤回。`;
  if(!confirm(detail))return;
  const note=window.prompt("撤回原因（可留空）：","")??null;if(note===null)return;
  const {error}=await supabase.rpc("reverse_prepaid_topup",{p_ledger_id:id,p_note:note||null});
  if(error){toast("撤回失败："+friendlyError(error.message),true);return}
  toast("这笔预存已完整撤回，流水已保留 ♡");await loadWallet();
  window.dispatchEvent(new CustomEvent("paimini:prepaid-updated",{detail:{customer_id:row.customer_id}}));
}

function csvCell(v){const s=String(v??"");return '"'+s.replaceAll('"','""')+'"'}
function exportCsv(){
  const c=currentCustomer();if(!c){toast("先选择老板",true);return}
  const rows=[["类型","时间","名称/操作","变动","变动前","变动后","备注"]];
  state.prepaid.slice().reverse().forEach(r=>rows.push(["预存",dateText(r.created_at),prepaidKindText(r.kind),Number(r.delta||0),Number(r.balance_before||0),Number(r.balance_after||0),r.note||""]));
  state.benefitLedger.slice().reverse().forEach(r=>rows.push(["权益",dateText(r.created_at),`${r.benefit_name} · ${benefitKindText(r.kind)}`,Number(r.delta||0),Number(r.quantity_before||0),Number(r.quantity_after||0),r.note||""]));
  const csv="\ufeff"+rows.map(row=>row.map(csvCell).join(",")).join("\r\n");
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=String(c.name||"老板").replace(/[\\/:*?"<>|]/g,"-")+"-余额权益明细.csv";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function bindCard(){
  $("bossWalletCustomer")?.addEventListener("change",async()=>{state.customerId=$("bossWalletCustomer").value||null;await loadWallet()});
  $("bossWalletRefreshBtn")?.addEventListener("click",loadBase);
  $("bossWalletExportBtn")?.addEventListener("click",exportCsv);
  $("bossPrepaidAdjustBtn")?.addEventListener("click",adjustPrepaid);
  $("bossBenefitAdjustBtn")?.addEventListener("click",adjustBenefit);
  $("bossPrepaidLedger")?.addEventListener("click",e=>{const b=e.target.closest("[data-reverse-topup]");if(b)reverseTopup(b.dataset.reverseTopup)});
}

function bindGlobal(){
  $("customerProfileList")?.addEventListener("click",e=>{
    const b=e.target.closest("[data-wallet-customer]");if(!b)return;
    state.customerId=b.dataset.walletCustomer;
    const sel=$("bossWalletCustomer");if(sel)sel.value=state.customerId;
    loadWallet();$("bossWalletCard")?.scrollIntoView({behavior:"smooth",block:"start"});
  });
  $("saveCustomerProfileBtn")?.addEventListener("click",()=>setTimeout(loadBase,650));
  window.addEventListener("paimini:shop-changing",()=>{
    state.customerId=null;state.customers=[];state.prepaid=[];state.benefits=[];state.benefitLedger=[];
    renderSelector();render();
  });
  window.addEventListener("paimini:shop-changed",()=>{state.customerId=null;void loadBase()});
}

injectStyle();injectCard();bindGlobal();injectProfileButtons();
const profileObserver=new MutationObserver(injectProfileButtons);if($("customerProfileList"))profileObserver.observe($("customerProfileList"),{childList:true,subtree:true});
const {data}=await supabase.auth.getSession();state.session=data.session;if(state.session)await loadBase();
supabase.auth.onAuthStateChange(async(_event,session)=>{state.session=session;if(session)await loadBase()});
