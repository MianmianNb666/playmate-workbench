export const SUPABASE_URL = "https://hwvtuybkozojypifxjto.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable___YrsbZwmyv_3KbYDhZSmw_zXBazZFr";

// Supabase 中转地址：默认优先直连，网络失败时再走 Cloudflare Worker。
export const SUPABASE_PROXY_URL = "https://paimini-proxy.jiaj200405.workers.dev";

const nativeFetch = globalThis.fetch?.bind(globalThis);
const SUPABASE_FETCH_TIMEOUT_MS = 8000;

function isNetworkFailure(error){
  const message=String(error?.message||error||"").toLowerCase();
  return error instanceof TypeError ||
    error?.name==="AbortError" ||
    message.includes("load failed") ||
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("aborted");
}

function toProxyUrl(input){
  if(!SUPABASE_PROXY_URL) return null;
  const raw=typeof input==="string" ? input : input?.url;
  if(!raw) return null;

  let url;
  try{ url=new URL(raw); }catch{ return null; }

  const upstream=new URL(SUPABASE_URL);
  if(url.origin!==upstream.origin) return null;

  return SUPABASE_PROXY_URL.replace(/\/$/,"") + url.pathname + url.search;
}

function withTimeoutSignal(originalSignal,timeoutMs=SUPABASE_FETCH_TIMEOUT_MS){
  const controller=new AbortController();
  let timer=setTimeout(()=>controller.abort(new DOMException("Supabase request timeout","AbortError")),timeoutMs);

  if(originalSignal){
    if(originalSignal.aborted){
      clearTimeout(timer);
      controller.abort(originalSignal.reason);
    }else{
      originalSignal.addEventListener("abort",()=>{
        clearTimeout(timer);
        controller.abort(originalSignal.reason);
      },{once:true});
    }
  }

  return {signal:controller.signal,clear:()=>clearTimeout(timer)};
}

async function timedFetch(url,init={}){
  const timed=withTimeoutSignal(init?.signal);
  try{
    return await nativeFetch(url,{...init,signal:timed.signal});
  }finally{
    timed.clear();
  }
}

// 所有 Supabase 网络请求都设置硬超时，避免移动网络或线路异常时无限卡住启动。
// 直连失败后尝试代理；两条线路都不会无限等待。
if(nativeFetch && !globalThis.__paiMiniSupabaseProxyFetchInstalled){
  globalThis.__paiMiniSupabaseProxyFetchInstalled=true;
  globalThis.fetch=async function paiMiniFetch(input,init){
    const raw=typeof input==="string" ? input : input?.url;
    let isSupabase=false;
    try{ isSupabase=!!raw && new URL(raw).origin===new URL(SUPABASE_URL).origin; }catch{}

    if(!isSupabase){
      return nativeFetch(input,init);
    }

    try{
      return await timedFetch(input,init||{});
    }catch(error){
      const proxyUrl=toProxyUrl(input);
      if(!proxyUrl || !isNetworkFailure(error)) throw error;

      const request=input instanceof Request ? input : null;
      const retryInit={
        method:init?.method || request?.method || "GET",
        headers:init?.headers || request?.headers,
        body:init?.body,
        signal:init?.signal || request?.signal,
        cache:"no-store",
        redirect:init?.redirect || request?.redirect,
        credentials:"omit"
      };

      if(retryInit.method==="GET" || retryInit.method==="HEAD") delete retryInit.body;
      return timedFetch(proxyUrl,retryInit);
    }
  };
}

// 启动保险：核心程序如果卡在 Supabase 会话/初始化请求，最多等待 10 秒。
// 只解除启动遮罩并显示登录区，不修改业务数据，也不触碰数据库。
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
      if(text) text.textContent="启动等待超时，请使用连接诊断或稍后重试";
      const hint=document.getElementById("authHint");
      if(hint && !hint.textContent) hint.textContent="页面已解除卡死，当前仍在等待登录服务响应。";
      console.warn("PaiMini boot watchdog released splash after 10s");
    }catch(error){
      console.warn("PaiMini boot watchdog failed",error);
    }
  },10000);
}

// 扩展绝不再参与核心启动。只有核心已经退出 booting 后才加载。
// 这样删除模式 / 只读模式即使自身请求异常，也不会把整个派mini锁在启动画面。
if(typeof window!=="undefined" && !window.__paiMiniStableExtensionsScheduled){
  window.__paiMiniStableExtensionsScheduled=true;

  let started=false;
  const startExtensions=()=>{
    if(started || !document.body || document.body.classList.contains("booting")) return;
    started=true;

    if(!window.__paiMiniDeleteModeLoading){
      window.__paiMiniDeleteModeLoading=true;
      import("./delete-mode.js?v=20260923-2").catch(error=>{
        console.warn("delete mode load failed",error);
        window.__paiMiniDeleteModeLoading=false;
      });
    }

    if(!window.__paiMiniReadonlyAccessLoading){
      window.__paiMiniReadonlyAccessLoading=true;
      import("./readonly-access.js?v=20260923-5").catch(error=>{
        console.warn("readonly access load failed",error);
        window.__paiMiniReadonlyAccessLoading=false;
      });
    }
  };

  const timer=setInterval(()=>{
    if(started){clearInterval(timer);return;}
    startExtensions();
  },250);

  setTimeout(()=>clearInterval(timer),20000);
}

// 店铺成员制仍保持关闭，待单独修复后再恢复。
