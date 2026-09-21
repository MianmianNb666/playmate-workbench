import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";

const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{
  auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
});

const $=id=>document.getElementById(id);

const state={
  session:null,
  users:[],
  invites:[],
  shops:[],
  logs:[],
  userSearch:""
};

function safe(value){
  return String(value??"")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function dateText(value){
  if(!value) return "—";
  const d=new Date(value);
  if(Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-CN",{
    year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit"
  });
}

function shortId(value){
  const s=String(value||"");
  return s.length>12?s.slice(0,8)+"…"+s.slice(-4):s;
}

function showOnly(id){
  ["loginGate","deniedGate","adminApp"].forEach(key=>{
    const el=$(key);
    if(el) el.classList.toggle("hidden",key!==id);
  });
}

function setLoginHint(text,bad=false){
  const el=$("loginHint");
  if(!el) return;
  el.textContent=text;
  el.style.color=bad?"#c65f76":"#9c818c";
}

async function signIn(){
  const email=$("adminEmail").value.trim();
  const password=$("adminPassword").value;
  if(!email||!password){
    setLoginHint("请输入邮箱和密码。",true);
    return;
  }

  setLoginHint("正在登录…");
  const {data,error}=await supabase.auth.signInWithPassword({email,password});
  if(error){
    setLoginHint("登录失败："+error.message,true);
    return;
  }

  await applySession(data.session);
}

async function signOut(){
  await supabase.auth.signOut();
  state.session=null;
  showOnly("loginGate");
}

async function applySession(session){
  state.session=session;

  if(!session){
    showOnly("loginGate");
    return;
  }

  const {data,error}=await supabase.rpc("is_app_admin");
  if(error){
    console.error(error);
    showOnly("deniedGate");
    return;
  }

  if(!data){
    showOnly("deniedGate");
    return;
  }

  $("adminAccount").textContent=session.user.email||"";
  showOnly("adminApp");
  await loadAll();
}

async function loadAll(){
  const [users,invites,shops,logs]=await Promise.all([
    supabase.rpc("admin_list_users"),
    supabase.rpc("admin_list_invites"),
    supabase.rpc("admin_list_shops"),
    supabase.rpc("admin_list_time_logs")
  ]);

  const errors=[users.error,invites.error,shops.error,logs.error].filter(Boolean);
  if(errors.length){
    console.error(errors);
    alert("管理端数据读取失败："+errors[0].message);
    return;
  }

  state.users=users.data||[];
  state.invites=invites.data||[];
  state.shops=shops.data||[];
  state.logs=logs.data||[];

  renderStats();
  renderUsers();
  renderInvites();
  renderShops();
  renderLogs();
}

function renderStats(){
  const active=state.users.filter(u=>u.has_access).length;
  const expired=state.users.length-active;

  $("statUsers").textContent=state.users.length;
  $("statActive").textContent=active;
  $("statExpired").textContent=expired;
  $("statShops").textContent=state.shops.length;
}

function renderUsers(){
  const q=state.userSearch.trim().toLowerCase();

  const rows=state.users.filter(user=>{
    if(!q) return true;
    return [user.email,user.display_name,user.user_id]
      .some(v=>String(v||"").toLowerCase().includes(q));
  });

  if(!rows.length){
    $("userList").innerHTML='<div class="empty">没有找到账号。</div>';
    return;
  }

  $("userList").innerHTML=rows.map(user=>{
    const title=safe(user.display_name||user.email||"未命名账号");
    const status=user.has_access?"使用中":"已到期";
    const statusClass=user.has_access?"status":"status off";

    return ''
      +'<div class="user-row">'
      +  '<div class="row-title">'
      +    '<div><span class="'+statusClass+'">'+status+'</span></div>'
      +    '<b>'+title+'</b>'
      +    '<p>'+safe(user.email||"")+' · '+safe(shortId(user.user_id))+'</p>'
      +    '<p>剩余 '+Number(user.days_left||0)+' 天 · 到期 '+safe(dateText(user.valid_until))+'</p>'
      +    '<p>'+Number(user.shop_count||0)+' 个店铺 · '+Number(user.record_count||0)+' 条消费记录</p>'
      +  '</div>'
      +  '<div class="quick">'
      +    '<button data-grant-user="'+safe(user.user_id)+'" data-days="7" type="button">+7天</button>'
      +    '<button data-grant-user="'+safe(user.user_id)+'" data-days="30" type="button">+30天</button>'
      +    '<button data-grant-user="'+safe(user.user_id)+'" data-days="90" type="button">+90天</button>'
      +    '<button data-grant-user="'+safe(user.user_id)+'" data-days="365" type="button">+365天</button>'
      +  '</div>'
      +'</div>';
  }).join("");
}

