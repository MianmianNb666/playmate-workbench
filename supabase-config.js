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

// 预存恢复版：只先创建轻量页面，不立即读取账务数据。
// 用户真正点进「预存」时才加载余额管理 + 预存套餐预设 + 统一发放流程。
if(typeof window!=="undefined" && !window.__paiMiniPrepaidSectionScheduled){
  window.__paiMiniPrepaidSectionScheduled=true;
  let shellReady=false;
  let managerStarted=false;

  const loadManager=async()=>{
    if(managerStarted)return;
    managerStarted=true;
    try{
      const mod=await import("./prepaid-manager-safe.js?v=20260923-prepaid-lazy2");
      await mod.initPrepaidManagerSafe?.();
      const presets=await import("./prepaid-presets-safe.js?v=20260923-prepaid-presets1");
      await presets.initPrepaidPresetsSafe?.();
      const polish=await import("./prepaid-layout-polish.js?v=20260923-prepaid-layout1");
      polish.applyPrepaidLayoutPolish?.();
      const unified=await import("./prepaid-unified-safe.js?v=20260923-prepaid-unified1");
      await unified.initPrepaidUnifiedSafe?.();
    }catch(error){
      managerStarted=false;
      console.warn("prepaid manager lazy load failed",error);
      window.paiMiniOrderBridge?.toast?.("预存模块读取失败，请稍后重试");
    }
  };

  const startPrepaidShell=async()=>{
    const app=document.getElementById("appRoot");
    if(shellReady || !document.body || document.body.classList.contains("booting") || !app || app.classList.contains("hidden")) return;
    shellReady=true;
    try{
      await import("./prepaid-page.js?v=20260923-prepaid-shell-clean2");
      const btn=document.querySelector('.nav-tab[data-page="prepaid"]');
      btn?.addEventListener("click",()=>void loadManager(),{passive:true});
    }catch(error){
      shellReady=false;
      console.warn("prepaid shell load failed",error);
    }
  };

  const prepaidTimer=setInterval(()=>{
    if(shellReady){clearInterval(prepaidTimer);return;}
    void startPrepaidShell();
  },300);
  setTimeout(()=>clearInterval(prepaidTimer),30000);
}

// 顾客档案显示预存余额。只增强展示，不改顾客保存逻辑。
if(typeof window!=="undefined" && !window.__paiMiniCustomerPrepaidBadgesScheduled){
  window.__paiMiniCustomerPrepaidBadgesScheduled=true;
  let badgesStarted=false;
  const startBadges=async()=>{
    const app=document.getElementById("appRoot");
    if(badgesStarted || !document.body || document.body.classList.contains("booting") || !app || app.classList.contains("hidden")) return;
    badgesStarted=true;
    try{
      const mod=await import("./customer-prepaid-badge-safe.js?v=20260923-customer-prepaid1");
      await mod.initCustomerPrepaidBadgesSafe?.();
    }catch(error){
      badgesStarted=false;
      console.warn("customer prepaid badges load failed",error);
    }
  };
  const badgesTimer=setInterval(()=>{
    if(badgesStarted){clearInterval(badgesTimer);return;}
    void startBadges();
  },450);
  setTimeout(()=>clearInterval(badgesTimer),30000);
}

// 派单页结算选择器：核心页面显示后独立加载。
if(typeof window!=="undefined" && !window.__paiMiniSettlementScheduled){
  window.__paiMiniSettlementScheduled=true;
  let settlementStarted=false;
  const startSettlement=async()=>{
    const app=document.getElementById("appRoot");
    if(settlementStarted || !document.body || document.body.classList.contains("booting") || !app || app.classList.contains("hidden")) return;
    settlementStarted=true;
    try{
      const mod=await import("./order-settlement-safe.js?v=20260923-settlement1");
      await mod.initOrderSettlementSafe?.();
      const atomic=await import("./order-wallet-atomic-safe.js?v=20260923-atomic1");
      await atomic.initOrderWalletAtomicSafe?.();
    }catch(error){
      settlementStarted=false;
      console.warn("order settlement safe load failed",error);
    }
  };
  const settlementTimer=setInterval(()=>{
    if(settlementStarted){clearInterval(settlementTimer);return;}
    void startSettlement();
  },350);
  setTimeout(()=>clearInterval(settlementTimer),30000);
}

// 报备规则：核心页面显示后独立加载，只增强“我的店铺 / 复制报备”。
if(typeof window!=="undefined" && !window.__paiMiniReportRulesScheduled){
  window.__paiMiniReportRulesScheduled=true;
  let reportRulesStarted=false;
  const startReportRules=async()=>{
    const app=document.getElementById("appRoot");
    if(reportRulesStarted || !document.body || document.body.classList.contains("booting") || !app || app.classList.contains("hidden")) return;
    reportRulesStarted=true;
    try{
      const mod=await import("./report-rules-safe.js?v=20260923-report-rules1");
      await mod.initReportRulesSafe?.();
      const copyOnly=await import("./report-rules-copyonly.js?v=20260923-copyonly1");
      copyOnly.applyReportRulesCopyOnly?.();
    }catch(error){
      reportRulesStarted=false;
      console.warn("report rules safe load failed",error);
    }
  };
  const reportRulesTimer=setInterval(()=>{
    if(reportRulesStarted){clearInterval(reportRulesTimer);return;}
    void startReportRules();
  },400);
  setTimeout(()=>clearInterval(reportRulesTimer),30000);
}

// 老板全部流水 PNG 导出修复：独立接管该按钮，普通小票不受影响。
if(typeof window!=="undefined" && !window.__paiMiniBossStatementExportScheduled){
  window.__paiMiniBossStatementExportScheduled=true;
  let exportFixStarted=false;
  const startBossExportFix=async()=>{
    const app=document.getElementById("appRoot");
    const btn=document.getElementById("exportBossStatementBtn");
    if(exportFixStarted || !document.body || document.body.classList.contains("booting") || !app || app.classList.contains("hidden") || !btn) return;
    exportFixStarted=true;
    try{
      const mod=await import("./boss-statement-export-safe.js?v=20260923-boss-export1");
      mod.initBossStatementExportSafe?.();
    }catch(error){
      exportFixStarted=false;
      console.warn("boss statement export safe load failed",error);
    }
  };
  const bossExportTimer=setInterval(()=>{
    if(exportFixStarted){clearInterval(bossExportTimer);return;}
    void startBossExportFix();
  },500);
  setTimeout(()=>clearInterval(bossExportTimer),30000);
}

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
