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

// 派Mini 扩展功能：预存套餐与附赠权益。
if(typeof window!=="undefined" && !window.__paiMiniWalletFeaturesLoading){
  window.__paiMiniWalletFeaturesLoading=true;
  import("./wallet-features.js?v=20260923-2").catch(error=>{
    console.warn("wallet features load failed",error);
    window.__paiMiniWalletFeaturesLoading=false;
  });
}

// 老板档案：预存余额、权益库存、流水、手动调整、充值撤销、CSV 导出。
if(typeof window!=="undefined" && !window.__paiMiniBossWalletLoading){
  window.__paiMiniBossWalletLoading=true;
  import("./boss-wallet.js?v=20260923-2").catch(error=>{
    console.warn("boss wallet load failed",error);
    window.__paiMiniBossWalletLoading=false;
  });
}

// 派单联动老板钱包：保存订单时可直接使用预存余额与权益。
if(typeof window!=="undefined" && !window.__paiMiniOrderWalletLoading){
  window.__paiMiniOrderWalletLoading=true;
  import("./order-wallet.js?v=20260923-1").catch(error=>{
    console.warn("order wallet load failed",error);
    window.__paiMiniOrderWalletLoading=false;
  });
}

// 店铺成员制：普通用户只能看到自己创建或已加入的店铺；邀请 / 加入统一放在「小店」。
if(typeof window!=="undefined" && !window.__paiMiniShopMembershipLoading){
  window.__paiMiniShopMembershipLoading=true;
  import("./shop-membership.js?v=20260923-2").catch(error=>{
    console.warn("shop membership load failed",error);
    window.__paiMiniShopMembershipLoading=false;
  });
}

// 将预存套餐独立成与价格表并列的一级分区。
if(typeof window!=="undefined" && !window.__paiMiniPrepaidPageLoading){
  window.__paiMiniPrepaidPageLoading=true;
  import("./prepaid-page.js?v=20260923-1").catch(error=>{
    console.warn("prepaid page load failed",error);
    window.__paiMiniPrepaidPageLoading=false;
  });
}

// 邀请码到期后进入只读模式：仍可查看历史数据，续费后恢复编辑。
if(typeof window!=="undefined" && !window.__paiMiniReadonlyAccessLoading){
  window.__paiMiniReadonlyAccessLoading=true;
  import("./readonly-access.js?v=20260923-4").catch(error=>{
    console.warn("readonly access load failed",error);
    window.__paiMiniReadonlyAccessLoading=false;
  });
}

// 删除模式：默认隐藏危险删除按钮，只在设置中显式开启后显示。
if(typeof window!=="undefined" && !window.__paiMiniDeleteModeLoading){
  window.__paiMiniDeleteModeLoading=true;
  import("./delete-mode.js?v=20260923-1").catch(error=>{
    console.warn("delete mode load failed",error);
    window.__paiMiniDeleteModeLoading=false;
  });
}
