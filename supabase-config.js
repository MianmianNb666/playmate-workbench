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

// 核心 app-v20260921-8.js 里有多处无超时 await。
// 这里在 createClient 之前统一给 Supabase 请求加“调用方可返回”的硬截止时间，
// 避免 getSession / get_access_status / bootstrap 任一请求无限悬挂。
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

// 只读模式恢复，但绝不参与核心启动。
// 只有核心已经退出 booting 后才加载；模块自身也没有顶层 await。
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

// 店铺成员制第一阶段：只加载隔离空壳，不调用任何成员 RPC。
// 只有核心工作台已经显示后才启动。加载/初始化有独立超时，失败只关闭本模块。
if(typeof window!=="undefined" && !window.__paiMiniMembershipShellScheduled){
  window.__paiMiniMembershipShellScheduled=true;
  import("./shop-membership-loader.js?v=20260923-shell2")
    .catch(error=>console.warn("membership shell loader failed",error));
}

// 其他扩展继续关闭，后续逐个恢复。

// 外层启动保险。核心脚本如果仍然卡住，8 秒后至少解除启动遮罩。
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
