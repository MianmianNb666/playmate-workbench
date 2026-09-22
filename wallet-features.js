import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";

const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const $=id=>document.getElementById(id);
const state={session:null,shops:[],customers:[],presets:[],draftBenefits:[]};

function safe(v){return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
function money(v,shop){return (shop?.currency_symbol||"¥")+Number(v||0).toFixed(2)}
function toast(message,bad=false){const el=$("toast");if(!el)return;el.textContent=message;el.classList.add("show");el.style.background=bad?"#fff0f2":"";clearTimeout(toast.t);toast.t=setTimeout(()=>{el.classList.remove("show");el.style.background=""},2400)}

function injectStyles(){
  if($("walletFeatureStyles"))return;
  const s=document.createElement("style");s.id="walletFeatureStyles";s.textContent=`
  .wallet-feature-card{margin-top:16px}.wallet-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.wallet-grid .wide{grid-column:1/-1}
  .wallet-seg{display:flex;gap:8px;flex-wrap:wrap}.wallet-seg button{border:1px solid var(--line);background:var(--paper);border-radius:999px;padding:8px 13px;cursor:pointer;color:var(--ink)}
  .wallet-seg button.active{background:var(--pink-soft);border-color:var(--pink);color:var(--pink-deep);font-weight:700}.wallet-presets{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;margin-top:12px}
  .wallet-preset{border:1px solid var(--line);border-radius:16px;padding:13px;background:var(--paper)}.wallet-preset b,.wallet-preset small{display:block}.wallet-preset small{color:var(--muted);margin:5px 0 10px;line-height:1.55}
  .wallet-preset-actions{display:flex;gap:7px;flex-wrap:wrap}.wallet-inline-note{font-size:12px;color:var(--muted);line-height:1.55}.wallet-boss-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:end}
  .benefit-builder{border:1px dashed var(--line);border-radius:16px;padding:12px}.benefit-builder-head{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:10px}.benefit-draft-list{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.benefit-chip{display:flex;gap:7px;align-items:center;border:1px solid var(--line);border-radius:999px;padding:7px 10px;background:var(--pink-soft)}.benefit-chip button{border:0;background:transparent;cursor:pointer;color:var(--muted);font-size:16px;line-height:1}
  .package-benefits{margin-top:7px}.package-benefits span{display:inline-block;margin:2px 5px 2px 0;padding:4px 7px;border-radius:999px;background:var(--pink-soft);font-size:12px}
  @media(max-width:720px){.wallet-grid,.wallet-boss-row{grid-template-columns:1fr}.wallet-grid .wide{grid-column:auto}.benefit-builder-head{align-items:flex-start;flex-direction:column}}`;
  document.head.appendChild(s);
}

function injectShopVisibility(){
  const page=$("page-shops");if(!page||$("shopVisibilityCard"))return;
  const card=document.createElement("div");card.className="card wallet-feature-card";card.id="shopVisibilityCard";
  card.innerHTML=`<div class="card-title"><div><b>店铺公开 / 私密</b><small>私密店铺只有创建者自己可见</small></div></div>
  <div class="wallet-grid"><label>我的店铺<select id="visibilityShopSelect"></select></label><div><span class="wallet-inline-note">可见范围</span><div class="wallet-seg" id="visibilitySeg"><button type="button" data-visibility="public">公开</button><button type="button" data-visibility="private">私密</button></div></div>
  <div class="wide wallet-inline-note">公开店铺可被其他登录用户看到；私密店铺和它的价格表都只对你自己可见。</div></div>`;
  page.querySelector(".page-head")?.insertAdjacentElement("afterend",card);
}

function injectWallet(){
  const page=$("page-prices");if(!page||$("walletPresetCard"))return;
  const card=document.createElement("div");card.className="card wallet-feature-card";card.id="walletPresetCard";
  card.innerHTML=`<div class="card-title"><div><b>预存套餐库 ♡</b><small>预存是主体，权益作为这笔预存附送，可一起保存后一键发给老板</small></div></div>
  <div class="wallet-grid">
    <label>店铺<select id="walletShopSelect"></select></label>
    <label>套餐名称<input id="walletPresetName" placeholder="例如 预存500送冠"></label>
    <label>预存金额<input id="walletAmount" type="number" min="0" step="0.01" placeholder="500"></label>
    <label>备注<input id="walletPresetNote" placeholder="例如 九月活动"></label>
    <div class="wide benefit-builder">
      <div class="benefit-builder-head"><div><b>附赠权益</b><div class="wallet-inline-note">可以不送，也可以一次加多个，例如 冠×1 + 9折券×1 + 语聊30分钟</div></div><button id="addDraftBenefitBtn" class="btn ghost" type="button">＋ 添加权益</button></div>
      <div class="wallet-grid">
        <label>权益名称<input id="walletBenefitName" placeholder="冠 / 折扣券 / 赠送时长"></label>
        <label>数量<input id="walletBenefitQty" type="number" min="0" step="0.01" value="1"></label>
        <label>单位<input id="walletBenefitUnit" placeholder="个 / 次 / 张 / 分钟" value="个"></label>
        <label>有效天数<input id="walletBenefitExpire" type="number" min="0" step="1" placeholder="留空=不限期"></label>
      </div>
      <div id="draftBenefitList" class="benefit-draft-list"></div>
    </div>
    <div class="wide"><button id="saveWalletPresetBtn" class="btn primary" type="button">保存预存套餐</button></div>
  </div><hr style="border:0;border-top:1px solid var(--line);margin:18px 0">
  <div class="wallet-boss-row"><label>一键发放给老板<select id="walletBossSelect"></select></label><button id="refreshWalletBtn" class="btn ghost" type="button">刷新</button></div>
  <p class="wallet-inline-note">发放时会一次完成：增加预存余额 + 发放套餐附赠权益 + 自动留下对应流水。</p>
  <div id="walletPresetList" class="wallet-presets"></div><div id="walletPresetEmpty" class="empty-state hidden">还没有预存套餐，先保存一个吧 ♡</div>`;
  page.querySelector(".page-head")?.insertAdjacentElement("afterend",card);
}

function activeShop(){return $("calcShop")?.value||state.shops[0]?.id||""}

function renderVisibility(){
  const sel=$("visibilityShopSelect");if(!sel||!state.session)return;
  const mine=state.shops.filter(s=>s.user_id===state.session.user.id),old=sel.value;
  sel.innerHTML=mine.length?mine.map(s=>`<option value="${s.id}">${safe(s.name)}</option>`).join(""):`<option value="">还没有自己创建的店铺</option>`;
  if(old&&mine.some(s=>s.id===old))sel.value=old;
  const shop=mine.find(s=>s.id===sel.value)||mine[0];if(shop&&!sel.value)sel.value=shop.id;
  document.querySelectorAll("#visibilitySeg [data-visibility]").forEach(btn=>btn.classList.toggle("active",btn.dataset.visibility===(shop?.visibility||"public")));
}

function normalizeBenefits(p){
  if(Array.isArray(p?.bundled_benefits))return p.bundled_benefits;
  if(p?.preset_type==="benefit"&&p.benefit_name)return [{name:p.benefit_name,quantity:Number(p.benefit_quantity||1),unit:p.benefit_unit||"个",expires_days:p.expires_days||null}];
  return [];
}

function renderDraftBenefits(){
  const box=$("draftBenefitList");if(!box)return;
  box.innerHTML=state.draftBenefits.map((b,i)=>`<span class="benefit-chip">${safe(b.name)} × ${Number(b.quantity||1)} ${safe(b.unit||"个")}${b.expires_days?` · ${b.expires_days}天`:""}<button type="button" data-remove-draft-benefit="${i}" title="删除">×</button></span>`).join("");
}

function renderWallet(){
  const shopSel=$("walletShopSelect");if(!shopSel)return;
  const old=shopSel.value;shopSel.innerHTML=state.shops.map(s=>`<option value="${s.id}">${safe(s.name)}</option>`).join("");
  const preferred=old||activeShop();if(preferred&&state.shops.some(s=>s.id===preferred))shopSel.value=preferred;
  const shopId=shopSel.value,shop=state.shops.find(s=>s.id===shopId),bosses=state.customers.filter(c=>c.shop_id===shopId),bossSel=$("walletBossSelect");
  bossSel.innerHTML=bosses.length?bosses.map(c=>`<option value="${c.id}">${safe(c.name)} · 余额 ${money(c.prepaid_balance,shop)}</option>`).join(""):`<option value="">这个店铺还没有老板档案</option>`;
  const presets=state.presets.filter(p=>p.shop_id===shopId&&p.is_active!==false&&p.preset_type==="prepaid");$("walletPresetEmpty")?.classList.toggle("hidden",presets.length>0);
  $("walletPresetList").innerHTML=presets.map(p=>{const benefits=normalizeBenefits(p);return `<div class="wallet-preset"><b>${safe(p.name)}</b><small>${money(p.amount,shop)} 预存${p.note?` · ${safe(p.note)}`:""}</small>${benefits.length?`<div class="package-benefits">${benefits.map(b=>`<span>赠 ${safe(b.name)} × ${Number(b.quantity||1)} ${safe(b.unit||"个")}${b.expires_days?` · ${b.expires_days}天`:""}</span>`).join("")}</div>`:`<div class="wallet-inline-note">无附赠权益</div>`}<div class="wallet-preset-actions"><button class="tiny-btn" type="button" data-apply-wallet="${p.id}">一键添加给老板</button><button class="tiny-btn" type="button" data-delete-wallet="${p.id}">删除</button></div></div>`}).join("");
}

async function load(){
  if(!state.session)return;
  const [shops,customers,presets]=await Promise.all([supabase.from("shops").select("*").order("name"),supabase.from("customers").select("*").order("name"),supabase.from("wallet_presets").select("*").order("sort_order").order("created_at")]);
  if(!shops.error)state.shops=shops.data||[];if(!customers.error)state.customers=customers.data||[];if(!presets.error)state.presets=presets.data||[];renderVisibility();renderWallet();renderDraftBenefits();
}

async function setVisibility(value){const id=$("visibilityShopSelect")?.value;if(!id)return;const {error}=await supabase.from("shops").update({visibility:value}).eq("id",id);if(error){toast("保存失败："+error.message,true);return}const shop=state.shops.find(s=>s.id===id);if(shop)shop.visibility=value;renderVisibility();toast(value==="private"?"已设为私密，仅自己可见":"已设为公开店铺")}

function addDraftBenefit(){
  const name=$("walletBenefitName")?.value.trim(),qty=Number($("walletBenefitQty")?.value||0),unit=$("walletBenefitUnit")?.value.trim()||"个",days=Number($("walletBenefitExpire")?.value||0);
  if(!name){toast("先填权益名称",true);return}if(!(qty>0)){toast("权益数量要大于 0",true);return}
  state.draftBenefits.push({name,quantity:qty,unit,expires_days:days>0?Math.floor(days):null});
  $("walletBenefitName").value="";$("walletBenefitQty").value="1";$("walletBenefitUnit").value="个";$("walletBenefitExpire").value="";renderDraftBenefits();
}

async function savePreset(){
  const shopId=$("walletShopSelect")?.value,name=$("walletPresetName")?.value.trim(),amount=Number($("walletAmount")?.value||0);if(!shopId){toast("请先选择店铺",true);return}if(!name){toast("先给套餐起个名字",true);return}if(!(amount>0)){toast("预存金额要大于 0",true);return}
  const p={user_id:state.session.user.id,shop_id:shopId,preset_type:"prepaid",name,amount,note:$("walletPresetNote")?.value.trim()||null,bundled_benefits:state.draftBenefits};
  const {error}=await supabase.from("wallet_presets").insert(p);if(error){toast("保存套餐失败："+error.message,true);return}
  ["walletPresetName","walletAmount","walletPresetNote","walletBenefitName","walletBenefitExpire"].forEach(id=>{if($(id))$(id).value=""});if($("walletBenefitQty"))$("walletBenefitQty").value="1";if($("walletBenefitUnit"))$("walletBenefitUnit").value="个";state.draftBenefits=[];await load();toast("预存套餐已保存 ♡")
}

async function applyPreset(id){
  const p=state.presets.find(x=>x.id===id),customerId=$("walletBossSelect")?.value;if(!p||!customerId){toast("请先选择老板",true);return}const c=state.customers.find(x=>x.id===customerId);if(!c||c.shop_id!==p.shop_id){toast("老板和套餐不属于同一个店铺",true);return}
  const {data,error}=await supabase.rpc("apply_prepaid_package",{p_customer_id:customerId,p_preset_id:id});if(error){toast("发放套餐失败："+error.message,true);return}
  const count=Array.isArray(data?.benefits)?data.benefits.length:normalizeBenefits(p).length;toast(`已给 ${c.name} 添加 ${money(p.amount,state.shops.find(s=>s.id===p.shop_id))} 预存${count?` + ${count}项赠送权益`:""} ♡`);await load()
}

async function deletePreset(id){const {error}=await supabase.from("wallet_presets").delete().eq("id",id);if(error){toast("删除失败："+error.message,true);return}await load();toast("预存套餐已删除")}

function bind(){
  $("visibilityShopSelect")?.addEventListener("change",renderVisibility);$("visibilitySeg")?.addEventListener("click",e=>{const b=e.target.closest("[data-visibility]");if(b)setVisibility(b.dataset.visibility)});
  $("walletShopSelect")?.addEventListener("change",renderWallet);$("saveWalletPresetBtn")?.addEventListener("click",savePreset);$("addDraftBenefitBtn")?.addEventListener("click",addDraftBenefit);$("refreshWalletBtn")?.addEventListener("click",load);
  $("draftBenefitList")?.addEventListener("click",e=>{const b=e.target.closest("[data-remove-draft-benefit]");if(!b)return;state.draftBenefits.splice(Number(b.dataset.removeDraftBenefit),1);renderDraftBenefits()});
  $("walletPresetList")?.addEventListener("click",e=>{const a=e.target.closest("[data-apply-wallet]"),d=e.target.closest("[data-delete-wallet]");if(a)applyPreset(a.dataset.applyWallet);else if(d)deletePreset(d.dataset.deleteWallet)});
  $("calcShop")?.addEventListener("change",()=>{const t=$("walletShopSelect");if(t&&[...t.options].some(o=>o.value===$("calcShop").value)){t.value=$("calcShop").value;renderWallet()}});
}

injectStyles();injectShopVisibility();injectWallet();bind();
const {data}=await supabase.auth.getSession();state.session=data.session;if(state.session)await load();
supabase.auth.onAuthStateChange(async(_event,session)=>{state.session=session;if(session)await load()});
