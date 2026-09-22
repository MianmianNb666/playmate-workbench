export const SUPABASE_URL = "https://hwvtuybkozojypifxjto.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable___YrsbZwmyv_3KbYDhZSmw_zXBazZFr";

// Supabase 中转地址：默认仍优先直连，只有网络级失败才自动走 Cloudflare Worker。
export const SUPABASE_PROXY_URL = "https://paimini-proxy.jiaj200405.workers.dev";

const nativeFetch = globalThis.fetch?.bind(globalThis);
const REQUEST_TIMEOUT_MS = 7000;

function isSupabaseUrl(input){
  const raw=typeof input==="string" ? input : input?.url;
  if(!raw) return false;
  try{return new URL(raw).origin===new URL(SUPABASE_URL).origin}catch{return false}
}

function isNetworkFailure(error){
  const message=String(error?.message||error||"").toLowerCase();
  return error?.name==="AbortError" ||
    message.includes("load failed") ||
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("timeout");
}

function toProxyUrl(input){
  if(!SUPABASE_PROXY_URL) return null;
  const raw=typeof input==="string" ? input : input?.url;
  if(!raw) return null;
  let url;
  try{url=new URL(raw)}catch{return null}
  const upstream=new URL(SUPABASE_URL);
  if(url.origin!==upstream.origin) return null;
  return SUPABASE_PROXY_URL.replace(/\/$/,"")+url.pathname+url.search;
}

function withDeadline(promise,ms=REQUEST_TIMEOUT_MS){
  let timer;
  const timeout=new Promise((_,reject)=>{
    timer=setTimeout(()=>{
      const error=new Error("Supabase request timeout");
      error.name="TimeoutError";
      reject(error);
    },ms);
  });
  return Promise.race([promise,timeout]).finally(()=>clearTimeout(timer));
}

function requestInit(input,init){
  const request=input instanceof Request ? input : null;
  const method=init?.method || request?.method || "GET";
  const next={
    method,
    headers:init?.headers || request?.headers,
    body:init?.body,
    signal:init?.signal || request?.signal,
    cache:init?.cache || "no-store",
    redirect:init?.redirect || request?.redirect,
    credentials:init?.credentials || "omit"
  };
  if(method==="GET" || method==="HEAD") delete next.body;
  return next;
}

if(nativeFetch && !globalThis.__paiMiniSupabaseProxyFetchInstalled){
  globalThis.__paiMiniSupabaseProxyFetchInstalled=true;
  globalThis.fetch=async function paiMiniFetch(input,init){
    if(!isSupabaseUrl(input)) return nativeFetch(input,init);
    try{
      return await withDeadline(nativeFetch(input,init));
    }catch(error){
      const proxyUrl=toProxyUrl(input);
      if(!proxyUrl || !isNetworkFailure(error)) throw error;
      return withDeadline(nativeFetch(proxyUrl,requestInit(input,init)));
    }
  };
}

if(typeof window!=="undefined" && !window.__paiMiniReadonlyScheduled){
  window.__paiMiniReadonlyScheduled=true;
  let started=false;
  const startReadonly=()=>{
    if(started || !document.body || document.body.classList.contains("booting")) return;
    started=true;
    import("./readonly-access.js?v=20260923-safe1")
      .catch(error=>console.warn("readonly mode load failed",error));
  };
  const timer=setInterval(()=>{
    if(started){clearInterval(timer);return;}
    startReadonly();
  },250);
  setTimeout(()=>clearInterval(timer),20000);
}

if(typeof window!=="undefined" && !window.__paiMiniMembershipShellScheduled){
  window.__paiMiniMembershipShellScheduled=true;
  import("./shop-membership-loader.js?v=20260923-phase4")
    .catch(error=>console.warn("membership phase4 loader failed",error));
}

// 独立“预存”分区：只在核心主程序已经显示后加载。
// 账务管理复用核心 Supabase，模块失败不会阻塞登录和派单主流程。
if(typeof window!=="undefined" && !window.__paiMiniPrepaidSectionScheduled){
  window.__paiMiniPrepaidSectionScheduled=true;
  let prepaidStarted=false;
  const startPrepaid=async()=>{
    const app=document.getElementById("appRoot");
    if(prepaidStarted || !document.body || document.body.classList.contains("booting") || !app || app.classList.contains("hidden")) return;
    prepaidStarted=true;
    try{
      await import("./prepaid-page.js?v=20260923-prepaid3");
      const mod=await import("./prepaid-manager-safe.js?v=20260923-prepaid3");
      await mod.initPrepaidManagerSafe?.();
    }catch(error){
      console.warn("prepaid section load failed",error);
      prepaidStarted=false;
    }
  };
  const prepaidTimer=setInterval(()=>{
    if(prepaidStarted){clearInterval(prepaidTimer);return;}
    void startPrepaid();
  },300);
  setTimeout(()=>clearInterval(prepaidTimer),30000);
}

// 派单页“⑤预存/权益”安全预览暂时关闭，统一放入独立“预存”栏目。

if(typeof window!=="undefined" && !window.__paiMiniBootWatchdogInstalled){
  window.__paiMiniBootWatchdogInstalled=true;
  setTimeout(()=>{
    try{
      if(!document.body?.classList.contains("booting")) return;
      document.body.classList.remove("booting");
      document.getElementById("authGate")?.classList.remove("hidden");
      document.getElementById("accessGate")?.classList.add("hidden");
      document.getElementById("appRoot")?.classList.add("hidden");
      const box=document.getElementById("connectionStatus");
      const text=document.getElementById("connectionText");
      if(box) box.className="connection-pill bad";
      if(text) text.textContent="启动等待超时，请稍后重试或使用连接诊断";
      const hint=document.getElementById("authHint");
      if(hint && !hint.textContent) hint.textContent="页面已解除卡死，当前有启动请求未及时返回。";
      console.warn("PaiMini outer watchdog released splash after 8s");
    }catch(error){
      console.warn("PaiMini boot watchdog failed",error);
    }
  },8000);
}
