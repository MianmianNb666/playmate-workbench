import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js?v=20260924-prepaidreverse1";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
});

const $ = (id) => document.getElementById(id);
const DEFAULT_TEMPLATE = `消费项目：{项目}
陪陪：{陪陪}
单价：{单价}/{单位}
时长/数量：{时长}
总价：{总价}
累计消费：{累计消费}`;

const state = {
  session:null,
  access:null,
  profile:null,
  savedShopIds:[],
  shopSearch:"",
  shops:[],
  shopId:null,
  categories:[],
  items:[],
  customers:[],
  customerBenefits:[],
  records:[],
  selectedItem:null,
  categoryFilter:"all",
  itemSearch:"",
  historyTotal:0,
  calc:null,
  template:{template_text:DEFAULT_TEMPLATE},
  receiptSettings:null,
  editingItemId:null,
  editingShopId:null,
  editingCustomerId:null,
  customerSearch:"",
  recordBulkMode:false,
  recordBulkSelected:new Set(),
  theme:null
};

const receiptKeys = [
  "showCustomer","showCompanion","showUnitPrice","showQuantity",
  "showTotalSpent","showNote","showTime","showLogo","showFooter"
];

const defaultReceipt = () => ({
  show_customer:true,
  show_companion:true,
  show_unit_price:true,
  show_quantity:true,
  show_total_spent:true,
  show_note:true,
  show_time:true,
  show_logo:true,
  show_footer:true,
  boss_message:"谢谢支持，祝你今天也开心 ♡"
});


let deferredInstallPrompt=null;

function desktopSidebarStorageKey(){
  return "paimini-desktop-sidebar-collapsed";
}

function getDesktopSidebarCollapsed(){
  try{
    return localStorage.getItem(desktopSidebarStorageKey())==="1";
  }catch{
    return false;
  }
}

function applyDesktopSidebarState(){
  const collapsed=getDesktopSidebarCollapsed();
  document.body.classList.toggle("desktop-sidebar-collapsed",collapsed);

  const btn=$("desktopSidebarCollapseBtn");
  if(btn){
    btn.textContent=collapsed?"›":"‹";
    btn.title=collapsed?"展开左侧导航":"收起左侧导航";
    btn.setAttribute("aria-label",collapsed?"展开左侧导航":"收起左侧导航");
  }
}

function toggleDesktopSidebar(){
  const next=!getDesktopSidebarCollapsed();
  try{
    localStorage.setItem(desktopSidebarStorageKey(),next?"1":"0");
  }catch{}
  applyDesktopSidebarState();
}

function mobileNavStorageKey(){
  return "paimini-mobile-nav-mode";
}

function getMobileNavMode(){
  try{
    return localStorage.getItem(mobileNavStorageKey())==="left"?"left":"top";
  }catch{
    return "top";
  }
}

function closeMobileDrawer(){
  document.body.classList.remove("mobile-drawer-open");
}

function openMobileDrawer(){
  if(getMobileNavMode()!=="left") return;
  document.body.classList.add("mobile-drawer-open");
}

function applyMobileNavLayout(){
  const mode=getMobileNavMode();
  document.body.classList.toggle("mobile-nav-left",mode==="left");
  document.body.classList.toggle("mobile-nav-top",mode!=="left");
  if(mode!=="left") closeMobileDrawer();

  document.querySelectorAll("[data-mobile-nav-mode]").forEach(btn=>{
    btn.classList.toggle("active",btn.dataset.mobileNavMode===mode);
  });

  const menuBtn=$("mobileMenuBtn");
  if(menuBtn){
    menuBtn.classList.toggle("show",mode==="left");
  }
}

function setMobileNavMode(mode){
  const next=mode==="left"?"left":"top";
  try{
    localStorage.setItem(mobileNavStorageKey(),next);
  }catch{}
  closeMobileDrawer();
  applyMobileNavLayout();
  toast(next==="left"?"已切换为抽屉侧边栏":"已切换为顶部横向导航");
}


function desktopPrefsKey(){
  return "paimini-desktop-"+(state.session?.user?.id||"guest");
}

function defaultDesktopPrefs(){
  return {name:"派mini",icon:"./icon.svg"};
}

function loadDesktopPrefs(){
  try{
    const saved=JSON.parse(localStorage.getItem(desktopPrefsKey())||"null");
    return {...defaultDesktopPrefs(),...(saved||{})};
  }catch{
    return defaultDesktopPrefs();
  }
}

function updateDesktopManifest(prefs){
  const name=(prefs?.name||"派mini").trim()||"派mini";
  const icon=prefs?.icon||"./icon.svg";

  document.title=name;

  let apple=document.querySelector('link[rel="apple-touch-icon"]');
  if(!apple){
    apple=document.createElement("link");
    apple.rel="apple-touch-icon";
    document.head.appendChild(apple);
  }
  apple.href=icon;

  const manifest={
    name,
    short_name:name.slice(0,12),
    description:"轻量派单计算、价格表、顾客档案与小票工具",
    start_url:"./",
    scope:"./",
    display:"standalone",
    background_color:"#fbf8f2",
    theme_color:state.theme?.accent||"#e8a0b5",
    icons:[{
      src:icon,
      sizes:"any",
      type:icon.startsWith("data:image/png")?"image/png":
           icon.startsWith("data:image/jpeg")?"image/jpeg":
           icon.startsWith("data:image/webp")?"image/webp":"image/svg+xml",
      purpose:"any maskable"
    }]
  };

  const encoded="data:application/manifest+json,"+encodeURIComponent(JSON.stringify(manifest));
  let link=document.querySelector('link[rel="manifest"]');
  if(!link){
    link=document.createElement("link");
    link.rel="manifest";
    document.head.appendChild(link);
  }
  link.href=encoded;
}

function renderDesktopPrefs(){
  const prefs=loadDesktopPrefs();
  const nameInput=$("desktopAppName");
  const iconPreview=$("desktopIconPreview");
  const namePreview=$("desktopNamePreview");
  if(nameInput) nameInput.value=prefs.name||"派mini";
  if(iconPreview) iconPreview.src=prefs.icon||"./icon.svg";
  if(namePreview) namePreview.textContent=prefs.name||"派mini";
  updateDesktopManifest(prefs);
}

function fileToDataUrl(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result||""));
    reader.onerror=()=>reject(reader.error||new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

async function saveDesktopPrefs(){
  const name=($("desktopAppName")?.value||"").trim()||"派mini";
  let prefs=loadDesktopPrefs();
  prefs.name=name;

  const file=$("desktopIconFile")?.files?.[0];
  if(file){
    if(file.size>2*1024*1024){
      toast("桌面图标不能超过 2MB");
      return;
    }
    try{
      prefs.icon=await fileToDataUrl(file);
    }catch(error){
      toast("读取图标失败");
      return;
    }
  }

  localStorage.setItem(desktopPrefsKey(),JSON.stringify(prefs));
  if($("desktopIconFile")) $("desktopIconFile").value="";
  renderDesktopPrefs();
  toast("桌面名称和图标已保存 ♡");
}

function resetDesktopPrefs(){
  localStorage.removeItem(desktopPrefsKey());
  if($("desktopIconFile")) $("desktopIconFile").value="";
  renderDesktopPrefs();
  toast("已恢复派mini默认桌面样式");
}


function isStandaloneMode(){
  return window.matchMedia?.("(display-mode: standalone)")?.matches
    || window.navigator.standalone===true;
}

function installHelpText(){
  const ua=navigator.userAgent||"";
  const isIOS=/iPhone|iPad|iPod/i.test(ua);
  const isWeChat=/MicroMessenger/i.test(ua);

  if(isStandaloneMode()){
    return "已经添加到主屏幕，可以直接从桌面打开。";
  }

  if(isWeChat){
    return "请先点右上角「…」选择用 Safari 打开，然后在 Safari 底部点分享按钮，再选择「添加到主屏幕」。";
  }

  if(isIOS){
    return "在 Safari 底部点分享按钮，再选择「添加到主屏幕」即可。";
  }

  return "浏览器如果支持安装，会直接弹出安装提示；如果没有弹出，请打开浏览器菜单并选择「添加到主屏幕」或「安装应用」。";
}

async function installPaiMini(){
  if(isStandaloneMode()){
    toast("派mini 已经在主屏幕啦 ♡");
    return;
  }

  if(deferredInstallPrompt){
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice.catch(()=>null);
    deferredInstallPrompt=null;
    return;
  }

  const dialog=$("installHelpDialog");
  const text=$("installHelpText");
  if(text) text.textContent=installHelpText();
  if(dialog?.showModal) dialog.showModal();
}

function registerPaiMiniPwa(){
  window.addEventListener("beforeinstallprompt",event=>{
    event.preventDefault();
    deferredInstallPrompt=event;
  });

  window.addEventListener("appinstalled",()=>{
    deferredInstallPrompt=null;
    toast("已添加到主屏幕 ♡");
  });

  if("serviceWorker" in navigator){
    window.addEventListener("load",()=>{
      navigator.serviceWorker.register("./sw.js?v=2",{updateViaCache:"none"})
        .then(reg=>reg.update().catch(()=>{}))
        .catch(error=>{
          console.warn("Service worker registration failed",error);
        });
    });
  }
}

window.paiMiniOrderBridge={
  getContext(){
    return {
      supabase,
      state,
      shop:currentShop(),
      customerName:$("customerName")?.value.trim()||"",
      note:$("calcNote")?.value.trim()||"",
      discountRate:parseDiscountRate($("customerDiscount")?.value)??100
    };
  },
  async refreshAfterSave(){
    await loadRecords();
    renderRecords();
    renderDataSummary();
    await refreshCustomerTotal();
  },
  toast
};

function toast(message){
  const el=$("toast");
  el.textContent=message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer=setTimeout(()=>el.classList.remove("show"),2200);
}

function setAuthHint(text,bad=false){
  $("authHint").textContent=text||"";
  $("authHint").style.color=bad?"var(--bad)":"var(--muted)";
}

function setConnection(text,ok=true){
  const box=$("connectionStatus");
  const label=$("connectionText");
  if(!box||!label) return;

  // 连接正常时不占界面；只有连接异常才提示。
  box.className="connection-pill "+(ok?"good hidden":"bad");
  label.textContent=text;
}

function currentShop(){
  return state.shops.find(s=>s.id===state.shopId) || state.shops[0] || null;
}

function ownsShop(shop=currentShop()){
  return !!shop && !!state.session && shop.user_id===state.session.user.id;
}

function isFavoriteShop(shopId){
  return state.savedShopIds.includes(shopId);
}

function money(value,shop=currentShop()){
  const symbol=shop?.currency_symbol || "¥";
  return symbol + Number(value||0).toFixed(2);
}

function plainNumber(value){
  const n=Number(value||0);
  return Number.isInteger(n)?String(n):n.toFixed(2).replace(/0+$/,"").replace(/\.$/,"");
}

function safe(value){
  return String(value??"")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function dateParts(dateValue=new Date()){
  const d=new Date(dateValue);
  return {
    date:d.toLocaleDateString("zh-CN",{year:"numeric",month:"2-digit",day:"2-digit"}),
    time:d.toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})
  };
}

async function checkAuthService(){
  try{
    const response=await fetch(SUPABASE_URL+"/auth/v1/settings",{
      method:"GET",
      headers:{
        apikey:SUPABASE_PUBLISHABLE_KEY,
        Authorization:"Bearer "+SUPABASE_PUBLISHABLE_KEY
      },
      cache:"no-store"
    });

    if(!response.ok){
      return {
        ok:false,
        reason:"HTTP "+response.status
      };
    }

    const settings=await response.json().catch(()=>({}));
    return {
      ok:true,
      signupEnabled:settings.disable_signup!==true,
      settings
    };
  }catch(error){
    return {
      ok:false,
      reason:String(error?.message||error||"Load failed")
    };
  }
}

async function runAuthDiagnostics(){
  const btn=$("authDiagBtn");
  const out=$("authDiagResult");
  if(!btn||!out) return;
  btn.disabled=true;
  btn.textContent="诊断中…";
  out.classList.remove("hidden");
  out.textContent="网页 ✓ · 正在测试 Supabase…";
  try{
    const result=await checkAuthService();
    if(result.ok){
      out.textContent="网页 ✓ · Supabase ✓ · Auth ✓";
      out.style.color="var(--good, #5f8f72)";
    }else{
      out.textContent="网页 ✓ · Supabase / Auth ✕ · "+(result.reason||"连接失败");
      out.style.color="var(--bad)";
    }
  }catch(error){
    out.textContent="网页 ✓ · Supabase / Auth ✕ · "+String(error?.message||error||"Load failed");
    out.style.color="var(--bad)";
  }finally{
    btn.disabled=false;
    btn.textContent="重新连接诊断";
  }
}

function authNetworkHint(reason){
  const raw=String(reason||"");
  const inApp=/MicroMessenger|WeChat|FBAN|FBAV|Instagram|Line\//i.test(navigator.userAgent||"");
  if(/load failed|failed to fetch|network|fetch/i.test(raw)){
    return inApp
      ? "当前内置浏览器连接不到注册服务。请点右上角「…」后用 Safari / Chrome 打开再注册。"
      : "当前设备连接不到注册服务。请切换网络或用 Safari / Chrome 重试。";
  }
  return raw;
}