async function grantDays(userId,days){
  const user=state.users.find(u=>u.user_id===userId);
  const name=user?.display_name||user?.email||"这个账号";

  if(!confirm("给 "+name+" 增加 "+days+" 天使用时间？")) return;

  const {data,error}=await supabase.rpc("admin_grant_days",{
    p_user_id:userId,
    p_days:Number(days)
  });

  if(error){
    alert("加时失败："+error.message);
    return;
  }

  if(!data?.success){
    alert("加时失败");
    return;
  }

  await loadAll();
}

function renderInvites(){
  if(!state.invites.length){
    $("inviteList").innerHTML='<div class="empty">还没有邀请码。</div>';
    return;
  }

  $("inviteList").innerHTML=state.invites.map(item=>{
    const usage=item.use_mode==="multi"
      ? Number(item.used_count||0)+" / "+(item.max_uses==null?"∞":item.max_uses)
      : (Number(item.used_count||0)>0?"已使用":"未使用");

    const type=item.purpose==="signup"?"注册邀请码":"续费邀请码";
    const statusClass=item.is_active?"status":"status off";
    const statusText=item.is_active?"有效":"失效";
    const expiry=item.expires_at
      ? '<p>邀请码失效：'+safe(dateText(item.expires_at))+'</p>'
      : '';

    return ''
      +'<div class="invite-row">'
      +  '<div class="row-title">'
      +    '<b>'+type+' · '+Number(item.duration_days)+'天</b>'
      +    '<p>'+safe(item.label||"无备注")+' · '+safe(item.use_mode==="multi"?"多人通用":"单次使用")+'</p>'
      +    '<p>使用 '+safe(usage)+' · '+statusText+' · 创建 '+safe(dateText(item.created_at))+'</p>'
      +    expiry
      +  '</div>'
      +  '<span class="'+statusClass+'">'+statusText+'</span>'
      +'</div>';
  }).join("");
}

function syncInviteForm(){
  const signup=$("invitePurpose").value==="signup";
  if(signup) $("inviteDuration").value="7";
  $("inviteDuration").disabled=signup;

  const multi=$("inviteMode").value==="multi";
  $("inviteMaxUses").disabled=!multi;
}

async function createInvite(){
  const purpose=$("invitePurpose").value;
  const duration=purpose==="signup"?7:Number($("inviteDuration").value);
  const mode=$("inviteMode").value;
  const maxUses=mode==="multi"
    ? Math.max(1,Number($("inviteMaxUses").value||1))
    : 1;
  const label=$("inviteLabel").value.trim()||null;
  const expiresRaw=$("inviteExpires").value;
  const expires=expiresRaw?new Date(expiresRaw).toISOString():null;

  const btn=$("createInviteBtn");
  btn.disabled=true;
  btn.textContent="生成中…";

  const {data,error}=await supabase.rpc("admin_generate_invite",{
    p_purpose:purpose,
    p_duration_days:duration,
    p_use_mode:mode,
    p_max_uses:maxUses,
    p_label:label,
    p_expires_at:expires
  });

  btn.disabled=false;
  btn.textContent="生成邀请码";

  if(error){
    alert("生成失败："+error.message);
    return;
  }

  $("generatedCode").textContent=data?.code||"";
  $("generatedInvite").classList.remove("hidden");
  await loadAll();
}

async function copyInvite(){
  const code=$("generatedCode").textContent.trim();
  if(!code) return;

  try{
    await navigator.clipboard.writeText(code);
    $("copyInviteBtn").textContent="已复制 ✓";
    setTimeout(()=>$("copyInviteBtn").textContent="复制邀请码",1200);
  }catch{
    window.prompt("复制邀请码：",code);
  }
}

