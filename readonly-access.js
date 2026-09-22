import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";

const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});

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

function disableKnownWrites(){
  const ids=[
    'saveRecordBtn','saveWholeOrderBtn','savePriceItemBtn','saveItemBtn','saveCategoryBtn','saveShopBtn','saveCustomerBtn',
    'saveTemplateBtn','saveReceiptBtn','saveProfileBtn','saveWalletPresetBtn','addDraftBenefitBtn',
    'joinShopBtn','toggleShopInviteBtn','regenerateShopInviteBtn',
    'settingsRenewBtn','expiredRenewBtn'
  ];
  ids.forEach(id=>{
    const el=document.getElementById(id);
    if(el && !['settingsRenewBtn','expiredRenewBtn'].includes(id)){
      el.disabled=true;
      el.classList.add('readonly-disabled');
      el.title='账号已到期，当前为只读模式';
    }
  });
  document.querySelectorAll('[data-delete-shop],[data-delete-category],[data-delete-item],[data-delete-customer],[data-delete-record],[data-delete-wallet],[data-apply-wallet],[data-visibility],[data-leave-shop],#toggleDeleteModeBtn').forEach(el=>{
    el.disabled=true;
    el.classList.add('readonly-disabled');
    el.title='账号已到期，当前为只读模式';
  });
}

function removeBanner(){
  document.getElementById('readonlyAccessBanner')?.remove();
  document.body.classList.remove('paimini-readonly');
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
    const {data,error}=await supabase.rpc('redeem_renewal_code',{p_code:code});
    if(error){if(hint)hint.textContent='续费失败：'+error.message;return}
    if(!data?.success){
      if(hint)hint.textContent=data?.reason==='ALREADY_USED_BY_USER'?'这个邀请码你已经使用过':'邀请码无效、已使用或已过期';
      return;
    }
    if(hint)hint.textContent=`续费成功，+${data.added_days}天，正在恢复编辑…`;
    setTimeout(()=>location.reload(),700);
  });
}

async function refreshAccess(){
  const {data:sessionData}=await supabase.auth.getSession();
  if(!sessionData?.session){removeBanner();return}
  const {data,error}=await supabase.rpc('get_access_status');
  if(error)return;
  if(data?.read_only)await renderReadonly(data);else removeBanner();
}

await refreshAccess();
supabase.auth.onAuthStateChange(()=>setTimeout(refreshAccess,80));

// 动态模块（预存套餐 / 店铺成员 / 删除模式）可能稍后才生成按钮，过期模式下再补一次禁用。
const observer=new MutationObserver(()=>{
  if(document.body.classList.contains('paimini-readonly'))disableKnownWrites();
});
observer.observe(document.documentElement,{childList:true,subtree:true});