async function signUp(){
  const email=$("email").value.trim();
  const password=$("password").value;
  const inviteCode=$("signupInviteCode").value.trim().toUpperCase();

  if(!email || password.length<6){
    setAuthHint("请输入邮箱，密码至少 6 位。",true);
    return;
  }
  if(!inviteCode){
    setAuthHint("注册需要 7 天试用邀请码。",true);
    return;
  }

  // 直接尝试 Supabase 注册。不要让额外的 settings 连通性检查
  // 在部分手机网络上偶发失败后提前拦截真正可用的注册请求。
  setAuthHint("正在验证邀请码并注册…");
  const {data,error}=await supabase.auth.signUp({
    email,
    password,
    options:{
      emailRedirectTo:new URL("./",window.location.href).href,
      data:{invite_code:inviteCode}
    }
  });

  if(error){
    const message=String(error.message||"");
    const friendly=/load failed|failed to fetch|network/i.test(message)
      ? authNetworkHint(message)
      : (/database error|saving new user|invite|邀请码/i.test(message)
        ? "邀请码无效、已使用、已达使用上限或已过期。"
        : message);
    setAuthHint("注册失败："+friendly,true);
    return;
  }

  setAuthHint(data.session
    ? "注册成功，7 天试用已开始 ✓"
    : "注册成功，7 天试用已开通。请先完成邮箱确认。"
  );
}

async function signIn(){
  const email=$("email").value.trim();
  const password=$("password").value;
  if(!email || !password){setAuthHint("请输入邮箱和密码。",true);return}
  setAuthHint("正在登录…");
  const {error}=await supabase.auth.signInWithPassword({email,password});
  if(error){setAuthHint("登录失败："+error.message,true);return}
  setAuthHint("");
}

async function signOut(){
  await supabase.auth.signOut();
}

function formatAccessDate(value){
  if(!value) return "";
  const d=new Date(value);
  return d.toLocaleString("zh-CN",{
    year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit"
  });
}

async function loadAccessStatus(){
  const {data,error}=await supabase.rpc("get_access_status");
  if(error){
    console.error(error);
    state.access=null;
    throw error;
  }
  state.access=data||null;
  renderAccessStatus();
  return state.access;
}

function renderAccessStatus(){
  const access=state.access;
  if(!access) return;

  const active=!!access.has_access;
  const days=Math.max(0,Number(access.days_left||0));
  const badge=$("accessStatusBadge");
  const left=$("accessDaysLeft");
  const until=$("accessValidUntil");

  if(badge){
    badge.textContent=active?"使用中":"已到期";
    badge.classList.toggle("off",!active);
  }
  if(left) left.textContent=active?(days+" 天"):"0 天";
  if(until){
    until.textContent=access.valid_until
      ? "有效期至："+formatAccessDate(access.valid_until)
      : "";
  }

  if($("expiredAccessText")){
    $("expiredAccessText").textContent=access.valid_until
      ? "你的使用期已于 "+formatAccessDate(access.valid_until)+" 到期。输入续费邀请码即可继续使用。"
      : "输入续费邀请码即可继续使用。";
  }
}

function renewalReasonText(reason){
  const map={
    ALREADY_USED_BY_USER:"这个邀请码你已经使用过了。",
    INVALID_OR_USED:"邀请码无效、已使用、已达使用上限或已过期。"
  };
  return map[reason]||"续费失败，请检查邀请码。";
}

async function redeemRenewal(inputId,hintId){
  const input=$(inputId);
  const hint=$(hintId);
  const code=input?.value.trim().toUpperCase()||"";

  if(!code){
    if(hint){
      hint.textContent="请输入续费邀请码。";
      hint.style.color="var(--bad)";
    }
    return;
  }

  if(hint){
    hint.textContent="正在兑换…";
    hint.style.color="var(--muted)";
  }

  const {data,error}=await supabase.rpc("redeem_renewal_code",{p_code:code});
  if(error){
    if(hint){
      hint.textContent="续费失败："+error.message;
      hint.style.color="var(--bad)";
    }
    return;
  }

  if(!data?.success){
    if(hint){
      hint.textContent=renewalReasonText(data?.reason);
      hint.style.color="var(--bad)";
    }
    return;
  }

  input.value="";
  await loadAccessStatus();

  if(hint){
    hint.textContent="续费成功，已增加 "+data.added_days+" 天 ♡";
    hint.style.color="var(--good)";
  }
  toast("续费成功，+"+data.added_days+" 天 ♡");

  if(state.access?.has_access && !$("accessGate").classList.contains("hidden")){
    await applySession(state.session);
  }
}

async function applySession(session){
  state.session=session;
  setConnection("Supabase 已连接 ✓",true);

  if(!session){
    state.access=null;
    $("authGate").classList.remove("hidden");
    $("accessGate").classList.add("hidden");
    $("appRoot").classList.add("hidden");
    return;
  }

  // 先套用本机缓存的个人主页，避免进入后闪一下默认名字/默认文案。
  try{
    const cached=localStorage.getItem("playmate-profile-"+session.user.id);
    if(cached){
      state.profile=JSON.parse(cached);
      renderProfile();
    }
  }catch{}

  $("authGate").classList.add("hidden");
  $("accessGate").classList.add("hidden");
  $("appRoot").classList.add("hidden");

  $("accountEmail").textContent=session.user.email||"";
  $("settingsEmail").textContent=session.user.email||"";

  try{
    const access=await loadAccessStatus();
    if(!access?.has_access){
      $("accessGate").classList.remove("hidden");
      return;
    }
  }catch(error){
    console.error(error);
    toast("使用期限系统还没部署，请先运行邀请码 SQL");
    $("accessGate").classList.remove("hidden");
    if($("expiredHint")){
      $("expiredHint").textContent="使用期限系统尚未部署。";
      $("expiredHint").style.color="var(--bad)";
    }
    return;
  }

  await bootstrap();

  // 数据真正加载好以后再一次性显示整个工作台。
  $("appRoot").classList.remove("hidden");
}

async function refreshAdminEntry(){
  const card=$("adminEntryCard");
  const dataCard=$("adminDataSummaryCard");
  if(!state.session) return;
  try{
    const {data,error}=await supabase.rpc("is_app_admin");
    if(error){
      card?.classList.add("hidden");
      dataCard?.classList.add("hidden");
      return;
    }
    card?.classList.toggle("hidden",!data);
    dataCard?.classList.toggle("hidden",!data);
  }catch{
    card?.classList.add("hidden");
    dataCard?.classList.add("hidden");
  }
}

async function bootstrap(){
  try{
    await loadProfile();
    await loadSavedShops();
    await loadShops();
    if(!state.shops.length) await createStarterShop();
    await loadShops();
    state.shopId=state.shopId && state.shops.some(s=>s.id===state.shopId)
      ? state.shopId
      : state.shops[0]?.id || null;
    populateShopSelectors();
    await loadCurrentShopData();
    await loadRecords();
    renderAll();
    renderProfile();
    renderDesktopPrefs();
    await refreshAdminEntry();
  }catch(error){
    console.error(error);
    toast("数据还没准备好，请确认 V1 SQL 已部署");
  }
}

async function loadProfile(){
  const userId=state.session?.user?.id;
  if(!userId) return;
  const {data,error}=await supabase.from("user_profiles")
    .select("*")
    .eq("user_id",userId)
    .maybeSingle();
  if(error) throw error;

  if(data){
    state.profile=data;
    try{
      localStorage.setItem("playmate-profile-"+userId,JSON.stringify(data));
    }catch{}
    return;
  }

  const emailName=(state.session.user.email||"").split("@")[0] || "今天也要开心";
  const displayName=emailName.slice(0,30);
  const {data:created,error:createError}=await supabase.from("user_profiles")
    .insert({
      user_id:userId,
      display_name:displayName,
      home_message:"今天也要轻松一点，慢慢来就很好 ♡"
    })
    .select().single();
  if(createError) throw createError;
  state.profile=created;
  try{
    localStorage.setItem("playmate-profile-"+userId,JSON.stringify(created));
  }catch{}
}

async function loadSavedShops(){
  const {data,error}=await supabase.from("saved_shops").select("shop_id").order("created_at");
  if(error) throw error;
  state.savedShopIds=(data||[]).map(row=>row.shop_id);
}

function renderAvatar(imgId,fallbackId){
  const img=$(imgId);
  const fallback=$(fallbackId);
  const url=state.profile?.avatar_url || "";
  if(url){
    img.src=url;
    img.classList.remove("hidden");
    fallback.classList.add("hidden");
  }else{
    img.removeAttribute("src");
    img.classList.add("hidden");
    fallback.classList.remove("hidden");
    const name=state.profile?.display_name?.trim() || "";
    fallback.textContent=name ? name.slice(0,1).toUpperCase() : "♡";
  }
}

function renderProfile(){
  if(!state.profile) return;
  const name=state.profile.display_name || "今天也要开心";
  const message=state.profile.home_message || "今天也要轻松一点，慢慢来就很好 ♡";

  $("topDisplayName").innerHTML=`${safe(name)} <i>♡</i>`;
  $("topAccountLine").textContent="派mini · 只属于你的派单主页";
  $("welcomeName").textContent=`今天好呀，${name} ♡`;
  $("welcomeMessage").textContent=message;
  $("profileDisplayName").value=name;
  $("profileHomeMessage").value=message;
  renderAvatar("topAvatarImg","topAvatarFallback");
  renderAvatar("settingsAvatarImg","settingsAvatarFallback");
}

async function saveProfile(){
  if(!state.session) return;
  const displayName=$("profileDisplayName").value.trim() || "今天也要开心";
  const homeMessage=$("profileHomeMessage").value.trim() || "今天也要轻松一点，慢慢来就很好 ♡";
  let avatarUrl=state.profile?.avatar_url || null;
  const file=$("profileAvatarFile").files?.[0];

  try{
    if(file){
      if(file.size>5*1024*1024){
        toast("头像不能超过 5MB");
        return;
      }
      const ext=(file.name.split(".").pop()||"jpg").toLowerCase();
      const path=`${state.session.user.id}/avatar-${Date.now()}.${ext}`;
      const {error:uploadError}=await supabase.storage.from("avatars").upload(path,file,{
        cacheControl:"3600",
        upsert:false
      });
      if(uploadError) throw uploadError;
      const {data:publicData}=supabase.storage.from("avatars").getPublicUrl(path);
      avatarUrl=publicData.publicUrl;
    }

    const payload={
      user_id:state.session.user.id,
      display_name:displayName,
      home_message:homeMessage,
      avatar_url:avatarUrl
    };
    const {data,error}=await supabase.from("user_profiles")
      .upsert(payload,{onConflict:"user_id"})
      .select().single();
    if(error) throw error;
    state.profile=data;
    try{
      localStorage.setItem("playmate-profile-"+state.session.user.id,JSON.stringify(data));
    }catch{}
    $("profileAvatarFile").value="";
    renderProfile();
    toast("我的主页已保存 ♡");
  }catch(error){
    console.error(error);
    toast("保存主页失败："+error.message);
  }
}

async function toggleFavoriteShop(shopId){
  if(isFavoriteShop(shopId)){
    const {error}=await supabase.from("saved_shops")
      .delete().eq("shop_id",shopId);
    if(error){toast("取消常用失败："+error.message);return}
    state.savedShopIds=state.savedShopIds.filter(id=>id!==shopId);
    toast("已取消常用");
  }else{
    const {error}=await supabase.from("saved_shops")
      .insert({shop_id:shopId});
    if(error){toast("添加常用失败："+error.message);return}
    state.savedShopIds.push(shopId);
    toast("已加入常用店铺 ♡");
  }
  populateShopSelectors();
  renderShopList();
}

async function createStarterShop(){
  const {data:shop,error}=await supabase.from("shops")
    .insert({name:"我的小店",currency_symbol:"¥",brand_color:"#f47ea7"})
    .select().single();
  if(error) throw error;

  await supabase.from("price_categories").insert([
    {shop_id:shop.id,name:"语音",sort_order:10},
    {shop_id:shop.id,name:"游戏",sort_order:20},
    {shop_id:shop.id,name:"娱乐",sort_order:30},
    {shop_id:shop.id,name:"其他",sort_order:40}
  ]);
  await supabase.from("report_templates").insert({shop_id:shop.id,template_text:DEFAULT_TEMPLATE});
  await supabase.from("receipt_settings").insert({shop_id:shop.id});
}

async function loadShops(){
  const {data,error}=await supabase.from("shops").select("*").order("created_at");
  if(error) throw error;
  state.shops=data||[];
}

