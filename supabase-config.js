export const SUPABASE_URL = "https://hwvtuybkozojypifxjto.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable___YrsbZwmyv_3KbYDhZSmw_zXBazZFr";

// Supabase 中转地址：默认优先直连，网络失败或超时后再尝试 Cloudflare Worker。
export const SUPABASE_PROXY_URL = "https://paimini-proxy.jiaj200405.workers.dev";

const nativeFetch = globalThis.fetch?.bind(globalThis);

function isNetworkFailure(error){
  const name=String(error?.name||"").toLowerCase();
  const message=String(error?.message||error||"").toLowerCase();
  return error instanceof TypeError ||
    name.includes("abort") ||
    name.includes("timeout") ||
    message.includes("load failed") ||
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
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

async function fetchWithTimeout(fetcher,input,init,timeoutMs=5000){
  const controller=new AbortController();
  const externalSignal=init?.signal || (input instanceof Request ? input.signal : null);
  let onAbort=null;

  if(externalSignal){
    if(externalSignal.aborted){
      controller.abort();
    }else{
      onAbort=()=>controller.abort();
      externalSignal.addEventListener("abort",onAbort,{once:true});
    }
  }

  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    return await fetcher(input,{...(init||{}),signal:controller.signal});
  }finally{
    clearTimeout(timer);
    if(externalSignal&&onAbort){
      try{externalSignal.removeEventListener("abort",onAbort)}catch{}
    }
  }
}

// 只给 Supabase 请求加超时和代理兜底，其他网络请求保持浏览器原行为。
if(nativeFetch && !globalThis.__paiMiniSupabaseProxyFetchInstalled){
  globalThis.__paiMiniSupabaseProxyFetchInstalled=true;
  globalThis.fetch=async function paiMiniFetch(input,init){
    const proxyUrl=toProxyUrl(input);
    if(!proxyUrl){
      return nativeFetch(input,init);
    }

    try{
      return await fetchWithTimeout(nativeFetch,input,init,5000);
    }catch(error){
      if(!isNetworkFailure(error)) throw error;

      const request=input instanceof Request ? input : null;
      const retryInit={
        method:init?.method || request?.method || "GET",
        headers:init?.headers || request?.headers,
        body:init?.body,
        cache:"no-store",
        redirect:init?.redirect || request?.redirect,
        credentials:"omit"
      };

      if(retryInit.method==="GET" || retryInit.method==="HEAD") delete retryInit.body;
      return fetchWithTimeout(nativeFetch,proxyUrl,retryInit,5000);
    }
  };
}

// 启动兜底：即使 Supabase / 扩展脚本异常，也不能让整个页面永远卡在 booting 空白层。
if(typeof window!=="undefined" && !window.__paiMiniBootFailsafeInstalled){
  window.__paiMiniBootFailsafeInstalled=true;
  setTimeout(()=>{
    const body=document.body;
    if(!body)return;
    body.classList.remove("booting");

    const auth=document.getElementById("authGate");
    const access=document.getElementById("accessGate");
    const app=document.getElementById("appRoot");
    const allHidden=[auth,access,app].every(el=>!el || el.classList.contains("hidden"));

    if(allHidden && auth){
      auth.classList.remove("hidden");
      const hint=document.getElementById("authHint");
      const status=document.getElementById("connectionStatus");
      const text=document.getElementById("connectionText");
      if(hint) hint.textContent="连接初始化超时，页面已恢复响应。可以点「连接诊断」检查网络。";
      if(status){status.classList.remove("hidden","good");status.classList.add("bad")}
      if(text) text.textContent="Supabase 连接超时";
    }
  },8000);
}

// 2026-09-23 紧急稳定模式：
// 暂停所有可选扩展的自动加载，先保证主站登录和基础功能可打开。
// 数据库 migration 与扩展文件全部保留，确认主站恢复后再逐个重新启用。
