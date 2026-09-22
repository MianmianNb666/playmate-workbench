import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";

const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const $=id=>document.getElementById(id);
const state={session:null,shops:[],invite:null};

function safe(v){return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
function toast(message,bad=false){
  if(window.paiMiniOrderBridge?.toast){window.paiMiniOrderBridge.toast(message);return}
  const el=$("toast");if(!el)return;el.textContent=message;el.classList.add("show");
  if(bad)el.style.background="#fff0f2";
  clearTimeout(toast.t);toast.t=setTimeout(()=>{el.classList.remove("show");el.style.background=""},2400);
}

function isReadonly(){return document.body.classList.contains("paimini-readonly")}

function injectStyle(){
  if($("shopMembershipStyle"))return;
  const s=document.createElement("style");
  s.id="shopMembershipStyle";
  s.textContent=`
    #shopVisibilityCard{display:none!important}
    .shop-membership-card{margin-top:16px}
    .shop-membership-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
    .shop-membership-box{border:1px solid var(--line);border-radius:16px;padding:14px;background:var(--paper)}
    .shop-membership-box h3{margin:0 0 4px;font-size:15px}.shop-membership-box p{margin:0 0 12px;color:var(--muted);font-size:12px;line-height:1.55}
    .shop-membership-row{display:flex;gap:8px;align-items:end;flex-wrap:wrap}.shop-membership-row label{flex:1 1 220px}.shop-membership-row .btn{white-space:nowrap}
    .shop-invite-readout{margin-top:10px;display:grid;gap:8px}.shop-invite-line{display:grid;grid-template-columns:88px minmax(0,1fr) auto;gap:8px;align-items:center}
    .shop-invite-line code,.shop-invite-line input{min-width:0;width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .shop-member-list{display:grid;gap:8px;margin-top:10px}.shop-member-item{display:flex;justify-content:space-between;gap:10px;align-items:center;border:1px solid var(--line);border-radius:13px;padding:10px 12px}
    .shop-member-item small{display:block;color:var(--muted);margin-top:3px}.shop-membership-status{display:inline-flex;padding:5px 9px;border-radius:999px;background:var(--pink-soft);font-size:12px;margin-left:6px}
    @media(max-width:720px){.shop-membership-grid{grid-template-columns:1fr}.shop-invite-line{grid-template-columns:1fr}.shop-invite-line>span{font-size:12px;color:var(--muted)}.shop-membership-row .btn{width:100%}}
  `;
  document.head.appendChild(s);
}

function removeOldVisibility(){document.getElementById("shopVisibilityCard")?.remove()}

function injectCard(){
  const page=$("page-shops");
  if(!page)return false;
  removeOldVisibility();
  if($("shopMembershipCard"))return true;

  const card=document.createElement("div");
  card.id="shopMembershipCard";
  card.className="card shop-membership-card";
  card.innerHTML=`
    <div class="card-title"><div><b>加入 / 邀请店铺 ♡</b><small>店铺默认只对店主和已加入成员可见，不再全站公开</small></div></div>
    <div class="shop-membership-grid">
      <div class="shop-membership-box">
        <h3>加入店铺</h3>
        <p>输入店主发给你的加入码，或通过邀请链接打开后在这里确认加入。</p>
        <div class="shop-membership-row">
          <label>店铺邀请码<input id="shopJoinCode" autocomplete="off" placeholder="例如 PM-AB12CD34EF56..."></label>
          <button id="joinShopBtn" class="btn primary" type="button">加入店铺</button>
        </div>
        <div id="joinedShopList" class="shop-member-list"></div>
      </div>

      <div class="shop-membership-box">
        <h3>邀请成员</h3>
        <p>只有你创建的店铺可以生成邀请。加入成员只能读取共享价格表，不能看到你的老板、消费、预存和权益数据。</p>
        <label>我创建的店铺<select id="inviteShopSelect"></select></label>
        <div id="shopInviteArea" class="shop-invite-readout"></div>
      </div>
    </div>`;

  page.querySelector(".page-head")?.insertAdjacentElement("afterend",card);
  bind();
  applyJoinCodeFromUrl();
  return true;
}

function myOwnedShops(){
  if(!state.session)return [];
  return state.shops.filter(s=>s.user_id===state.session.user.id);
}

function joinedShops(){
  if(!state.session)return [];
  return state.shops.filter(s=>s.user_id!==state.session.user.id);
}

function inviteLink(code){
  if(!code)return "";
  const url=new URL("./",location.href);
  url.searchParams.set("join",code);
  url.hash="shops";
  return url.toString();
}

async function copyText(text,label){
  if(!text)return;
  try{
    await navigator.clipboard.writeText(text);
    toast(label+"已复制 ✓");
  }catch{
    window.prompt("复制：",text);
  }
}

function renderJoinedShops(){
  const box=$("joinedShopList");if(!box)return;
  const rows=joinedShops();
  box.innerHTML=rows.length?rows.map(shop=>`
    <div class="shop-member-item">
      <div><b>${safe(shop.name)}</b><small>已加入 · 可使用共享价格表</small></div>
      <button class="tiny-btn" type="button" data-leave-shop="${safe(shop.id)}">退出店铺</button>
    </div>`).join(""):`<div class="empty-state">还没有加入其他店铺。</div>`;
}

function renderOwnerSelect(){
  const sel=$("inviteShopSelect");if(!sel)return;
  const owned=myOwnedShops(),old=sel.value;
  sel.innerHTML=owned.length?owned.map(s=>`<option value="${safe(s.id)}">${safe(s.name)}</option>`).join(""):`<option value="">还没有自己创建的店铺</option>`;
  if(old&&owned.some(s=>s.id===old))sel.value=old;
}

async function loadInvite(){
  const area=$("shopInviteArea"),shopId=$("inviteShopSelect")?.value;
  state.invite=null;
  if(!area)return;
  if(!shopId){area.innerHTML='<div class="empty-state">先创建一家店铺，就可以邀请成员啦。</div>';return}
  area.innerHTML='<div class="empty-state">正在读取邀请…</div>';

  const {data,error}=await supabase.rpc("get_my_shop_invite",{p_shop_id:shopId});
  if(error){area.innerHTML=`<div class="empty-state">邀请读取失败：${safe(error.message)}</div>`;return}
  state.invite=data||null;

  if(!data?.exists){
    area.innerHTML='<div class="empty-state">账号当前为只读状态，续费后可以生成店铺邀请。</div>';
    return;
  }

  const code=data.code||"",link=inviteLink(code),enabled=data.is_enabled!==false;
  area.innerHTML=`
    <div><b>当前邀请 <span class="shop-membership-status">${enabled?"已开启":"已关闭"}</span></b><div class="wallet-inline-note">已加入成员 ${Number(data.member_count||0)} 人</div></div>
    <div class="shop-invite-line"><span>邀请码</span><input id="shopInviteCodeView" readonly value="${safe(code)}"><button id="copyShopInviteCodeBtn" class="tiny-btn" type="button">复制邀请码</button></div>
    <div class="shop-invite-line"><span>邀请链接</span><input id="shopInviteLinkView" readonly value="${safe(link)}"><button id="copyShopInviteLinkBtn" class="tiny-btn" type="button">复制链接</button></div>
    <div class="shop-membership-row">
      <button id="toggleShopInviteBtn" class="btn ghost" type="button">${enabled?"关闭邀请":"重新开启邀请"}</button>
      <button id="regenerateShopInviteBtn" class="btn ghost" type="button">重新生成</button>
    </div>
    <div class="wallet-inline-note">重新生成后，旧邀请码和旧链接会立即失效。关闭邀请不会踢出已经加入的成员。</div>`;

  $("copyShopInviteCodeBtn")?.addEventListener("click",()=>copyText(code,"邀请码"));
  $("copyShopInviteLinkBtn")?.addEventListener("click",()=>copyText(link,"邀请链接"));
  $("toggleShopInviteBtn")?.addEventListener("click",toggleInvite);
  $("regenerateShopInviteBtn")?.addEventListener("click",regenerateInvite);
}

async function load(){
  if(!state.session||!$("page-shops"))return;
  const {data,error}=await supabase.from("shops").select("*").order("created_at");
  if(error){toast("店铺读取失败："+error.message,true);return}
  state.shops=data||[];
  renderJoinedShops();
  renderOwnerSelect();
  await loadInvite();
}

async function joinShop(){
  if(isReadonly()){toast("账号已到期，当前为只读模式",true);return}
  const code=$("shopJoinCode")?.value.trim();
  if(!code){toast("先输入店铺邀请码",true);return}
  const btn=$("joinShopBtn");if(btn){btn.disabled=true;btn.textContent="加入中…"}
  const {data,error}=await supabase.rpc("join_shop_by_code",{p_code:code});
  if(btn){btn.disabled=false;btn.textContent="加入店铺"}
  if(error){toast("加入失败："+error.message,true);return}
  if(!data?.success){toast("邀请码无效、已关闭，或店铺暂不可加入",true);return}

  if(data.reason==="ALREADY_OWNER")toast(`「${data.shop_name||"这家店"}」就是你创建的店铺 ♡`);
  else if(data.reason==="ALREADY_JOINED")toast(`你已经加入「${data.shop_name||"这家店"}」啦`);
  else toast(`已加入「${data.shop_name||"店铺"}」♡`);

  const url=new URL(location.href);url.searchParams.delete("join");history.replaceState(null,"",url.pathname+url.search+url.hash);
  setTimeout(()=>location.reload(),550);
}

async function leaveShop(shopId){
  if(isReadonly()){toast("账号已到期，当前为只读模式",true);return}
  const shop=state.shops.find(s=>s.id===shopId);if(!shop)return;
  if(!confirm(`退出「${shop.name}」后将不再看到它的共享价格表。你自己的历史消费记录仍会保留。确定退出吗？`))return;
  const {data,error}=await supabase.rpc("leave_joined_shop",{p_shop_id:shopId});
  if(error){toast("退出失败："+error.message,true);return}
  if(!data?.success){toast("退出失败",true);return}
  toast("已退出店铺");
  setTimeout(()=>location.reload(),450);
}

async function toggleInvite(){
  if(isReadonly()){toast("账号已到期，当前为只读模式",true);return}
  const shopId=$("inviteShopSelect")?.value;if(!shopId||!state.invite)return;
  const next=state.invite.is_enabled===false;
  const {data,error}=await supabase.rpc("set_shop_invite_enabled",{p_shop_id:shopId,p_enabled:next});
  if(error){toast("操作失败："+error.message,true);return}
  state.invite={...state.invite,...data};
  toast(next?"邀请已重新开启":"邀请已关闭");
  await loadInvite();
}

async function regenerateInvite(){
  if(isReadonly()){toast("账号已到期，当前为只读模式",true);return}
  const shopId=$("inviteShopSelect")?.value;if(!shopId)return;
  if(!confirm("重新生成后，旧邀请码和旧链接会立即失效。确定重新生成吗？"))return;
  const {error}=await supabase.rpc("regenerate_shop_invite",{p_shop_id:shopId});
  if(error){toast("重新生成失败："+error.message,true);return}
  toast("新的店铺邀请码已生成 ♡");
  await loadInvite();
}

function applyJoinCodeFromUrl(){
  const code=new URLSearchParams(location.search).get("join");
  if(!code)return;
  const input=$("shopJoinCode");if(input)input.value=code;
  const nav=document.querySelector('.nav-tab[data-page="shops"]');
  if(nav)nav.click();
}

function bind(){
  $("joinShopBtn")?.addEventListener("click",joinShop);
  $("shopJoinCode")?.addEventListener("keydown",e=>{if(e.key==="Enter")joinShop()});
  $("inviteShopSelect")?.addEventListener("change",loadInvite);
  $("joinedShopList")?.addEventListener("click",e=>{const b=e.target.closest("[data-leave-shop]");if(b)leaveShop(b.dataset.leaveShop)});
}

injectStyle();
if(!injectCard()){
  const observer=new MutationObserver(()=>{removeOldVisibility();if(injectCard()){observer.disconnect();load()}});
  observer.observe(document.documentElement,{childList:true,subtree:true});
  setTimeout(()=>observer.disconnect(),12000);
}

const oldObserver=new MutationObserver(removeOldVisibility);
oldObserver.observe(document.documentElement,{childList:true,subtree:true});

const {data}=await supabase.auth.getSession();
state.session=data.session;
if(state.session)await load();
supabase.auth.onAuthStateChange(async(_event,session)=>{state.session=session;if(session)await load()});