async function loadCurrentShopData(){
  if(!state.shopId) return;
  const [cats,items,customers,customerBenefits,template,receipt]=await Promise.all([
    supabase.from("price_categories").select("*").eq("shop_id",state.shopId).order("sort_order").order("created_at"),
    supabase.from("price_items").select("*").eq("shop_id",state.shopId).order("sort_order").order("created_at"),
    supabase.from("customers").select("*").eq("shop_id",state.shopId).order("name"),
    supabase.from("customer_benefits").select("*").order("updated_at",{ascending:false}),
    supabase.from("report_templates").select("*").eq("shop_id",state.shopId).maybeSingle(),
    supabase.from("receipt_settings").select("*").eq("shop_id",state.shopId).maybeSingle()
  ]);
  for(const result of [cats,items,customers,customerBenefits,template,receipt]) if(result.error) throw result.error;
  state.categories=cats.data||[];
  state.items=items.data||[];
  state.customers=customers.data||[];
  state.customerBenefits=customerBenefits.data||[];
  state.template=template.data||{template_text:DEFAULT_TEMPLATE};
  state.receiptSettings=receipt.data||defaultReceipt();
  state.selectedItem=null;
  state.categoryFilter="all";
  state.historyTotal=0;
  state.calc=null;
}

async function loadRecords(){
  const {data,error}=await supabase.from("consumption_records")
    .select("*")
    .order("occurred_at",{ascending:false})
    .limit(300);
  if(error) throw error;
  state.records=data||[];
}

function populateShopSelectors(){
  const ordered=[...state.shops].sort((a,b)=>{
    const favDiff=Number(isFavoriteShop(b.id))-Number(isFavoriteShop(a.id));
    if(favDiff) return favDiff;
    return String(a.name||"").localeCompare(String(b.name||""),"zh-CN");
  });

  const shopOptions=ordered.map(s=>`<option value="${s.id}">${isFavoriteShop(s.id)?"♡ ":""}${safe(s.name)}</option>`).join("");

  // 小票设置只显示：自己创建的店 + 自己加入常用的店。
  const receiptShops=ordered.filter(shop=>ownsShop(shop) || isFavoriteShop(shop.id));
  const receiptOptions=receiptShops.length
    ? receiptShops.map(s=>`<option value="${s.id}">${ownsShop(s)?"我创建的 · ":""}${isFavoriteShop(s.id)?"♡ ":""}${safe(s.name)}</option>`).join("")
    : '<option value="">还没有加入或创建店铺</option>';

  $("calcShop").innerHTML=shopOptions;
  $("templateShop").innerHTML=shopOptions;
  $("receiptShop").innerHTML=receiptOptions;
  $("customerShop").innerHTML=shopOptions;
  $("recordShopFilter").innerHTML='<option value="all">全部店铺</option>'+shopOptions;

  if(state.shopId){
    $("calcShop").value=state.shopId;
    $("templateShop").value=state.shopId;
    $("customerShop").value=state.shopId;

    const receiptShopId=receiptShops.some(s=>s.id===state.shopId)
      ? state.shopId
      : (receiptShops[0]?.id||"");
    $("receiptShop").value=receiptShopId;
  }
}

function renderAll(){
  renderCategories();
  renderItems();
  renderCustomerList();
  renderPriceManager();
  renderShopList();
  renderTemplate();
  renderReceiptSettings();
  renderRecords();
  renderCustomerProfiles();
  renderDataSummary();
  renderThemeControls();
  resetCalculatorVisual();
  applyPriceEditPermissions();
  renderProfile();
}

function renderCategories(){
  $("categoryChips").innerHTML=[
    `<button class="chip ${state.categoryFilter==="all"?"active":""}" data-category="all" type="button">全部</button>`,
    ...state.categories.filter(c=>c.is_active!==false).map(c=>
      `<button class="chip ${state.categoryFilter===c.id?"active":""}" data-category="${c.id}" type="button">${safe(c.name)}</button>`
    )
  ].join("");

  const canEdit=ownsShop();
  $("categoryManager").innerHTML=state.categories.length
    ? state.categories.map(c=>`
      <div class="manager-row">
        <div><b>${safe(c.name)}</b></div>
        <div class="row-actions">
          ${canEdit?`<button class="tiny-btn danger" data-delete-category="${c.id}" type="button">删除</button>`:""}
        </div>
      </div>`).join("")
    : '<div class="empty-state">还没有分类。</div>';

  $("priceCategory").innerHTML='<option value="">未分类</option>'+
    state.categories.map(c=>`<option value="${c.id}">${safe(c.name)}</option>`).join("");
}

function filteredItems(){
  const q=state.itemSearch.trim().toLowerCase();
  return state.items.filter(item=>{
    if(item.is_active===false) return false;
    if(state.categoryFilter!=="all" && item.category_id!==state.categoryFilter) return false;
    if(q && !String(item.name||"").toLowerCase().includes(q)) return false;
    return true;
  });
}

function renderItems(){
  const items=filteredItems();
  $("emptyItems").classList.toggle("hidden",items.length>0);
  if($("calcItemList")){
    $("calcItemList").innerHTML=state.items
      .filter(item=>item.is_active!==false)
      .map(item=>`<option value="${safe(item.name)}">${money(item.unit_price)} / ${safe(item.unit_label||"次")}</option>`)
      .join("");
  }
  $("itemWall").innerHTML=items.map(item=>{
    const category=state.categories.find(c=>c.id===item.category_id)?.name||"未分类";
    return `
      <button class="item-card ${state.selectedItem?.id===item.id?"active":""}" data-item="${item.id}" type="button">
        <b>${safe(item.name)}</b>
        <span>${money(item.unit_price)} / ${safe(item.unit_label)}</span>
        <small>${safe(category)}${item.unit_minutes?" · "+item.unit_minutes+"分钟/单位":""}</small>
      </button>`;
  }).join("");
}

function renderCustomerList(){
  $("customerList").innerHTML=state.customers.map(c=>`<option value="${safe(c.name)}"></option>`).join("");
}

function customerStats(customer){
  const records=state.records.filter(r=>
    r.shop_id===state.shopId &&
    (
      r.customer_id===customer.id ||
      String(r.customer_name_snapshot||"").trim()===String(customer.name||"").trim()
    )
  );

  const total=records.reduce((sum,r)=>sum+Number(r.amount||0),0);
  const latest=records[0]||null;
  return {records,total,latest};
}

function renderCustomerProfiles(){
  const list=$("customerProfileList");
  const empty=$("emptyCustomerProfiles");
  if(!list||!empty) return;

  const q=(state.customerSearch||"").trim().toLowerCase();
  const customers=state.customers.filter(customer=>{
    if(!q) return true;
    return [customer.name,customer.contact,customer.notes]
      .some(v=>String(v||"").toLowerCase().includes(q));
  });

  empty.classList.toggle("hidden",customers.length>0);

  list.innerHTML=customers.map(customer=>{
    const stats=customerStats(customer);
    const rate=Number(customer.discount_rate??100);
    const latest=stats.latest?dateParts(stats.latest.occurred_at).date:"暂无";
    return `
      <div class="customer-profile-card">
        <div class="customer-profile-head">
          <div>
            <b>${safe(customer.name)}</b>
            <p>${safe(customer.contact||"未填写联系方式")}</p>
          </div>
          <span class="customer-discount-tag">${safe(discountLabel(rate))}</span>
        </div>
        <div class="customer-profile-stats">
          <div><span>累计消费</span><strong>${money(stats.total)}</strong></div>
          <div><span>流水</span><strong>${stats.records.length}</strong></div>
          <div><span>最近</span><strong>${safe(latest)}</strong></div>
        </div>
        ${customer.notes?`<p class="customer-profile-notes">${safe(customer.notes)}</p>`:""}
        <div class="row-actions">
          <button class="tiny-btn" data-use-customer="${customer.id}" type="button">去派单</button>
          <button class="tiny-btn" data-edit-customer="${customer.id}" type="button">编辑</button>
          <button class="tiny-btn danger" data-delete-customer="${customer.id}" type="button">删除</button>
        </div>
      </div>
    `;
  }).join("");
}

function resetCustomerProfileForm(){
  state.editingCustomerId=null;
  $("customerProfileFormTitle").textContent="建立顾客档案";
  $("customerProfileName").value="";
  $("customerProfileContact").value="";
  $("customerProfileDiscount").value="";
  $("customerProfileNotes").value="";
  $("cancelCustomerProfileBtn").classList.add("hidden");
}

function editCustomerProfile(id){
  const customer=state.customers.find(c=>c.id===id);
  if(!customer) return;
  state.editingCustomerId=id;
  $("customerProfileFormTitle").textContent="编辑顾客档案";
  $("customerProfileName").value=customer.name||"";
  $("customerProfileContact").value=customer.contact||"";
  const rate=Number(customer.discount_rate??100);
  $("customerProfileDiscount").value=rate>=100?"":discountLabel(rate);
  $("customerProfileNotes").value=customer.notes||"";
  $("cancelCustomerProfileBtn").classList.remove("hidden");
  $("customerProfileName").focus();
}

async function saveCustomerProfile(){
  const name=$("customerProfileName").value.trim();
  const contact=$("customerProfileContact").value.trim();
  const notes=$("customerProfileNotes").value.trim();
  const discountRate=parseDiscountRate($("customerProfileDiscount").value);

  if(!state.shopId){toast("先选择店铺");return}
  if(!name){toast("先填写顾客昵称");return}
  if(discountRate===null){toast("折扣格式例如 9折 / 8.5折 / 90%");return}

  const duplicate=state.customers.find(c=>
    c.id!==state.editingCustomerId &&
    String(c.name||"").trim().toLowerCase()===name.toLowerCase()
  );
  if(duplicate){
    toast("这个店铺已经有同名顾客档案");
    return;
  }

  const payload={
    shop_id:state.shopId,
    name,
    contact:contact||null,
    notes:notes||null,
    discount_rate:discountRate
  };

  let result;
  if(state.editingCustomerId){
    result=await supabase.from("customers")
      .update(payload)
      .eq("id",state.editingCustomerId)
      .select().single();
  }else{
    result=await supabase.from("customers")
      .insert(payload)
      .select().single();
  }

  if(result.error){
    toast("保存失败："+result.error.message);
    return;
  }

  if(state.editingCustomerId){
    state.customers=state.customers.map(c=>c.id===result.data.id?result.data:c);
  }else{
    state.customers.push(result.data);
    state.customers.sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),"zh-CN"));
  }

  resetCustomerProfileForm();
  renderCustomerList();
  renderCustomerProfiles();
  toast("顾客档案已保存 ♡");
}

async function deleteCustomerProfile(id){
  const customer=state.customers.find(c=>c.id===id);
  if(!customer) return;

  const related=state.records.filter(r=>
    r.customer_id===id ||
    String(r.customer_name_snapshot||"").trim()===String(customer.name||"").trim()
  );
  const total=related.reduce((sum,r)=>sum+Number(r.amount||0),0);

  let deleteRecords=false;
  if(related.length){
    deleteRecords=confirm(
      "删除「"+customer.name+"」的顾客档案？\n\n"+
      "这个老板还有 "+related.length+" 条消费记录，共 ¥"+total.toFixed(2)+"。\n\n"+
      "【确定】档案 + 全部消费记录一起删除\n"+
      "【取消】进入下一步，可选择只删档案"
    );
    if(!deleteRecords){
      if(!confirm("仅删除「"+customer.name+"」的顾客档案，并保留全部消费记录？")) return;
    }else{
      if(!confirm("再次确认：将永久删除该老板档案和全部 "+related.length+" 条消费记录。\n历史预存余额 / 权益不会退回。")) return;
    }
  }else{
    if(!confirm("删除「"+customer.name+"」的顾客档案？这个老板目前没有消费记录。")) return;
  }

  if(deleteRecords){
    const ids=[...new Set(related.map(r=>r.id))];
    if(ids.length){
      const {error:recordError}=await supabase.from("consumption_records").delete().in("id",ids);
      if(recordError){toast("消费记录删除失败："+recordError.message);return}
    }
  }

  const {error}=await supabase.from("customers").delete().eq("id",id);
  if(error){
    toast("档案删除失败："+error.message);
    await loadRecords();
    renderRecords();
    return;
  }

  state.customers=state.customers.filter(c=>c.id!==id);
  if(state.editingCustomerId===id) resetCustomerProfileForm();
  await loadRecords();
  renderRecords();
  renderCustomerList();
  renderCustomerProfiles();
  renderDataSummary();
  toast(deleteRecords?"顾客档案和全部消费记录已删除 ♡":"顾客档案已删除，消费记录已保留");
}

async function useCustomerProfile(id){
  const customer=state.customers.find(c=>c.id===id);
  if(!customer) return;
  $("customerName").value=customer.name||"";
  const rate=Number(customer.discount_rate??100);
  $("customerDiscount").value=rate>=100?"":discountLabel(rate);
  await refreshCustomerTotal();
  showPage("calculator");
  window.scrollTo({top:0,behavior:"smooth"});
}

const THEME_PRESETS={
  beige:{bg:"#fbf8f2",accent:"#e8a0b5",paper:"#ffffff",ink:"#514945"},
  pink:{bg:"#fbf8f2",accent:"#ef7fa7",paper:"#ffffff",ink:"#514945"},
  mint:{bg:"#fbf8f2",accent:"#7fb89a",paper:"#ffffff",ink:"#514945"},
  blue:{bg:"#fbf8f2",accent:"#7ea6cf",paper:"#ffffff",ink:"#514945"},
  lavender:{bg:"#fbf8f2",accent:"#a28cc8",paper:"#ffffff",ink:"#514945"}
};

