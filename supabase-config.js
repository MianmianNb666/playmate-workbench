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
