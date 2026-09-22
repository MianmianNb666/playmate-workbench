import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";

const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const $=id=>document.getElementById(id);
const state={session:null,shops:[],customers:[],presets:[]};

function safe(v){return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
function money(v,shop){return (shop?.currency_symbol||"¥")+Number(v||0).toFixed(2)}
function toast(message,bad=false){const el=$("toast");if(!el)return;el.textContent=message;el.classList.add("show");el.style.background=bad?"#fff0f2":"";clearTimeout(toast.t);toast.t=setTimeout(()=>{el.classList.remove("show");el.style.background=""},2400)}

function injectStyles(){
  if($("walletFeatureStyles"))return;
  const s=document.createElement("style");s.id="walletFeatureStyles";s.textContent=`
  .wallet-feature-card{margin-top:16px}.wallet-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.wallet-grid .wide{grid-column:1/-1}
  .wallet-seg{display:flex;gap:8px;flex-wrap:wrap}.wallet-seg button{border:1px solid var(--line);background:var(--paper);border-radius:999px;padding:8px 13px;cursor:pointer;color:var(--ink)}
  .wallet-seg button.active{background:var(--pink-soft);border-color:var(--pink);color:var(--pink-deep);font-weight:700}.wallet-presets{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:12px}
  .wallet-preset{border:1px solid var(--line);border-radius:16px;padding:13px;background:var(--paper)}.wallet-preset b,.wallet-preset small{display:block}.wallet-preset small{color:var(--muted);margin:5px 0 10px}
  .wallet-preset-actions{display:flex;gap:7px;flex-wrap:wrap}.wallet-inline-note{font-size:12px;color:var(--muted);line-height:1.55}.wallet-boss-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:end}
  @media(max-width:720px){.wallet-grid,.wallet-boss-row{grid-template-columns:1fr}.wallet-grid .wide{grid-column:auto}}`;
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
  card.innerHTML=`<div class="card-title"><div><b>预存 / 权益库 ♡</b><small>像价格卡片一样保存，之后选老板一键发放</small></div></div>
  <div class="wallet-grid">
    <label>店铺<select id="walletShopSelect"></select></label>
    <div><span class="wallet-inline-note">模板类型</span><div class="wallet-seg" id="walletTypeSeg"><button type="button" class="active" data-wallet-type="prepaid">预存</button><button type="button" data-wallet-type="benefit">权益</button></div></div>
    <label>模板名称<input id="walletPresetName" placeholder="例如 预存500 / 冠×1"></label>
    <label id="walletAmountLabel">预存金额<input id="walletAmount" type="number" min="0" step="0.01" placeholder="500"></label>
    <label id="walletBenefitNameLabel" class="hidden">权益名称<input id="walletBenefitName" placeholder="例如 冠 / 折扣券"></label>
    <label id="walletBenefitQtyLabel" class="hidden">数量<input id="walletBenefitQty" type="number" min="0" step="0.01" value="1"></label>
    <label id="walletBenefitUnitLabel" class="hidden">单位<input id="walletBenefitUnit" placeholder="个 / 次 / 张" value="个"></label>
    <label id="walletBenefitExpireLabel" class="hidden">有效天数<input id="walletBenefitExpire" type="number" min="0" step="1" placeholder="留空=不限期"></label>
    <label class="wide">备注<input id="walletPresetNote" placeholder="可选"></label><div class="wide"><button id="saveWalletPresetBtn" class="btn primary" type="button">保存到预存 / 权益库</button></div>
  </div><hr style="border:0;border-top:1px solid var(--line);margin:18px 0">
  <div class="wallet-boss-row"><label>发放给老板<select id="walletBossSelect"></select></label><button id="refreshWalletBtn" class="btn ghost" type="button">刷新</button></div>
  <p class="wallet-inline-note">先选老板，再点下面模板的「一键添加」。预存进入余额，权益进入老板权益库存，并自动留下流水。</p>
  <div id="walletPresetList" class="wallet-presets"></div><div id="walletPresetEmpty" class="empty-state hidden">还没有模板，先保存一个常用预存或权益吧 ♡</div>`;
  page.querySelector(".page-head")?.insertAdjacentElement("afterend",card);
}

function walletType(){return document.querySelector("#walletTypeSeg .active")?.dataset.walletType||"prepaid"}
function renderType(){const b=walletType()==="benefit";$("walletAmountLabel")?.classList.toggle("hidden",b);["walletBenefitNameLabel","walletBenefitQtyLabel","walletBenefitUnitLabel","walletBenefitExpireLabel"].forEach(id=>$(id)?.classList.toggle("hidden",!b))}
function activeShop(){return $("calcShop")?.value||state.shops[0]?.id||""}

function renderVisibility(){
  const sel=$("visibilityShopSelect");if(!sel||!state.session)return;
  const mine=state.shops.filter(s=>s.user_id===state.session.user.id),old=sel.value;
  sel.innerHTML=mine.length?mine.map(s=>`<option value="${s.id}">${safe(s.name)}</option>`).join(""):`<option value="">还没有自己创建的店铺</option>`;
  if(old&&mine.some(s=>s.id===old))sel.value=old;
  const shop=mine.find(s=>s.id===sel.value)||mine[0];if(shop&&!sel.value)sel.value=shop.id;
  document.querySelectorAll("#visibilitySeg [data-visibility]").forEach(btn=>btn.classList.toggle("active",btn.dataset.visibility===(shop?.visibility||"public")));
}

function renderWallet(){
  const shopSel=$("walletShopSelect");if(!shopSel)return;
  const old=shopSel.value;shopSel.innerHTML=state.shops.map(s=>`<option value="${s.id}">${safe(s.name)}</option>`).join("");
  const preferred=old||activeShop();if(preferred&&state.shops.some(s=>s.id===preferred))shopSel.value=preferred;
  const shopId=shopSel.value,shop=state.shops.find(s=>s.id===shopId),bosses=state.customers.filter(c=>c.shop_id===shopId),bossSel=$("walletBossSelect");
  bossSel.innerHTML=bosses.length?bosses.map(c=>`<option value="${c.id}">${safe(c.name)} · 余额 ${money(c.prepaid_balance,shop)}</option>`).join(""):`<option value="">这个店铺还没有老板档案</option>`;
  const presets=state.presets.filter(p=>p.shop_id===shopId&&p.is_active!==false);$("walletPresetEmpty")?.classList.toggle("hidden",presets.length>0);
  $("walletPresetList").innerHTML=presets.map(p=>{const detail=p.preset_type==="prepaid"?`${money(p.amount,shop)} 预存`:`${safe(p.benefit_name||p.name)} × ${Number(p.benefit_quantity||1)} ${safe(p.benefit_unit||"个")}${p.expires_days?` · ${p.expires_days}天有效`:""}`;return `<div class="wallet-preset"><b>${safe(p.name)}</b><small>${detail}${p.note?` · ${safe(p.note)}`:""}</small><div class="wallet-preset-actions"><button class="tiny-btn" type="button" data-apply-wallet="${p.id}">一键添加给老板</button><button class="tiny-btn" type="button" data-delete-wallet="${p.id}">删除</button></div></div>`}).join("");
}

async function load(){
  if(!state.session)return;
  const [shops,customers,presets]=await Promise.all([supabase.from("shops").select("*").order("name"),supabase.from("customers").select("*").order("name"),supabase.from("wallet_presets").select("*").order("sort_order").order("created_at")]);
  if(!shops.error)state.shops=shops.data||[];if(!customers.error)state.customers=customers.data||[];if(!presets.error)state.presets=presets.data||[];renderVisibility();renderWallet();
}

async function setVisibility(value){const id=$("visibilityShopSelect")?.value;if(!id)return;const {error}=await supabase.from("shops").update({visibility:value}).eq("id",id);if(error){toast("保存失败："+error.message,true);return}const shop=state.shops.find(s=>s.id===id);if(shop)shop.visibility=value;renderVisibility();toast(value==="private"?"已设为私密，仅自己可见":"已设为公开店铺")}

async function savePreset(){
  const shopId=$("walletShopSelect")?.value,name=$("walletPresetName")?.value.trim(),type=walletType();if(!shopId){toast("请先选择店铺",true);return}if(!name){toast("先给模板起个名字",true);return}
  const p={user_id:state.session.user.id,shop_id:shopId,preset_type:type,name,note:$("walletPresetNote")?.value.trim()||null};
  if(type==="prepaid"){const amount=Number($("walletAmount")?.value||0);if(!(amount>0)){toast("预存金额要大于 0",true);return}p.amount=amount}else{const n=$("walletBenefitName")?.value.trim(),q=Number($("walletBenefitQty")?.value||0);if(!n||!(q>0)){toast("权益名称和数量都要填",true);return}p.benefit_name=n;p.benefit_quantity=q;p.benefit_unit=$("walletBenefitUnit")?.value.trim()||"个";const d=Number($("walletBenefitExpire")?.value||0);p.expires_days=d>0?Math.floor(d):null}
  const {error}=await supabase.from("wallet_presets").insert(p);if(error){toast("保存模板失败："+error.message,true);return}
  ["walletPresetName","walletAmount","walletBenefitName","walletBenefitExpire","walletPresetNote"].forEach(id=>{if($(id))$(id).value=""});if($("walletBenefitQty"))$("walletBenefitQty").value="1";await load();toast("已经保存到预存 / 权益库 ♡")
}

async function applyPreset(id){
  const p=state.presets.find(x=>x.id===id),customerId=$("walletBossSelect")?.value;if(!p||!customerId){toast("请先选择老板",true);return}const c=state.customers.find(x=>x.id===customerId);if(!c||c.shop_id!==p.shop_id){toast("老板和模板不属于同一个店铺",true);return}
  if(p.preset_type==="prepaid"){const {error}=await supabase.rpc("adjust_customer_prepaid",{p_customer_id:customerId,p_delta:Number(p.amount||0),p_kind:"topup",p_note:p.name,p_related_record_id:null});if(error){toast("添加预存失败："+error.message,true);return}toast(`已给 ${c.name} 添加预存 ${money(p.amount,state.shops.find(s=>s.id===p.shop_id))}`)}
  else{let expires=null;if(Number(p.expires_days)>0){const d=new Date();d.setDate(d.getDate()+Number(p.expires_days));expires=d.toISOString()}const {error}=await supabase.rpc("adjust_customer_benefit",{p_customer_id:customerId,p_name:p.benefit_name||p.name,p_delta:Number(p.benefit_quantity||1),p_kind:"grant",p_unit_label:p.benefit_unit||"个",p_expires_at:expires,p_note:p.name,p_related_record_id:null});if(error){toast("添加权益失败："+error.message,true);return}toast(`已给 ${c.name} 添加权益 ${p.benefit_name||p.name} ♡`)}await load()
}

async function deletePreset(id){const {error}=await supabase.from("wallet_presets").delete().eq("id",id);if(error){toast("删除失败："+error.message,true);return}await load();toast("模板已删除")}

function bind(){
  $("visibilityShopSelect")?.addEventListener("change",renderVisibility);$("visibilitySeg")?.addEventListener("click",e=>{const b=e.target.closest("[data-visibility]");if(b)setVisibility(b.dataset.visibility)});
  $("walletTypeSeg")?.addEventListener("click",e=>{const b=e.target.closest("[data-wallet-type]");if(!b)return;document.querySelectorAll("#walletTypeSeg [data-wallet-type]").forEach(x=>x.classList.toggle("active",x===b));renderType()});
  $("walletShopSelect")?.addEventListener("change",renderWallet);$("saveWalletPresetBtn")?.addEventListener("click",savePreset);$("refreshWalletBtn")?.addEventListener("click",load);
  $("walletPresetList")?.addEventListener("click",e=>{const a=e.target.closest("[data-apply-wallet]"),d=e.target.closest("[data-delete-wallet]");if(a)applyPreset(a.dataset.applyWallet);else if(d)deletePreset(d.dataset.deleteWallet)});
  $("calcShop")?.addEventListener("change",()=>{const t=$("walletShopSelect");if(t&&[...t.options].some(o=>o.value===$("calcShop").value)){t.value=$("calcShop").value;renderWallet()}});
}

injectStyles();injectShopVisibility();injectWallet();renderType();bind();
const {data}=await supabase.auth.getSession();state.session=data.session;if(state.session)await load();
supabase.auth.onAuthStateChange(async(_event,session)=>{state.session=session;if(session)await load()});