function renderShops(){
  if(!state.shops.length){
    $("shopAdminList").innerHTML='<div class="empty">还没有店铺。</div>';
    return;
  }

  $("shopAdminList").innerHTML=state.shops.map(shop=>{
    const statusClass=shop.is_active?"status":"status off";
    const statusText=shop.is_active?"公开中":"已隐藏";
    const buttonText=shop.is_active?"隐藏店铺":"重新公开";
    const next=shop.is_active?"0":"1";

    return ''
      +'<div class="shop-row">'
      +  '<div class="row-title">'
      +    '<b>'+safe(shop.name)+'</b>'
      +    '<p>'+safe(shop.owner_email||"")+' · '+Number(shop.item_count||0)+' 个价格项目</p>'
      +    '<p>创建 '+safe(dateText(shop.created_at))+'</p>'
      +  '</div>'
      +  '<div class="quick">'
      +    '<span class="'+statusClass+'">'+statusText+'</span>'
      +    '<button data-shop-id="'+safe(shop.id)+'" data-shop-active="'+next+'" type="button">'+buttonText+'</button>'
      +  '</div>'
      +'</div>';
  }).join("");
}

async function toggleShop(shopId,nextActive){
  const shop=state.shops.find(s=>s.id===shopId);
  const label=nextActive?"重新公开":"隐藏";

  if(!confirm(label+"「"+(shop?.name||"这家店")+"」？")) return;

  const {data,error}=await supabase.rpc("admin_set_shop_active",{
    p_shop_id:shopId,
    p_active:!!nextActive
  });

  if(error){
    alert("操作失败："+error.message);
    return;
  }

  if(!data?.success){
    alert("没有找到店铺");
    return;
  }

  await loadAll();
}

function renderLogs(){
  if(!state.logs.length){
    $("timeLogList").innerHTML='<div class="empty">还没有手动加时记录。</div>';
    return;
  }

  $("timeLogList").innerHTML=state.logs.map(log=>{
    return ''
      +'<div class="log-row">'
      +  '<div class="row-title">'
      +    '<b>'+safe(log.target_email||"")+'</b>'
      +    '<p>增加 '+Number(log.added_days||0)+' 天 · '+safe(dateText(log.created_at))+'</p>'
      +    '<p>'+safe(dateText(log.old_valid_until))+' → '+safe(dateText(log.new_valid_until))+'</p>'
      +  '</div>'
      +  '<span class="status">+'+Number(log.added_days||0)+'天</span>'
      +'</div>';
  }).join("");
}

function showPanel(name){
  document.querySelectorAll(".panel").forEach(el=>{
    el.classList.toggle("active",el.id==="panel-"+name);
  });

  document.querySelectorAll(".tab").forEach(el=>{
    el.classList.toggle("active",el.dataset.panel===name);
  });
}

function bind(){
  $("adminLoginBtn").addEventListener("click",signIn);
  $("adminPassword").addEventListener("keydown",e=>{
    if(e.key==="Enter") signIn();
  });

  $("adminLogoutBtn").addEventListener("click",signOut);
  $("deniedLogoutBtn").addEventListener("click",signOut);
  $("refreshAdminBtn").addEventListener("click",loadAll);

  document.querySelectorAll(".tab").forEach(btn=>{
    btn.addEventListener("click",()=>showPanel(btn.dataset.panel));
  });

  $("userSearch").addEventListener("input",()=>{
    state.userSearch=$("userSearch").value;
    renderUsers();
  });

  $("clearUserSearch").addEventListener("click",()=>{
    $("userSearch").value="";
    state.userSearch="";
    renderUsers();
  });

  $("userList").addEventListener("click",e=>{
    const btn=e.target.closest("[data-grant-user]");
    if(btn) grantDays(btn.dataset.grantUser,Number(btn.dataset.days));
  });

  $("invitePurpose").addEventListener("change",syncInviteForm);
  $("inviteMode").addEventListener("change",syncInviteForm);
  $("createInviteBtn").addEventListener("click",createInvite);
  $("copyInviteBtn").addEventListener("click",copyInvite);

  $("shopAdminList").addEventListener("click",e=>{
    const btn=e.target.closest("[data-shop-id]");
    if(btn) toggleShop(btn.dataset.shopId,btn.dataset.shopActive==="1");
  });

  syncInviteForm();
}

bind();

const {data}=await supabase.auth.getSession();
await applySession(data.session);

supabase.auth.onAuthStateChange(async(_event,session)=>{
  if(session?.user?.id===state.session?.user?.id) return;
  await applySession(session);
});
