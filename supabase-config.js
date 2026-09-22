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

// 派Mini 扩展功能：店铺公开/私密、预存/权益快捷库。
// 使用独立模块并加全局守卫，避免多个页面模块重复加载。
if(typeof window!=="undefined" && !window.__paiMiniWalletFeaturesLoading){
  window.__paiMiniWalletFeaturesLoading=true;
  import("./wallet-features.js?v=20260923-1").catch(error=>{
    console.warn("wallet features load failed",error);
    window.__paiMiniWalletFeaturesLoading=false;
  });
}
