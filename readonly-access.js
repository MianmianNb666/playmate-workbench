import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";

const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const READONLY_CHECK_TIMEOUT_MS=7000;

function withDeadline(promise,ms=READONLY_CHECK_TIMEOUT_MS){
  let timer;
  const timeout=new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new Error('readonly access check timeout')),ms);
  });
  return Promise.race([promise,timeout]).finally(()=>clearTimeout(timer));
}

function formatDate(value){
  if(!value)return '';
  try{return new Date(value).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}catch{return String(value)}
}

function injectStyle(){
  if(document.getElementById('readonlyAccessStyle'))return;
  const style=document.createElement('style');
  style.id='readonlyAccessStyle';
  style.textContent=`
    .readonly-banner{margin:12px 18px 0;padding:14px 16px;border:1px solid var(--line);border-radius:18px;background:var(--pink-soft);display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}
    .readonly-banner b{display:block;margin-bottom:3px}.readonly-banner small{color:var(--muted);line-height:1.5}.readonly-renew{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.readonly-renew input{min-width:220px}.readonly-disabled{opacity:.5;pointer-events:none}
    @media(max-width:720px){.readonly-banner{margin:10px 10px 0}.readonly-renew{width:100%}.readonly-renew input{min-width:0;flex:1 1 180px}}
  `;
  document.head.appendChild(style);
}

function markReadonlyDisabled(el){
  if(!el)return;
  el.disabled=true;
  el.dataset.paiminiReadonlyDisabled='1';
  el.classList.add('readonly-disabled');
  el.title='账号已到期，当前为只读模式';
}

function disableKnownWrites(){
  const ids=[
    'saveRecordBtn','saveWholeOrderBtn','savePriceItemBtn','saveItemBtn','saveCategoryBtn','saveShopBtn','saveCustomerBtn',
    'saveTemplateBtn','saveReceiptBtn','saveProfileBtn','saveWalletPresetBtn','addDraftBenefitBtn',
    'joinShopBtn','toggleShopInviteBtn','regenerateShopInviteBtn'
  ];
  ids.forEach(id=>markReadonlyDisabled(document.getElementById(id)));
  document.querySelectorAll('[data-delete-shop],[data-delete-category],[data-delete-item],[data-delete-customer],[data-delete-record],[data-delete-wallet],[data-apply-wallet],[data-visibility],[data-leave-shop],[data-remove-shop-member],#toggleDeleteModeBtn').forEach(markReadonlyDisabled);
}

function restoreReadonlyDisabled(){
  document.querySelectorAll('[data-paimini-readonly-disabled="1"],.readonly-disabled').forEach(el=>{
    if(el.dataset.paiminiReadonlyDisabled==='1' || el.title==='账号已到期，当前为只读模式'){
      el.disabled=false;
      delete el.dataset.paiminiReadonlyDisabled;
      el.classList.remove('readonly-disabled');
      if(el.title==='账号已到期，当前为只读模式') el.removeAttribute('title');
    }
  });
}

function removeReadonlyState(){
  document.getElementById('readonlyAccessBanner')?.remove();
  document.body.classList.remove('paimini-readonly');
  restoreReadonlyDisabled();
}

function shouldBeReadonly(status){
  if(!status || typeof status!=='object') return false;
  // 核心权限判定优先。只要 has_access 明确为 true，就绝不进入只读。
  if(status.has_access===true) return false;

  const until=status.valid_until ? new Date(status.valid_until).getTime() : NaN;
  if(Number.isFinite(until) && until>Date.now()) return false;

  return status.read_only===true || status.has_access===false;
}

async function renderReadonly(status){
  injectStyle();
  document.body.classList.add('paimini-readonly');
  document.body.classList.remove('paimini-delete-mode');
  try{sessionStorage.setItem('paimini-delete-mode-enabled','0')}catch{}
  const app=document.getElementById('appRoot');
  if(!app)return;

  let banner=document.getElementById('readonlyAccessBanner');
  if(!banner){
    banner=document.createElement('div');
    banner.id='readonlyAccessBanner';
    banner.className='readonly-banner';
    const top=app.querySelector('.topbar');
    if(top)top.insertAdjacentElement('afterend',banner);else app.prepend(banner);
  }

  banner.innerHTML=`
    <div>
      <b>账号已到期 · 当前为只读模式 ♡</b>
      <small>历史数据仍可查看和导出，但不能新增、修改或删除。到期时间：${formatDate(status?.valid_until)||'未知'}</small>
    </div>
    <div class="readonly-renew">
      <input id="readonlyRenewCode" autocomplete="off" placeholder="输入续费邀请码">
      <button id="readonlyRenewBtn" class="btn primary" type="button">续费恢复编辑</button>
      <small id="readonlyRenewHint"></small>
    </div>`;

  disableKnownWrites();

  document.getElementById('readonlyRenewBtn')?.addEventListener('click',async()=>{
    const code=(document.getElementById('readonlyRenewCode')?.value||'').trim();
    const hint=document.getElementById('readonlyRenewHint');
    if(!code){if(hint)hint.textContent='先输入续费邀请码';return}
    if(hint)hint.textContent='正在兑换…';
    try{
      const {data,error}=await withDeadline(supabase.rpc('redeem_renewal_code',{p_code:code}));
      if(error){if(hint)hint.textContent='续费失败：'+error.message;return}
      if(!data?.success){
        if(hint)hint.textContent=data?.reason==='ALREADY_USED_BY_USER'?'这个邀请码你已经使用过':'邀请码无效、已使用或已过期';
        return;
      }
      if(hint)hint.textContent=`续费成功，+${data.added_days}天，正在恢复编辑…`;
      setTimeout(()=>location.reload(),700);
    }catch(error){
      if(hint)hint.textContent='续费检查超时，请稍后重试';
      console.warn('readonly renewal failed',error);
    }
  });
}

async function refreshAccess(){
  try{
    const {data:sessionData}=await withDeadline(supabase.auth.getSession());
    if(!sessionData?.session){removeReadonlyState();return}

    const {data,error}=await withDeadline(supabase.rpc('get_access_status'));
    if(error){
      console.warn('readonly access rpc failed',error);
      removeReadonlyState();
      return;
    }

    if(shouldBeReadonly(data)) await renderReadonly(data);
    else removeReadonlyState();
  }catch(error){
    // 检查失败时宁可保持可编辑，也绝不能误锁有效账号。
    console.warn('readonly access check skipped',error);
    removeReadonlyState();
  }
}

// 不使用顶层 await，避免只读模块自己阻塞页面启动。
void refreshAccess();
supabase.auth.onAuthStateChange(()=>setTimeout(()=>void refreshAccess(),120));

// 动态模块稍后生成按钮时，只有已经确认只读才补禁用。
const observer=new MutationObserver(()=>{
  if(document.body.classList.contains('paimini-readonly'))disableKnownWrites();
});
observer.observe(document.documentElement,{childList:true,subtree:true});