function applyTheme(theme){
  const base={...THEME_PRESETS.beige,...(theme||{})};
  state.theme=base;
  const root=document.documentElement;
  root.style.setProperty("--bg",base.bg);
  root.style.setProperty("--paper",base.paper);
  root.style.setProperty("--ink",base.ink);
  root.style.setProperty("--pink",base.accent);
  root.style.setProperty("--pink-deep",`color-mix(in srgb, ${base.accent} 82%, #5a3040)`);
  root.style.setProperty("--pink-soft",`color-mix(in srgb, ${base.accent} 14%, ${base.paper})`);
  root.style.setProperty("--line",`color-mix(in srgb, ${base.accent} 24%, ${base.bg})`);
  root.style.setProperty("--muted",`color-mix(in srgb, ${base.ink} 62%, ${base.bg})`);
}

function loadTheme(){
  try{
    let saved=JSON.parse(localStorage.getItem("paimini-theme")||"null");

    // 旧版预设会给整页染色。现在预设只换强调色，
    // 页面保持淡米白，所有主要内容框保持白色。
    const oldPresetBackgrounds=new Set([
      "#f6f0e7","#fff6fa","#f2f8f3","#f2f6fb","#f5f2fa"
    ]);
    const oldPresetPapers=new Set([
      "#fffdf9","#fffefb","#fffefe","#ffffff"
    ]);

    if(saved
      && oldPresetBackgrounds.has(String(saved.bg||"").toLowerCase())
      && oldPresetPapers.has(String(saved.paper||"").toLowerCase())){
      saved={
        bg:"#fbf8f2",
        accent:saved.accent||THEME_PRESETS.beige.accent,
        paper:"#ffffff",
        ink:"#514945"
      };
      localStorage.setItem("paimini-theme",JSON.stringify(saved));
    }

    applyTheme(saved||THEME_PRESETS.beige);
  }catch{
    applyTheme(THEME_PRESETS.beige);
  }
}

function renderThemeControls(){
  if(!$("themeBg")||!state.theme) return;
  $("themeBg").value=state.theme.bg;
  $("themeAccent").value=state.theme.accent;
  $("themePaper").value=state.theme.paper;
  $("themeInk").value=state.theme.ink;

  document.querySelectorAll("[data-theme-preset]").forEach(btn=>{
    const preset=THEME_PRESETS[btn.dataset.themePreset];
    const active=preset &&
      preset.bg===state.theme.bg &&
      preset.accent===state.theme.accent &&
      preset.paper===state.theme.paper &&
      preset.ink===state.theme.ink;
    btn.classList.toggle("active",active);
  });
}

function themeFromControls(){
  return {
    bg:$("themeBg").value,
    accent:$("themeAccent").value,
    paper:$("themePaper").value,
    ink:$("themeInk").value
  };
}

function previewThemeFromControls(){
  applyTheme(themeFromControls());
  renderThemeControls();
}

function saveTheme(){
  const theme=themeFromControls();
  applyTheme(theme);
  localStorage.setItem("paimini-theme",JSON.stringify(theme));
  renderThemeControls();
  toast("配色已保存 ♡");
}

function useThemePreset(name,save=true){
  const preset=THEME_PRESETS[name]||THEME_PRESETS.beige;
  applyTheme(preset);
  if(save) localStorage.setItem("paimini-theme",JSON.stringify(preset));
  renderThemeControls();
}

function renderPriceManager(){
  const canEdit=ownsShop();
  $("priceItemList").innerHTML=state.items.length
    ? state.items.map(item=>{
      const category=state.categories.find(c=>c.id===item.category_id)?.name||"未分类";
      return `
        <div class="price-row">
          <div class="price-top">
            <div><b>${safe(item.name)}</b><p>${safe(category)} · ${safe(item.unit_label)}${item.unit_minutes?" · "+item.unit_minutes+"分钟":""}</p></div>
            <strong>${money(item.unit_price)}</strong>
          </div>
          <p>${safe(item.notes||"暂无备注")}</p>
          <span class="status-tag ${item.is_active===false?"off":""}">${item.is_active===false?"已停用":"已启用"}</span>
          <div class="row-actions">
            ${canEdit?`
              <button class="tiny-btn" data-edit-item="${item.id}" type="button">编辑</button>
              <button class="tiny-btn" data-toggle-item="${item.id}" type="button">${item.is_active===false?"启用":"停用"}</button>
              <button class="tiny-btn danger" data-delete-item="${item.id}" type="button">删除</button>
            `:`<span class="status-tag">共享价格 · 只读</span>`}
          </div>
        </div>`;
    }).join("")
    : '<div class="empty-state">价格表还是空的，先新增一个项目吧。</div>';
}

function renderShopList(){
  const q=(state.shopSearch||"").trim().toLowerCase();
  const shops=[...state.shops]
    .filter(shop=>!q || String(shop.name||"").toLowerCase().includes(q))
    .sort((a,b)=>{
      const favDiff=Number(isFavoriteShop(b.id))-Number(isFavoriteShop(a.id));
      if(favDiff) return favDiff;
      return String(a.name||"").localeCompare(String(b.name||""),"zh-CN");
    });

  $("shopList").innerHTML=shops.length ? shops.map(shop=>{
    const mine=ownsShop(shop);
    const favorite=isFavoriteShop(shop.id);
    return `
      <div class="shop-card ${favorite?"favorite":""}">
        <div class="shop-card-top">
          <div>
            <div class="shop-color" style="background:${safe(shop.brand_color||"#f47ea7")}"></div>
            <b>${safe(shop.name)}</b>
          </div>
          <div>
            ${mine?'<span class="shop-owner-tag">我创建的</span>':""}
            ${favorite?'<span class="shop-favorite-tag">常用 ♡</span>':""}
          </div>
        </div>
        <p>${safe(shop.currency_symbol||"¥")} · ${shop.is_active===false?"停用":"公开价格表"}</p>
        <p>${safe(shop.footer_text||"")}</p>
        <div class="row-actions">
          <button class="tiny-btn" data-use-shop="${shop.id}" type="button">用这个店派单</button>
          <button class="tiny-btn" data-favorite-shop="${shop.id}" type="button">${favorite?"取消常用":"加入常用"}</button>
          ${mine?`
            <button class="tiny-btn" data-edit-shop="${shop.id}" type="button">编辑店铺</button>
            <button class="tiny-btn danger" data-delete-shop="${shop.id}" type="button">删除</button>
          `:""}
        </div>
      </div>
    `;
  }).join("") : '<div class="empty-state">没有找到这个店。</div>';
}

function renderTemplate(){
  if($("templateShop").value!==state.shopId) return;
  $("reportTemplateText").value=state.template?.template_text || DEFAULT_TEMPLATE;
}

function receiptSettingValue(key){
  const dbKey=key.replace(/[A-Z]/g,m=>"_"+m.toLowerCase());
  return state.receiptSettings?.[dbKey] ?? true;
}

function renderReceiptSettings(){
  if($("receiptShop").value!==state.shopId) return;
  receiptKeys.forEach(key=>$(key).checked=receiptSettingValue(key));
  if($("bossMessage")) $("bossMessage").value=state.receiptSettings?.boss_message || "谢谢支持，祝你今天也开心 ♡";
  renderInlineReceipt();
}

function renderDataSummary(){
  $("dataSummary").textContent=`${state.shops.length} 个可见店铺 · ${state.savedShopIds.length} 个常用店铺 · ${state.items.length} 个当前店铺项目 · ${state.customers.length} 位自己的老板 · ${state.records.length} 条自己的消费记录`;
}

function applyPriceEditPermissions(){
  const canEdit=ownsShop();
  const ids=["newCategoryName","addCategoryBtn","priceName","priceCategory","priceValue","priceUnitLabel","priceUnitMinutes","priceSort","priceManual","priceNotes","savePriceItemBtn"];
  ids.forEach(id=>{
    const el=$(id);
    if(el) el.disabled=!canEdit;
  });
  $("itemFormTitle").textContent=canEdit
    ? (state.editingItemId?"编辑价格项目":"新增价格项目")
    : "共享价格表（只读）";
}

function resetCalculatorVisual(){
  state.selectedItem=null;
  $("calcItemName").value="";
  $("calcUnitPrice").value="";
  $("calcUnitPrice").readOnly=false;
  $("calcUnitLabel").value="";
  $("calcUnitLabel").readOnly=false;
  $("calcUnitMinutes").value="";
  $("durationInput").value="";
  $("customerDiscount").value="";
  $("discountHelp").textContent="已有老板会自动带出保存的折扣";
  $("durationHelp").textContent="已有项目自动识别；手动项目按你填写的单位计算";
  $("selectedItemText").textContent="可以选价格表项目，也可以直接手填";
  $("currencyPrefix").textContent=currentShop()?.currency_symbol||"¥";
  $("calcTotal").textContent=money(0);
  $("calcFormula").textContent="等待输入项目和价格";
  $("historyTotal").textContent=money(state.historyTotal);
  $("newTotal").textContent=money(state.historyTotal);
}

function inferMinutesFromUnit(raw){
  const unit=String(raw||"").trim().toLowerCase().replaceAll(" ","");
  if(["半","半小时","0.5h","0.5小时"].includes(unit)) return 30;
  if(["小时","h","hr","hour"].includes(unit)) return 60;
  const m=unit.match(/^(\d+(?:\.\d+)?)(?:分钟|分|min|mins)$/i);
  return m?Number(m[1]):null;
}

function effectiveCalcItem(){
  const name=$("calcItemName").value.trim();
  if(!name) return null;
  const unitLabel=$("calcUnitLabel").value.trim()||"次";
  const rawMinutes=$("calcUnitMinutes").value.trim();
  const unitMinutes=rawMinutes!=="" ? Number(rawMinutes) : inferMinutesFromUnit(unitLabel);
  return {
    id:state.selectedItem?.id||null,
    name,
    unit_label:unitLabel,
    unit_minutes:Number.isFinite(unitMinutes) && unitMinutes>0 ? unitMinutes : null
  };
}

function syncExistingItemByName(){
  const name=$("calcItemName").value.trim();
  const item=state.items.find(x=>x.is_active!==false && String(x.name||"").trim()===name);
  if(!item){
    state.selectedItem=null;
    $("selectedItemText").textContent=name
      ? "手动项目 · 不会自动加入价格表"
      : "可以选价格表项目，也可以直接手填";
    renderItems();
    calculate();
    return;
  }
  selectItem(item.id,{preserveItemName:true});
}

function selectItem(id,options={}){
  const item=state.items.find(x=>x.id===id);
  if(!item) return;
  state.selectedItem=item;
  if(!options.preserveItemName) $("calcItemName").value=item.name||"";
  $("calcUnitPrice").value=Number(item.unit_price||0);
  $("calcUnitPrice").readOnly=false;
  $("calcUnitLabel").value=item.unit_label||"次";
  $("calcUnitLabel").readOnly=false;
  $("calcUnitMinutes").value=item.unit_minutes||"";
  $("selectedItemText").textContent=`${item.name} · 已从价格表自动带出 ${money(item.unit_price)} / ${item.unit_label}`;
  $("durationInput").placeholder=item.unit_minutes?"例如 3H / 90m / 6":"输入数量，例如 3";
  $("durationHelp").textContent=item.unit_minutes
    ? `每 1 ${item.unit_label} = ${item.unit_minutes} 分钟，支持输入 3H / 90m`
    : `按「${item.unit_label||"次"}」计数`;
  renderItems();
  calculate();
}

function parseDiscountRate(raw){
  let text=String(raw||"").trim().toLowerCase();
  if(!text) return 100;
  if(["无","无折扣","原价","10折","100%"].includes(text)) return 100;

  let value;
  if(text.endsWith("折")){
    value=parseFloat(text.replace("折",""))*10;
  }else if(text.endsWith("%")){
    value=parseFloat(text.replace("%",""));
  }else{
    value=parseFloat(text);
    if(value>0 && value<=10) value*=10;
  }

  if(!Number.isFinite(value)) return null;
  return Math.max(0,Math.min(100,value));
}

function discountLabel(rate){
  const n=Number(rate);
  if(!Number.isFinite(n)||n>=100) return "10折";
  const fold=n/10;
  return `${plainNumber(fold)}折`;
}

function parseMeasure(){
  const item=effectiveCalcItem();
  if(!item) return null;
  const raw=$("durationInput").value.trim();
  if(!raw) return null;

  let quantity=0;
  let minutes=null;

  if(item.unit_minutes){
    const normalized=raw.toLowerCase().replaceAll(" ","");
    if(/小时|h$/.test(normalized)){
      const num=parseFloat(normalized.replace(/小时|h$/g,""));
      if(!Number.isFinite(num)) return null;
      minutes=num*60;
      quantity=minutes/Number(item.unit_minutes);
    }else if(/分钟|m$/.test(normalized)){
      const num=parseFloat(normalized.replace(/分钟|m$/g,""));
      if(!Number.isFinite(num)) return null;
      minutes=num;
      quantity=minutes/Number(item.unit_minutes);
    }else{
      const num=parseFloat(normalized);
      if(!Number.isFinite(num)) return null;
      quantity=num;
      minutes=quantity*Number(item.unit_minutes);
    }
  }else{
    const num=parseFloat(raw);
    if(!Number.isFinite(num)) return null;
    quantity=num;
  }

  if(quantity<0) return null;
  return {raw,quantity,minutes};
}

