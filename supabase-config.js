export const SUPABASE_URL = "https://hwvtuybkozojypifxjto.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable___YrsbZwmyv_3KbYDhZSmw_zXBazZFr";

// Supabase 中转地址：默认仍优先直连，只有网络级失败才自动走 Cloudflare Worker。
export const SUPABASE_PROXY_URL = "https://paimini-proxy.jiaj200405.workers.dev";

const nativeFetch = globalThis.fetch?.bind(globalThis);

function isNetworkFailure(error){
  const message=String(error?.message||error||"").toLowerCase();
  return error instanceof TypeError ||
    message.includes("load failed") ||
    message.includes("failed to fetch") ||
    message.includes("network");
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

// Supabase 仍然优先直连。只有真正的网络级失败才尝试代理；
// HTTP 401/403/500 等正常服务端响应不会被代理重试，避免掩盖真实错误。
if(nativeFetch && !globalThis.__paiMiniSupabaseProxyFetchInstalled){
  globalThis.__paiMiniSupabaseProxyFetchInstalled=true;
  globalThis.fetch=async function paiMiniFetch(input,init){
    try{
      return await nativeFetch(input,init);
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

      // GET / HEAD 不能带 body。
      if(retryInit.method==="GET" || retryInit.method==="HEAD") delete retryInit.body;

      return nativeFetch(proxyUrl,retryInit);
    }
  };
}

// 启动故障二分排查：暂时停用所有可选扩展模块的自动加载。
// 功能文件和数据库都保留，只是不在启动阶段 import。
// 若核心页面恢复，后续将逐个恢复扩展以定位具体模块。

// 启动保险：核心程序如果卡在 Supabase 会话/初始化请求，最多等待 8 秒。
// 只解除启动遮罩并显示登录区，不修改任何业务数据，也不触碰数据库。
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
      console.warn("PaiMini boot watchdog released splash after 8s");
    }catch(error){
      console.warn("PaiMini boot watchdog failed",error);
    }
  },8000);
}