function calculate(){
  const item=effectiveCalcItem();
  const measure=parseMeasure();
  const priceText=$("calcUnitPrice").value.trim();
  const unitPrice=priceText===""?NaN:Number(priceText);
  const discountRate=parseDiscountRate($("customerDiscount").value);

  if(!item || !measure || !Number.isFinite(unitPrice) || unitPrice<0 || discountRate===null){
    state.calc=null;
    $("calcTotal").textContent=money(0);
    $("calcFormula").textContent=discountRate===null
      ? "折扣格式例如：9折 / 8.5折 / 90%"
      : "输入项目、单价和时长 / 数量后自动计算";
    $("newTotal").textContent=money(state.historyTotal);
    return null;
  }

  const originalTotal=unitPrice*measure.quantity;
  const total=originalTotal*(discountRate/100);
  state.calc={unitPrice,originalTotal,discountRate,total,...measure};

  $("calcTotal").textContent=money(total);
  $("calcFormula").textContent=discountRate<100
    ? `${plainNumber(unitPrice)} × ${plainNumber(measure.quantity)} = ${plainNumber(originalTotal)} · ${discountLabel(discountRate)} → ${plainNumber(total)}`
    : `${plainNumber(unitPrice)} × ${plainNumber(measure.quantity)} = ${plainNumber(total)}`;
  $("newTotal").textContent=money(state.historyTotal+total);
  return state.calc;
}

async function refreshCustomerTotal(){
  const name=$("customerName").value.trim();
  const customer=state.customers.find(c=>c.name===name);

  if(!customer){
    state.historyTotal=0;
    $("customerDiscount").value="";
    $("discountHelp").textContent="新老板默认 10 折，保存记录时会记住这里的折扣";
  }else{
    const {data,error}=await supabase.from("consumption_records")
      .select("amount")
      .eq("customer_id",customer.id);
    if(error){console.error(error);return}
    state.historyTotal=(data||[]).reduce((sum,r)=>sum+Number(r.amount||0),0);
    const rate=Number(customer.discount_rate??100);
    $("customerDiscount").value=rate>=100?"":discountLabel(rate);
    $("discountHelp").textContent=rate>=100
      ? "这个老板当前是 10 折"
      : `已自动带出这个老板的 ${discountLabel(rate)}`;
  }

  $("historyTotal").textContent=money(state.historyTotal);
  calculate();
}

function validateCalc(){
  const customer=$("customerName").value.trim();
  const companion=$("companionName").value.trim();
  const item=effectiveCalcItem();
  const calc=calculate();

  if(!state.shopId){toast("请先选择店铺");return null}
  if(!customer){toast("先填写老板 / 顾客");return null}
  if(!item){toast("先填写项目名称");return null}
  if($("calcUnitPrice").value.trim()==="" || !Number.isFinite(Number($("calcUnitPrice").value))){toast("先填写单价");return null}
  if(!companion){toast("先填写陪陪");return null}
  if(parseDiscountRate($("customerDiscount").value)===null){toast("折扣格式请填 9折 / 8.5折 / 90%");return null}
  if(!calc){toast("请输入有效的时长 / 数量");return null}

  return {
    customer,
    companion,
    item,
    calc,
    note:$("calcNote").value.trim()
  };
}

function reportData(){
  const valid=validateCalc();
  if(!valid) return null;
  const shop=currentShop();
  const parts=dateParts();

  return {
    shop,
    customer:valid.customer,
    companion:valid.companion,
    item:valid.item,
    note:valid.note,
    measure:valid.calc.raw,
    quantity:valid.calc.quantity,
    unitPrice:valid.calc.unitPrice,
    originalTotal:valid.calc.originalTotal,
    discountRate:valid.calc.discountRate,
    total:valid.calc.total,
    history:state.historyTotal,
    newTotal:state.historyTotal+valid.calc.total,
    date:parts.date,
    time:parts.time
  };
}

function buildReport(data){
  if(!data) return "";
  const vars={
    "{老板}":data.customer,
    "{项目}":data.item.name,
    "{陪陪}":data.companion,
    "{单价}":plainNumber(data.unitPrice),
    "{单位}":data.item.unit_label,
    "{时长}":data.measure,
    "{数量}":plainNumber(data.quantity),
    "{原价}":plainNumber(data.originalTotal??data.total),
    "{折扣}":discountLabel(data.discountRate??100),
    "{总价}":plainNumber(data.total),
    "{历史累计}":plainNumber(data.history),
    "{累计消费}":plainNumber(data.newTotal),
    "{备注}":data.note||"",
    "{日期}":data.date,
    "{时间}":data.time
  };
  let text=state.template?.template_text || DEFAULT_TEMPLATE;
  Object.entries(vars).forEach(([key,value])=>{text=text.split(key).join(String(value))});
  return text;
}

async function copyText(text){
  try{
    await navigator.clipboard.writeText(text);
    toast("已复制 ♡");
  }catch{
    window.prompt("复制下面内容：",text);
  }
}

async function getOrCreateCustomer(name,discountRate=100){
  let customer=state.customers.find(c=>c.name===name);

  if(customer){
    if(Number(customer.discount_rate??100)!==Number(discountRate)){
      let result=await supabase.from("customers")
        .update({discount_rate:discountRate})
        .eq("id",customer.id)
        .select().single();

      // 兼容尚未补 discount_rate 字段的旧数据库。
      if(result.error && /discount_rate|column/i.test(String(result.error.message||""))){
        result={data:customer,error:null};
      }
      if(result.error) throw result.error;
      customer=result.data||customer;
      state.customers=state.customers.map(c=>c.id===customer.id?customer:c);
    }
    return customer;
  }

  let result=await supabase.from("customers")
    .insert({
      shop_id:state.shopId,
      name,
      discount_rate:discountRate
    })
    .select().single();

  // 兼容旧数据库：没有折扣字段时仍然允许保存老板和消费记录。
  if(result.error && /discount_rate|column/i.test(String(result.error.message||""))){
    result=await supabase.from("customers")
      .insert({shop_id:state.shopId,name})
      .select().single();
  }

  if(result.error) throw result.error;
  state.customers.push(result.data);
  renderCustomerList();
  return result.data;
}

async function saveRecord(){
  const data=reportData();
  if(!data) return;

  const button=$("saveRecordBtn");
  const oldText=button?.textContent;
  if(button){
    button.disabled=true;
    button.textContent="保存中…";
  }

  try{
    let customer=null;

    // 顾客档案失败时，不阻断整单保存。
    try{
      customer=await getOrCreateCustomer(data.customer,data.discountRate);
    }catch(customerError){
      console.warn("customer save skipped",customerError);
      const {data:existing}=await supabase.from("customers")
        .select("*")
        .eq("shop_id",state.shopId)
        .eq("name",data.customer)
        .maybeSingle();
      customer=existing||null;
    }

    let previousRowsResult;
    if(customer?.id){
      previousRowsResult=await supabase.from("consumption_records")
        .select("amount")
        .eq("customer_id",customer.id);
    }else{
      previousRowsResult=await supabase.from("consumption_records")
        .select("amount")
        .eq("shop_id",state.shopId)
        .eq("customer_name_snapshot",data.customer);
    }

    if(previousRowsResult.error) throw previousRowsResult.error;
    const previous=(previousRowsResult.data||[]).reduce((sum,r)=>sum+Number(r.amount||0),0);
    const report=buildReport({...data,history:previous,newTotal:previous+data.total});

    const basePayload={
      shop_id:state.shopId,
      customer_id:customer?.id||null,
      item_id:data.item.id||null,
      customer_name_snapshot:data.customer,
      // 线上 consumption_records 仍有旧版必填 item_name。
      // 两个字段同时写，兼容旧表和新版快照字段。
      item_name:data.item.name,
      item_name_snapshot:data.item.name,
      companion_name:data.companion,
      unit_price_snapshot:data.unitPrice,
      // 兼容旧表仍为 NOT NULL 的 unit_label。
      unit_label:data.item.unit_label||"次",
      unit_label_snapshot:data.item.unit_label||"次",
      unit_minutes_snapshot:data.item.unit_minutes,
      quantity:data.quantity,
      duration_input:data.measure,
      amount:data.total,
      previous_total:previous,
      new_total:previous+data.total,
      note:data.note,
      report_text:report
    };

    let result=await supabase.from("consumption_records").insert({
      ...basePayload,
      original_amount:data.originalTotal,
      discount_rate_snapshot:data.discountRate
    }).select("id").single();

    // 兼容没有折扣字段的旧数据库。
    if(result.error && /original_amount|discount_rate_snapshot|schema cache|column/i.test(String(result.error.message||""))){
      result=await supabase.from("consumption_records")
        .insert(basePayload)
        .select("id")
        .single();
    }

    // 如果历史版本的 item/customer 外键数据有问题，再降级为纯快照记录。
    if(result.error && /foreign key|violates.*constraint|customer_id|item_id/i.test(String(result.error.message||""))){
      const snapshotOnly={...basePayload,customer_id:null,item_id:null};
      result=await supabase.from("consumption_records")
        .insert(snapshotOnly)
        .select("id")
        .single();
    }

    if(result.error) throw result.error;

    state.historyTotal=previous+data.total;
    await loadRecords();
    renderRecords();
    renderDataSummary();
    $("historyTotal").textContent=money(state.historyTotal);
    calculate();
    toast("消费记录已保存 ♡");
  }catch(error){
    console.error("saveRecord failed",error);
    const detail=String(error?.message||error||"未知错误");
    toast("保存失败："+detail);
    alert("这单没有保存成功。\n\n原因："+detail);
  }finally{
    if(button){
      button.disabled=false;
      button.textContent=oldText||"保存记录";
    }
  }
}
async function saveUnifiedRecord(){
  const settlement=window.paiMiniSettlementSelection||{};
  const useSettlement=!!settlement.use_prepaid && Number(settlement.prepaid_amount||0)>0
    || (Array.isArray(settlement.benefits_used) && settlement.benefits_used.length>0);

  if(useSettlement){
    const saver=window.paiMiniAtomicSettlement?.save;
    if(typeof saver!=="function"){
      toast("结算模块还没准备好，请稍后再点一次");
      return;
    }
    await saver();
    return;
  }

  const staged=window.paiMiniMultiOrder?.lines;
  if(Array.isArray(staged) && staged.length){
    const saver=window.paiMiniMultiOrder?.save;
    if(typeof saver!=="function"){
      toast("整单保存模块还没准备好，请稍后再点一次");
      return;
    }
    await saver();
    return;
  }

  await saveRecord();
}

function currentReceiptSettingsFromControls(){
  return {
    show_customer:$("showCustomer").checked,
    show_companion:$("showCompanion").checked,
    show_unit_price:$("showUnitPrice").checked,
    show_quantity:$("showQuantity").checked,
    show_total_spent:$("showTotalSpent").checked,
    show_note:$("showNote").checked,
    show_time:$("showTime").checked,
    show_logo:$("showLogo").checked,
    show_footer:$("showFooter").checked,
    boss_message:$("bossMessage")?.value.trim() || ""
  };
}

function sampleReceiptData(){
  const shop=state.shops.find(s=>s.id===$("receiptShop").value)||currentShop()||{
    name:"我的小店",currency_symbol:"¥",footer_text:"谢谢喜欢，祝你今天也开心 ♡"
  };
  return {
    shop,customer:"老板昵称",companion:"A",item:{name:"语聊",unit_label:"半小时"},
    note:"谢谢支持 ♡",measure:"3H",quantity:6,unitPrice:25,
    originalTotal:150,discountRate:90,total:135,
    history:300,newTotal:435,...dateParts()
  };
}

function receiptCustomer(data){
  const customerId=String(data?.customerId||data?.customer_id||window.paiMiniSettlementSelection?.customer_id||'').trim();
  const name=String(data?.customer||'').trim();
  return (state.customers||[]).find(x=>customerId&&String(x.id)===customerId)
    || (state.customers||[]).find(x=>String(x.name||'').trim()===name && (!data?.shop?.id || x.shop_id===data.shop.id))
    || (state.customers||[]).find(x=>String(x.name||'').trim()===name)
    || null;
}
function receiptWalletLines(data,shop){
  const c=receiptCustomer(data);if(!c)return [];
  const current=Number(c.prepaid_balance||0)+Number(c.gift_balance||0);
  const selected=Math.max(0,Number(window.paiMiniSettlementSelection?.prepaid_amount||0));
  const usePrepaid=!!window.paiMiniSettlementSelection?.use_prepaid;
  const balanceAfter=data?.prepaid_balance_after!=null?Number(data.prepaid_balance_after):Math.max(0,current-(usePrepaid?selected:0));
  const lines=[["预存余额",money(balanceAfter,shop)]];
  const used=new Map((window.paiMiniSettlementSelection?.benefits_used||[]).map(x=>[String(x.benefit_id),Number(x.quantity||0)]));
  const source=(window.paiMiniSettlementSelection?.benefits?.length?window.paiMiniSettlementSelection.benefits:(state.customerBenefits||[]).filter(x=>x.customer_id===c.id));
  const benefits=source.map(x=>({...x,quantity:Math.max(0,Number(x.quantity||0)-Number(used.get(String(x.id||x.benefit_id))||0))})).filter(x=>x.quantity>0);
  if(benefits.length)lines.push(["剩余赠送权益",benefits.map(x=>String(x.name||"权益")+" "+plainNumber(x.quantity)+(x.unit_label||x.unit||"个")).join("｜")]);
  return lines;
}

function receiptHtml(data,settings){
  const shop=data.shop||currentShop()||{};
  const logo=settings.show_logo && shop.logo_url
    ? `<img class="receipt-logo" src="${safe(shop.logo_url)}" alt="">`
    : "";
  const lines=[];
  if(settings.show_customer) lines.push(["老板",data.customer]);
  lines.push(["消费项目",data.item?.name||""]);
  if(settings.show_companion) lines.push(["陪陪",data.companion||""]);
  if(settings.show_unit_price) lines.push(["单价",`${money(data.unitPrice,shop)} / ${data.item?.unit_label||""}`]);
  if(settings.show_quantity) lines.push(["时长 / 数量",data.measure||plainNumber(data.quantity)]);
  if(Number(data.discountRate??100)<100){
    lines.push(["老板折扣",discountLabel(data.discountRate)]);
    lines.push(["折前金额",money(data.originalTotal??data.total,shop)]);
  }
  if(settings.show_total_spent) lines.push(["累计消费",money(data.newTotal,shop)]);
  if(settings.show_note && data.note) lines.push(["备注",data.note]);
  if(settings.show_time) lines.push(["时间",`${data.date} ${data.time}`]);
  lines.push(...receiptWalletLines(data,shop));

  return `
    <div class="receipt-head">
      ${logo}
      <h3>${safe(shop.name||"我的小店")}</h3>
      <p>消费小票 · THANK YOU ♡</p>
    </div>
    <div class="receipt-lines">
      ${lines.map(([k,v])=>`<div class="receipt-line"><span>${safe(k)}</span><b>${safe(v)}</b></div>`).join("")}
    </div>
    <div class="receipt-total"><span>本单金额</span><strong>${money(data.total,shop)}</strong></div>
    ${settings.boss_message?`<div class="receipt-message">${safe(settings.boss_message)}</div>`:""}
    ${settings.show_footer?`<div class="receipt-footer">${safe(shop.footer_text||"谢谢喜欢，祝你今天也开心 ♡")}</div>`:""}
  `;
}

function renderInlineReceipt(){
  const data=sampleReceiptData();
  $("receiptPreviewInline").innerHTML=receiptHtml(data,currentReceiptSettingsFromControls());
}

function multiOrderReceiptData(){
  const staged=window.paiMiniMultiOrder?.lines;
  if(!Array.isArray(staged)||!staged.length) return null;

  const customer=($("customerName")?.value||"").trim();
  if(!customer){
    toast("先填写老板 / 顾客");
    return null;
  }

  const shop=currentShop()||{};
  const total=staged.reduce((sum,line)=>sum+Number(line.total||0),0);
  const previous=state.records
    .filter(r=>r.shop_id===state.shopId && String(r.customer_name_snapshot||"")===customer)
    .reduce((sum,r)=>sum+Number(r.amount||0),0);

  return {
    shop,
    customer,
    note:($("calcNote")?.value||"").trim(),
    lines:staged.map(line=>({...line})),
    total,
    history:previous,
    newTotal:previous+total,
    ...dateParts()
  };
}

function multiReceiptHtml(data,settings){
  const shop=data.shop||currentShop()||{};
  const logo=settings.show_logo && shop.logo_url
    ? `<img class="receipt-logo" src="${safe(shop.logo_url)}" alt="">`
    : "";

  const groups=[];
  for(const line of data.lines){
    let group=groups.find(g=>g.companion===line.companion);
    if(!group){
      group={companion:line.companion,lines:[]};
      groups.push(group);
    }
    group.lines.push(line);
  }

  const common=[];
  if(settings.show_customer) common.push(["老板",data.customer]);
  if(settings.show_total_spent) common.push(["累计消费",money(data.newTotal,shop)]);
  if(settings.show_note && data.note) common.push(["备注",data.note]);
  if(settings.show_time) common.push(["时间",`${data.date} ${data.time}`]);
  common.push(...receiptWalletLines(data,shop));

  const groupedHtml=groups.map((group,groupIndex)=>`
    <div class="receipt-multi-group" style="padding:10px 0;${groupIndex?"border-top:1px dashed #ead9d5;":""}">
      ${settings.show_companion?`<div class="receipt-line"><span>陪陪</span><b>${safe(group.companion||"")}</b></div>`:""}
      ${group.lines.map((line,index)=>`
        <div class="receipt-line"><span>项目${group.lines.length>1?" "+(index+1):""}</span><b>${safe(line.item||"")}</b></div>
        ${settings.show_unit_price?`<div class="receipt-line"><span>单价</span><b>${safe(money(line.price,shop)+" / "+(line.unit||"次"))}</b></div>`:""}
        ${settings.show_quantity?`<div class="receipt-line"><span>时长 / 数量</span><b>${safe(line.measure||plainNumber(line.quantity))}</b></div>`:""}
        ${Number(line.discountRate??100)<100?`
          <div class="receipt-line"><span>折扣</span><b>${safe(discountLabel(line.discountRate))}</b></div>
        `:""}
        <div class="receipt-line"><span>小计</span><b>${safe(money(line.total,shop))}</b></div>
      `).join("")}
    </div>
  `).join("");

  return `
    <div class="receipt-head">
      ${logo}
      <h3>${safe(shop.name||"我的小店")}</h3>
      <p>多人 / 多项目小票 · THANK YOU ♡</p>
    </div>
    <div class="receipt-lines">
      ${common.map(([k,v])=>`<div class="receipt-line"><span>${safe(k)}</span><b>${safe(v)}</b></div>`).join("")}
      ${groupedHtml}
    </div>
    <div class="receipt-total"><span>本单金额</span><strong>${money(data.total,shop)}</strong></div>
    ${settings.boss_message?`<div class="receipt-message">${safe(settings.boss_message)}</div>`:""}
    ${settings.show_footer?`<div class="receipt-footer">${safe(shop.footer_text||"谢谢喜欢，祝你今天也开心 ♡")}</div>`:""}
  `;
}

function renderReceiptForCurrentCalc(targetId){
  const settings=state.receiptSettings||defaultReceipt();
  const multiData=multiOrderReceiptData();
  if(multiData){
    $(targetId).innerHTML=multiReceiptHtml(multiData,settings);
    return true;
  }

  const data=reportData();
  if(!data) return false;
  $(targetId).innerHTML=receiptHtml(data,settings);
  return true;
}

async function downloadCanvasPng(canvas,filename){
  const blob=await new Promise((resolve,reject)=>{
    canvas.toBlob(value=>value?resolve(value):reject(new Error("PNG conversion failed")),"image/png");
  });

  const file=new File([blob],filename,{type:"image/png"});

  // iPhone / iPad 对异步触发的 download 很不稳定，优先交给系统分享面板保存图片。
  if(navigator.share && navigator.canShare){
    try{
      if(navigator.canShare({files:[file]})){
        await navigator.share({
          files:[file],
          title:"派mini 小票"
        });
        return;
      }
    }catch(error){
      if(error?.name==="AbortError") return;
      console.warn("native share failed, falling back",error);
    }
  }

  const url=URL.createObjectURL(blob);
  const isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1);

  if(isIOS){
    // Safari 不可靠地支持 blob download，直接打开图片，让用户长按/分享保存。
    const opened=window.open(url,"_blank");
    if(!opened) location.href=url;
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    return;
  }

  const link=document.createElement("a");
  link.download=filename;
  link.href=url;
  link.rel="noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}

async function captureElementPng(el,filename){
  if(!window.html2canvas) throw new Error("html2canvas unavailable");

  // 只读取小票数据，再新建一个完全独立的导出节点。
  // 绝不再禁用全站样式表，否则会把用户正在填写的派单页面一起“打回裸 HTML”。
  const rows=[...el.querySelectorAll(".receipt-line")].map(row=>({
    label:row.querySelector("span")?.textContent||"",
    value:row.querySelector("b")?.textContent||""
  }));
  const esc=v=>String(v??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));

  const exportRoot=document.createElement("div");
  exportRoot.style.cssText="position:fixed;left:-9999px;top:0;width:380px;padding:24px;box-sizing:border-box;background:#fffaf8;color:#57454b;border:1px solid #eadbc9;border-radius:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',Arial,sans-serif;z-index:-1;pointer-events:none;";
  exportRoot.innerHTML=`
    <div style="text-align:center;padding-bottom:14px;border-bottom:1px dashed #d8c8bc">
      <div style="font-size:20px;font-weight:800;line-height:1.3">${esc(el.querySelector(".receipt-head h3")?.textContent||"")}</div>
      <div style="margin-top:6px;font-size:11px;color:#a08c82">${esc(el.querySelector(".receipt-head p")?.textContent||"")}</div>
    </div>
    <div style="padding:15px 0">
      ${rows.map(row=>`<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:9px;font-size:13px;line-height:1.45"><span style="color:#907f78;white-space:nowrap">${esc(row.label)}</span><b style="color:#57454b;text-align:right">${esc(row.value)}</b></div>`).join("")}
    </div>
    <div style="display:flex;justify-content:space-between;align-items:flex-end;padding:14px 10px;border-top:1px dashed #d8c8bc;background:#fff4f7">
      <span style="font-size:13px">${esc(el.querySelector(".receipt-total span")?.textContent||"本单金额")}</span>
      <strong style="font-size:27px;line-height:1;color:#dd6a91">${esc(el.querySelector(".receipt-total strong")?.textContent||"")}</strong>
    </div>
    <div style="padding:12px 0;text-align:center;font-size:12px;line-height:1.6;color:#7f7070">${esc(el.querySelector(".receipt-message")?.textContent||"")}</div>
    <div style="padding-top:12px;border-top:1px dashed #d8c8bc;text-align:center;font-size:11px;line-height:1.6;color:#98847c;white-space:pre-line">${esc(el.querySelector(".receipt-footer")?.innerText||"")}</div>
  `;
  document.body.appendChild(exportRoot);

  try{
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const canvas=await window.html2canvas(exportRoot,{
      scale:2,
      useCORS:false,
      allowTaint:false,
      backgroundColor:"#fffaf8",
      logging:false,
      width:380,
      height:Math.ceil(exportRoot.scrollHeight),
      windowWidth:1200,
      windowHeight:1200
    });
    await downloadCanvasPng(canvas,filename);
  }finally{
    exportRoot.remove();
  }
}
async function exportReceipt(){
  if(!renderReceiptForCurrentCalc("receiptCapture")) return;
  const el=$("receiptCapture");
  if(!window.html2canvas){toast("图片组件还没加载好，请稍后再试");return}
  try{
    toast("正在生成图片…");
    await captureElementPng(el,`消费小票-${Date.now()}.png`);
    toast("小票图片已生成 ♡");
  }catch(error){
    console.error("receipt export failed",error);
    const detail=String(error?.message||error||"未知错误");
    toast("导出失败："+detail);
    alert("小票导出失败。\n\n原因："+detail);
  }
}

function openReceiptPreview(){
  if(!renderReceiptForCurrentCalc("receiptCapture")) return;
  $("receiptDialog").showModal();
}

async function addCategory(){
  if(!ownsShop()){toast("这家店的价格表只能由创建者修改");return}
  const name=$("newCategoryName").value.trim();
  if(!name){toast("先填分类名称");return}
  const {error}=await supabase.from("price_categories").insert({shop_id:state.shopId,name,sort_order:state.categories.length*10});
  if(error){toast("新增失败："+error.message);return}
  $("newCategoryName").value="";
  await loadCurrentShopData();
  renderAll();
  toast("分类已新增");
}

function resetPriceForm(){
  state.editingItemId=null;
  $("itemFormTitle").textContent="新增价格项目";
  $("priceName").value="";
  $("priceCategory").value="";
  $("priceValue").value="";
  $("priceUnitLabel").value="";
  $("priceUnitMinutes").value="";
  $("priceSort").value="0";
  $("priceManual").checked=false;
  $("priceNotes").value="";
  $("cancelItemEditBtn").classList.add("hidden");
}

async function savePriceItem(){
  if(!ownsShop()){toast("这家店的价格表只能由创建者修改");return}
  const payload={
    shop_id:state.shopId,
    category_id:$("priceCategory").value||null,
    name:$("priceName").value.trim(),
    unit_price:Number($("priceValue").value||0),
    unit_label:$("priceUnitLabel").value.trim()||"次",
    unit_minutes:$("priceUnitMinutes").value?Number($("priceUnitMinutes").value):null,
    sort_order:Number($("priceSort").value||0),
    allow_manual_price:$("priceManual").checked,
    notes:$("priceNotes").value.trim()||null
  };
  if(!payload.name){toast("先填项目名称");return}
  if(payload.unit_price<0){toast("单价不能小于 0");return}
  let result;
  if(state.editingItemId){
    result=await supabase.from("price_items").update(payload).eq("id",state.editingItemId);
  }else{
    result=await supabase.from("price_items").insert(payload);
  }
  if(result.error){toast("保存失败："+result.error.message);return}
  resetPriceForm();
  await loadCurrentShopData();
  renderAll();
  toast("价格项目已保存 ♡");
}

function editPriceItem(id){
  if(!ownsShop()){toast("这家店的价格表是共享只读的");return}
  const item=state.items.find(x=>x.id===id);
  if(!item) return;
  state.editingItemId=id;
  $("itemFormTitle").textContent="编辑价格项目";
  $("priceName").value=item.name||"";
  $("priceCategory").value=item.category_id||"";
  $("priceValue").value=item.unit_price??"";
  $("priceUnitLabel").value=item.unit_label||"";
  $("priceUnitMinutes").value=item.unit_minutes??"";
  $("priceSort").value=item.sort_order??0;
  $("priceManual").checked=!!item.allow_manual_price;
  $("priceNotes").value=item.notes||"";
  $("cancelItemEditBtn").classList.remove("hidden");
  showPage("prices");
  window.scrollTo({top:0,behavior:"smooth"});
}

async function togglePriceItem(id){
  if(!ownsShop()){toast("这家店的价格表只能由创建者修改");return}
  const item=state.items.find(x=>x.id===id);
  if(!item) return;
  const {error}=await supabase.from("price_items").update({is_active:!item.is_active}).eq("id",id);
  if(error){toast("更新失败："+error.message);return}
  await loadCurrentShopData();renderAll();
}

async function deletePriceItem(id){
  if(!ownsShop()){toast("这家店的价格表只能由创建者修改");return}
  if(!confirm("确定删除这个价格项目吗？历史消费记录会保留当时的价格快照。")) return;
  const {error}=await supabase.from("price_items").delete().eq("id",id);
  if(error){toast("删除失败："+error.message);return}
  await loadCurrentShopData();renderAll();toast("已删除");
}

async function deleteCategory(id){
  if(!ownsShop()){toast("这家店的价格表只能由创建者修改");return}
  if(!confirm("删除分类后，分类下的项目会变成「未分类」，继续吗？")) return;
  const {error}=await supabase.from("price_categories").delete().eq("id",id);
  if(error){toast("删除失败："+error.message);return}
  await loadCurrentShopData();renderAll();
}

function resetShopForm(){
  state.editingShopId=null;
  $("shopFormTitle").textContent="新增店铺";
  $("shopName").value="";
  $("shopCurrency").value="¥";
  $("shopBrandColor").value="#f47ea7";
  $("shopLogo").value="";
  $("shopFooter").value="谢谢喜欢，祝你今天也开心 ♡";
  $("cancelShopEditBtn").classList.add("hidden");
}

async function saveShop(){
  const payload={
    name:$("shopName").value.trim(),
    currency_symbol:$("shopCurrency").value.trim()||"¥",
    brand_color:$("shopBrandColor").value||"#f47ea7",
    logo_url:$("shopLogo").value.trim()||null,
    footer_text:$("shopFooter").value.trim()||"谢谢喜欢，祝你今天也开心 ♡"
  };
  if(!payload.name){toast("先填店铺名称");return}

  if(state.editingShopId){
    const {error}=await supabase.from("shops").update(payload).eq("id",state.editingShopId);
    if(error){toast("保存失败："+error.message);return}
  }else{
    const {data,error}=await supabase.from("shops").insert(payload).select().single();
    if(error){toast("保存失败："+error.message);return}
    await supabase.from("price_categories").insert([
      {shop_id:data.id,name:"语音",sort_order:10},
      {shop_id:data.id,name:"游戏",sort_order:20},
      {shop_id:data.id,name:"娱乐",sort_order:30},
      {shop_id:data.id,name:"其他",sort_order:40}
    ]);
    await supabase.from("report_templates").insert({shop_id:data.id,template_text:DEFAULT_TEMPLATE});
    await supabase.from("receipt_settings").insert({shop_id:data.id});
    state.shopId=data.id;
  }
  resetShopForm();
  await bootstrap();
  toast("店铺已保存 ♡");
}

function editShop(id){
  const shop=state.shops.find(s=>s.id===id);
  if(!ownsShop(shop)){toast("只有创建者可以编辑这家店");return}
  if(!shop) return;
  state.editingShopId=id;
  $("shopFormTitle").textContent="编辑店铺";
  $("shopName").value=shop.name||"";
  $("shopCurrency").value=shop.currency_symbol||"¥";
  $("shopBrandColor").value=shop.brand_color||"#f47ea7";
  $("shopLogo").value=shop.logo_url||"";
  $("shopFooter").value=shop.footer_text||"";
  $("cancelShopEditBtn").classList.remove("hidden");
  showPage("shops");
  window.scrollTo({top:0,behavior:"smooth"});
}

async function useShop(id){
  state.shopId=id;
  populateShopSelectors();
  $("calcShop").value=id;
  $("templateShop").value=id;
  $("receiptShop").value=id;
  await loadCurrentShopData();
  renderAll();
  toast("已切换店铺");
}

async function deleteShop(id){
  const shop=state.shops.find(s=>s.id===id);
  if(!ownsShop(shop)){toast("只有创建者可以删除这家店");return}
  const myShopCount=state.shops.filter(s=>ownsShop(s)).length;
  if(myShopCount<=1){toast("至少保留一个自己创建的店铺");return}
  if(!confirm("删除店铺会一起删除它的价格表、老板和消费记录，确定吗？")) return;
  const {error}=await supabase.from("shops").delete().eq("id",id);
  if(error){toast("删除失败："+error.message);return}
  if(state.shopId===id) state.shopId=null;
  await bootstrap();
}

async function loadTemplateFor(shopId){
  const {data,error}=await supabase.from("report_templates").select("*").eq("shop_id",shopId).maybeSingle();
  if(error){toast("读取模板失败");return}
  $("reportTemplateText").value=data?.template_text||DEFAULT_TEMPLATE;
}

async function saveTemplate(){
  const shopId=$("templateShop").value;
  if(!shopId) return;
  const payload={
    shop_id:shopId,
    template_text:$("reportTemplateText").value||DEFAULT_TEMPLATE
  };
  const {error}=await supabase.from("report_templates").upsert(payload,{onConflict:"user_id,shop_id"});
  if(error){toast("保存失败："+error.message);return}
  if(shopId===state.shopId) state.template={...state.template,...payload};
  toast("报备模板已保存 ♡");
}

async function loadReceiptFor(shopId){
  const {data,error}=await supabase.from("receipt_settings").select("*").eq("shop_id",shopId).maybeSingle();
  if(error){toast("读取小票设置失败");return}
  const settings=data||defaultReceipt();
  receiptKeys.forEach(key=>{
    const dbKey=key.replace(/[A-Z]/g,m=>"_"+m.toLowerCase());
    $(key).checked=settings[dbKey]??true;
  });
  if($("bossMessage")) $("bossMessage").value=settings.boss_message || "谢谢支持，祝你今天也开心 ♡";
  renderInlineReceipt();
}

async function saveReceiptSettings(){
  const shopId=$("receiptShop").value;
  if(!shopId) return;
  const payload={shop_id:shopId,...currentReceiptSettingsFromControls()};
  const {error}=await supabase.from("receipt_settings").upsert(payload,{onConflict:"user_id,shop_id"});
  if(error){toast("保存失败："+error.message);return}
  if(shopId===state.shopId) state.receiptSettings={...state.receiptSettings,...payload};
  toast("小票设置已保存 ♡");
}

function renderRecords(){
  const q=$("recordSearch").value.trim().toLowerCase();
  const shopFilter=$("recordShopFilter").value||"all";
  const filtered=state.records.filter(r=>{
    if(shopFilter!=="all" && r.shop_id!==shopFilter) return false;
    if(!q) return true;
    return [r.customer_name_snapshot,r.item_name_snapshot,r.companion_name,r.note]
      .some(v=>String(v||"").toLowerCase().includes(q));
  });
  $("emptyRecords").classList.toggle("hidden",filtered.length>0);
  const bulkBar=$("recordBulkBar"),bulkToggle=$("recordBulkToggle"),bulkDelete=$("recordBulkDelete");
  if(bulkBar)bulkBar.classList.toggle("hidden",!state.recordBulkMode);
  if(bulkToggle)bulkToggle.textContent=state.recordBulkMode?"取消批量删除":"批量删除";
  if(bulkDelete)bulkDelete.textContent=`删除已选 (${state.recordBulkSelected.size})`;
  $("recordList").innerHTML=filtered.map(r=>{
    const shop=state.shops.find(s=>s.id===r.shop_id);
    const d=dateParts(r.occurred_at);
    return `
      <div class="record-row">
        ${state.recordBulkMode?`<label style="display:flex;align-items:center;justify-content:center;padding:4px"><input data-record-select="${r.id}" type="checkbox" style="width:16px!important;height:16px!important;min-width:16px!important;max-width:16px!important;padding:0!important;margin:0!important;border-radius:4px!important;box-shadow:none!important;appearance:auto!important;-webkit-appearance:checkbox!important" ${state.recordBulkSelected.has(r.id)?"checked":""} aria-label="选择这条消费记录"></label>`:""}
        <div class="record-main">
          <b>${safe(r.customer_name_snapshot)} · ${safe(r.item_name_snapshot)}</b>
          <p>陪陪 ${safe(r.companion_name||"-")} · ${safe(r.duration_input||plainNumber(r.quantity))} · ${safe(shop?.name||"已删除店铺")}${Number(r.discount_rate_snapshot??100)<100?" · "+safe(discountLabel(r.discount_rate_snapshot)):""}</p>
          <small>${d.date} ${d.time}</small>
          <div class="row-actions">
            <button class="tiny-btn" data-reuse-record="${r.id}" type="button">再次使用</button>
            <button class="tiny-btn" data-copy-record="${r.id}" type="button">复制报备</button>
            ${state.recordBulkMode?"":`<button class="tiny-btn danger" data-delete-record="${r.id}" type="button">删除</button>`}
          </div>
        </div>
        <div class="record-money">
          <strong>${money(r.amount,shop)}</strong>
          <span>当时累计 ${money(r.new_total,shop)}</span>
        </div>
      </div>`;
  }).join("");
}


async function deleteSelectedRecords(){
  const ids=[...state.recordBulkSelected].filter(id=>state.records.some(r=>r.id===id));
  if(!ids.length){toast("先勾选要删除的消费记录");return}
  if(!confirm(`确定删除选中的 ${ids.length} 条消费记录吗？\n\n批量删除只清除消费记录，不会退回历史预存余额或权益。`))return;
  const groups=new Set();
  for(const id of ids){const r=state.records.find(x=>x.id===id);if(r?.order_group_id)groups.add(r.order_group_id)}
  const expanded=state.records.filter(r=>ids.includes(r.id)||(r.order_group_id&&groups.has(r.order_group_id))).map(r=>r.id);
  const {error}=await supabase.from("consumption_records").delete().in("id",[...new Set(expanded)]);
  if(error){toast("批量删除失败："+error.message);return}
  state.recordBulkSelected.clear();state.recordBulkMode=false;
  await loadRecords();renderRecords();await refreshCustomerTotal();renderDataSummary();
  toast(`已删除 ${expanded.length} 条消费记录 ♡`);
}

async function deleteRecord(id){
  const record=state.records.find(r=>r.id===id);
  if(!record)return;
  if(!confirm("确定删除这条消费记录吗？如果它属于整单，会删除同一整单的全部项目。"))return;

  const groupRecords=record.order_group_id?state.records.filter(r=>r.order_group_id===record.order_group_id):[record];
  const settlementRecord=groupRecords.find(r=>Number(r.prepaid_used||0)>0||Number(r.prepaid_paid_used||0)>0||Number(r.gift_balance_used||0)>0||(Array.isArray(r.benefits_used)&&r.benefits_used.length>0))||record;
  const walletAmount=Math.max(Number(settlementRecord.prepaid_used||0),Number(settlementRecord.prepaid_paid_used||0)+Number(settlementRecord.gift_balance_used||0));
  const walletUsed=walletAmount>0;
  const benefitsUsed=Array.isArray(settlementRecord.benefits_used)&&settlementRecord.benefits_used.length>0;
  let restore=false;

  if(walletUsed||benefitsUsed){
    const detail=[
      walletUsed?"预存 ¥"+walletAmount.toFixed(2):"",
      benefitsUsed?"权益 "+settlementRecord.benefits_used.length+" 项":""
    ].filter(Boolean).join("、");
    restore=confirm("这单使用了"+detail+"。\n\n确定：删除并原路退回余额/权益\n取消：仅删除记录，不退回");
  }

  let error=null;
  const rpcResult=await supabase.rpc("delete_order_with_wallet_restore",{
    p_record_id:id,
    p_restore_wallet:restore,
    p_restore_benefits:restore
  });
  error=rpcResult.error;
  if(error && !restore){
    // Plain deletion must keep working even if the optional restore RPC is unavailable.
    const ids=record.order_group_id?groupRecords.map(r=>r.id):[id];
    const fallback=await supabase.from("consumption_records").delete().in("id",ids);
    error=fallback.error;
  }
  if(error){
    const missing=String(error.message||"").includes("delete_order_with_wallet_restore");
    toast(missing?"请先运行【赠送余额版】SQL，再使用删除退款功能":"删除失败："+error.message);
    return;
  }
  await loadRecords();
  renderRecords();
  await refreshCustomerTotal();
  renderDataSummary();
  window.dispatchEvent(new CustomEvent("paimini:prepaid-updated"));
  toast(restore?"订单已删除，余额 / 权益已原路退回 ♡":"记录已删除");
}

async function reuseRecord(id){
  const record=state.records.find(r=>r.id===id);
  if(!record) return;
  if(state.shopId!==record.shop_id) await useShop(record.shop_id);
  $("customerName").value=record.customer_name_snapshot||"";
  $("companionName").value=record.companion_name||"";
  $("calcNote").value=record.note||"";

  const item=state.items.find(i=>i.id===record.item_id);
  if(item){
    selectItem(item.id);
  }else{
    state.selectedItem=null;
    $("calcItemName").value=record.item_name_snapshot||"";
    $("calcUnitLabel").value=record.unit_label_snapshot||"次";
    $("calcUnitMinutes").value=record.unit_minutes_snapshot||"";
  }

  $("calcUnitPrice").value=record.unit_price_snapshot||0;
  $("customerDiscount").value=Number(record.discount_rate_snapshot??100)<100
    ? discountLabel(record.discount_rate_snapshot)
    : "";
  $("durationInput").value=record.duration_input||plainNumber(record.quantity);
  await refreshCustomerTotal();

  if(Number(record.discount_rate_snapshot??100)<100){
    $("customerDiscount").value=discountLabel(record.discount_rate_snapshot);
  }
  calculate();
  showPage("calculator");
  window.scrollTo({top:0,behavior:"smooth"});
  toast("已带回计算页");
}

function showPage(name){
  document.querySelectorAll(".page").forEach(el=>el.classList.toggle("active",el.id===`page-${name}`));
  document.querySelectorAll(".nav-tab").forEach(btn=>btn.classList.toggle("active",btn.dataset.page===name));
}

function bindEvents(){
  $("signUpBtn").addEventListener("click",signUp);
  $("signInBtn").addEventListener("click",signIn);
  $("authDiagBtn")?.addEventListener("click",runAuthDiagnostics);
  $("signOutBtn").addEventListener("click",signOut);
  $("settingsSignOutBtn").addEventListener("click",signOut);
  $("desktopSidebarCollapseBtn").addEventListener("click",toggleDesktopSidebar);
  document.querySelectorAll("[data-mobile-nav-mode]").forEach(btn=>{
    btn.addEventListener("click",()=>setMobileNavMode(btn.dataset.mobileNavMode));
  });
  $("verticalNavCollapseBtn").addEventListener("click",closeMobileDrawer);
  $("mobileMenuBtn").addEventListener("click",openMobileDrawer);
  $("mobileNavOverlay").addEventListener("click",closeMobileDrawer);
  $("installAppBtn").addEventListener("click",installPaiMini);
  $("settingsInstallAppBtn").addEventListener("click",installPaiMini);
  $("saveDesktopAppBtn").addEventListener("click",saveDesktopPrefs);
  $("resetDesktopAppBtn").addEventListener("click",resetDesktopPrefs);
  $("desktopAppName").addEventListener("input",()=>{
    $("desktopNamePreview").textContent=$("desktopAppName").value.trim()||"派mini";
  });
  $("desktopIconFile").addEventListener("change",()=>{
    const file=$("desktopIconFile").files?.[0];
    if(!file) return;
    const url=URL.createObjectURL(file);
    $("desktopIconPreview").src=url;
  });
  $("closeInstallHelpDialog").addEventListener("click",()=>$("installHelpDialog").close());
  $("expiredSignOutBtn").addEventListener("click",signOut);
  $("expiredRenewBtn").addEventListener("click",()=>redeemRenewal("expiredRenewalCode","expiredHint"));
  $("settingsRenewBtn").addEventListener("click",()=>redeemRenewal("settingsRenewalCode","settingsRenewHint"));

  document.querySelectorAll(".nav-tab").forEach(btn=>btn.addEventListener("click",()=>{
    showPage(btn.dataset.page);
    if(getMobileNavMode()==="left") closeMobileDrawer();
  }));

  $("calcShop").addEventListener("change",async()=>{
    state.shopId=$("calcShop").value;
    $("templateShop").value=state.shopId;
    $("receiptShop").value=state.shopId;
    $("customerShop").value=state.shopId;
    resetCustomerProfileForm();
    await loadCurrentShopData();
    renderAll();
    window.dispatchEvent(new CustomEvent("paimini:shop-changed",{detail:{shopId:state.shopId}}));
  });

  $("customerName").addEventListener("input",()=>{
    clearTimeout(bindEvents.customerTimer);
    bindEvents.customerTimer=setTimeout(refreshCustomerTotal,250);
  });
  $("calcItemName").addEventListener("input",()=>{
    clearTimeout(bindEvents.itemNameTimer);
    bindEvents.itemNameTimer=setTimeout(syncExistingItemByName,120);
  });
  $("calcUnitPrice").addEventListener("input",calculate);
  $("calcUnitLabel").addEventListener("input",()=>{
    if(!$("calcUnitMinutes").value){
      const inferred=inferMinutesFromUnit($("calcUnitLabel").value);
      if(inferred) $("calcUnitMinutes").value=inferred;
    }
    calculate();
  });
  $("calcUnitMinutes").addEventListener("input",calculate);
  $("customerDiscount").addEventListener("input",calculate);
  $("durationInput").addEventListener("input",calculate);
  $("itemSearch").addEventListener("input",()=>{
    state.itemSearch=$("itemSearch").value;
    renderItems();
  });

  $("categoryChips").addEventListener("click",e=>{
    const btn=e.target.closest("[data-category]");
    if(!btn) return;
    state.categoryFilter=btn.dataset.category;
    renderCategories();renderItems();
  });
  $("itemWall").addEventListener("click",e=>{
    const btn=e.target.closest("[data-item]");
    if(btn) selectItem(btn.dataset.item);
  });

  $("copyReportBtn").addEventListener("click",()=>{
    const data=reportData();
    if(data) copyText(buildReport(data));
  });
  $("previewReceiptBtn").addEventListener("click",openReceiptPreview);
  $("exportReceiptBtn").addEventListener("click",exportReceipt);
  $("saveRecordBtn").addEventListener("click",saveUnifiedRecord);

  $("addCategoryBtn").addEventListener("click",addCategory);
  $("categoryManager").addEventListener("click",e=>{
    const btn=e.target.closest("[data-delete-category]");
    if(btn) deleteCategory(btn.dataset.deleteCategory);
  });
  $("savePriceItemBtn").addEventListener("click",savePriceItem);
  $("cancelItemEditBtn").addEventListener("click",resetPriceForm);
  $("priceItemList").addEventListener("click",e=>{
    const edit=e.target.closest("[data-edit-item]");
    const toggle=e.target.closest("[data-toggle-item]");
    const del=e.target.closest("[data-delete-item]");
    if(edit) editPriceItem(edit.dataset.editItem);
    if(toggle) togglePriceItem(toggle.dataset.toggleItem);
    if(del) deletePriceItem(del.dataset.deleteItem);
  });

  $("saveShopBtn").addEventListener("click",saveShop);
  $("cancelShopEditBtn").addEventListener("click",resetShopForm);
  $("shopList").addEventListener("click",e=>{
    const use=e.target.closest("[data-use-shop]");
    const fav=e.target.closest("[data-favorite-shop]");
    const edit=e.target.closest("[data-edit-shop]");
    const del=e.target.closest("[data-delete-shop]");
    if(use) useShop(use.dataset.useShop);
    if(fav) toggleFavoriteShop(fav.dataset.favoriteShop);
    if(edit) editShop(edit.dataset.editShop);
    if(del) deleteShop(del.dataset.deleteShop);
  });
  $("shopSearch").addEventListener("input",()=>{
    state.shopSearch=$("shopSearch").value;
    renderShopList();
  });

  $("customerShop").addEventListener("change",async()=>{
    state.shopId=$("customerShop").value;
    $("calcShop").value=state.shopId;
    $("templateShop").value=state.shopId;
    $("receiptShop").value=state.shopId;
    await loadCurrentShopData();
    renderAll();
  });

  $("saveCustomerProfileBtn").addEventListener("click",saveCustomerProfile);
  $("cancelCustomerProfileBtn").addEventListener("click",resetCustomerProfileForm);
  $("customerProfileSearch").addEventListener("input",()=>{
    state.customerSearch=$("customerProfileSearch").value;
    renderCustomerProfiles();
  });
  $("customerProfileList").addEventListener("click",e=>{
    const use=e.target.closest("[data-use-customer]");
    const edit=e.target.closest("[data-edit-customer]");
    const del=e.target.closest("[data-delete-customer]");
    if(use) useCustomerProfile(use.dataset.useCustomer);
    if(edit) editCustomerProfile(edit.dataset.editCustomer);
    if(del) deleteCustomerProfile(del.dataset.deleteCustomer);
  });

  document.querySelectorAll("[data-theme-preset]").forEach(btn=>{
    btn.addEventListener("click",()=>useThemePreset(btn.dataset.themePreset,true));
  });
  ["themeBg","themeAccent","themePaper","themeInk"].forEach(id=>{
    $(id).addEventListener("input",previewThemeFromControls);
  });
  $("saveThemeBtn").addEventListener("click",saveTheme);
  $("resetThemeBtn").addEventListener("click",()=>useThemePreset("beige",true));

  $("templateShop").addEventListener("change",()=>loadTemplateFor($("templateShop").value));
  $("saveTemplateBtn").addEventListener("click",saveTemplate);

  $("receiptShop").addEventListener("change",()=>loadReceiptFor($("receiptShop").value));
  receiptKeys.forEach(key=>$(key).addEventListener("change",renderInlineReceipt));
  $("saveReceiptSettingsBtn").addEventListener("click",saveReceiptSettings);

  $("recordSearch").addEventListener("input",renderRecords);
  $("recordBulkToggle")?.addEventListener("click",()=>{state.recordBulkMode=!state.recordBulkMode;state.recordBulkSelected.clear();renderRecords()});
  $("recordBulkDelete")?.addEventListener("click",deleteSelectedRecords);
  $("recordBulkSelectAll")?.addEventListener("click",()=>{const boxes=[...document.querySelectorAll("[data-record-select]")];const all=boxes.length&&boxes.every(b=>b.checked);boxes.forEach(b=>{b.checked=!all;if(!all)state.recordBulkSelected.add(b.dataset.recordSelect);else state.recordBulkSelected.delete(b.dataset.recordSelect)});renderRecords()});
  $("recordShopFilter").addEventListener("change",renderRecords);
  $("recordList").addEventListener("change",e=>{const box=e.target.closest("[data-record-select]");if(!box)return;if(box.checked)state.recordBulkSelected.add(box.dataset.recordSelect);else state.recordBulkSelected.delete(box.dataset.recordSelect);renderRecords()});
  $("recordList").addEventListener("click",e=>{
    const reuse=e.target.closest("[data-reuse-record]");
    const copy=e.target.closest("[data-copy-record]");
    const del=e.target.closest("[data-delete-record]");
    if(reuse) reuseRecord(reuse.dataset.reuseRecord);
    if(copy){
      const record=state.records.find(r=>r.id===copy.dataset.copyRecord);
      if(record) copyText(record.report_text||"");
    }
    if(del) deleteRecord(del.dataset.deleteRecord);
  });

  $("closeReceiptDialog").addEventListener("click",()=>$("receiptDialog").close());
  $("dialogExportBtn").addEventListener("click",exportReceipt);
  $("refreshDataBtn").addEventListener("click",async()=>{
    await loadAccessStatus();
    await bootstrap();
  });
  $("saveProfileBtn").addEventListener("click",saveProfile);
  $("profileAvatarFile").addEventListener("change",()=>{
    const file=$("profileAvatarFile").files?.[0];
    if(!file) return;
    const url=URL.createObjectURL(file);
    $("settingsAvatarImg").src=url;
    $("settingsAvatarImg").classList.remove("hidden");
    $("settingsAvatarFallback").classList.add("hidden");
  });
}

loadTheme();
renderDesktopPrefs();
applyDesktopSidebarState();
applyMobileNavLayout();
registerPaiMiniPwa();
bindEvents();

const serviceCheck=await checkAuthService();
if(!serviceCheck.ok){
  setConnection("注册服务连接失败",false);
}else{
  setConnection("Supabase 已连接 ✓",true);
}

const {data,error}=await supabase.auth.getSession();
if(error){
  setConnection("Supabase 连接失败",false);
  setAuthHint(error.message,true);
  document.body.classList.remove("booting");
}else{
  await applySession(data.session);
  document.body.classList.remove("booting");
}

supabase.auth.onAuthStateChange(async (_event,session)=>{
  const oldId=state.session?.user?.id || null;
  const newId=session?.user?.id || null;
  if(oldId===newId) return;
  await applySession(session);
});