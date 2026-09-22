// PaiMini shop membership isolated shell.
// Phase 3b: keep phase-2 joined-shop display, plus ONE real read-only RPC.
// The only RPC enabled here is list_my_shop_members for a shop owned by the current user.
// No invite reads, no writes, no auth reads, no reloads.

let mounted=false;
let destroyed=false;
let rpcBusy=false;
// Global Supabase fetch guard allows up to 7s direct + 7s proxy fallback.
// Keep this wrapper longer than that, otherwise mobile gives up before proxy fallback can finish.
const RPC_TIMEOUT_MS=16000;

function safe(value){
  return String(value??'')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');
}

function coreContext(){
  try{return window.paiMiniOrderBridge?.getContext?.()||null}catch{return null}
}

function timeoutPromise(ms,label){
  return new Promise((_,reject)=>setTimeout(()=>{
    const error=new Error(label||'membership rpc timeout');
    error.name='MembershipTimeoutError';
    reject(error);
  },ms));
}

function ensureStyle(){
  if(document.getElementById('shopMembershipShellStyle')) return;
  const style=document.createElement('style');
  style.id='shopMembershipShellStyle';
  style.textContent=`
    .shop-membership-shell{margin-top:16px}
    .shop-membership-shell .shell-note{padding:14px 16px;border:1px solid var(--line);border-radius:16px;background:var(--paper)}
    .shop-membership-shell .shell-note+.shell-note{margin-top:10px}
    .shop-membership-shell .shell-note>b{display:block;margin-bottom:4px}
    .shop-membership-shell .shell-note small{color:var(--muted);line-height:1.55}
    .shop-membership-shell .joined-list,.shop-membership-shell .member-list{display:grid;gap:9px;margin-top:10px}
    .shop-membership-shell .joined-item,.shop-membership-shell .member-item{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 12px;border:1px solid var(--line);border-radius:14px;background:var(--paper)}
    .shop-membership-shell .joined-item small,.shop-membership-shell .member-item small{display:block;color:var(--muted);margin-top:3px}
    .shop-membership-shell .joined-badge,.shop-membership-shell .member-badge{font-size:12px;padding:5px 9px;border-radius:999px;background:var(--pink-soft);white-space:nowrap}
    .shop-membership-shell .joined-empty,.shop-membership-shell .member-state{padding:12px;border:1px dashed var(--line);border-radius:14px;color:var(--muted);font-size:12px}
    .shop-membership-shell .phase3-actions{margin-top:10px;display:flex;justify-content:flex-end}
  `;
  document.head.appendChild(style);
}

function joinedShopsFromCore(){
  const ctx=coreContext();
  const session=ctx?.state?.session;
  const shops=Array.isArray(ctx?.state?.shops)?ctx.state.shops:[];
  if(!session?.user?.id) return [];
  return shops.filter(shop=>shop?.user_id && shop.user_id!==session.user.id);
}

function renderJoinedShops(){
  const box=document.getElementById('shopMembershipJoinedList');
  if(!box) return;
  const rows=joinedShopsFromCore();
  if(!rows.length){
    box.innerHTML='<div class="joined-empty">目前没有已加入的店铺。这里仍只读取主程序已经加载好的店铺数据。</div>';
    return;
  }
  box.innerHTML=rows.map(shop=>`
    <div class="joined-item">
      <div><b>${safe(shop.name||'未命名店铺')}</b><small>已加入 · 核心现成数据</small></div>
      <span class="joined-badge">成员</span>
    </div>`).join('');
}

function currentOwnedShop(){
  const ctx=coreContext();
  const uid=ctx?.state?.session?.user?.id;
  const shop=ctx?.shop || null;
  if(!uid || !shop || shop.user_id!==uid) return null;
  return {ctx,shop};
}

function renderMemberState(html){
  const box=document.getElementById('shopMembershipRealMembers');
  if(box) box.innerHTML=html;
}

async function loadRealMembers(){
  if(rpcBusy || destroyed) return;
  const owned=currentOwnedShop();
  if(!owned){
    renderMemberState('<div class="member-state">当前选中的店铺不是你创建的店铺，所以本阶段不会读取它的成员名单。</div>');
    return;
  }

  const {ctx,shop}=owned;
  const supabase=ctx?.supabase;
  if(!supabase?.rpc){
    renderMemberState('<div class="member-state">核心连接尚未准备好。成员模块已降级，不影响其他功能。</div>');
    return;
  }

  rpcBusy=true;
  renderMemberState(`<div class="member-state">正在安全读取「${safe(shop.name||'当前店铺')}」成员…</div>`);
  try{
    const result=await Promise.race([
      supabase.rpc('list_my_shop_members',{p_shop_id:shop.id}),
      timeoutPromise(RPC_TIMEOUT_MS,'list_my_shop_members timeout')
    ]);
    if(destroyed) return;
    if(result?.error) throw result.error;
    const rows=Array.isArray(result?.data)?result.data:[];
    if(!rows.length){
      renderMemberState('<div class="member-state">成员读取成功，目前没有返回成员记录。</div>');
      return;
    }
    renderMemberState(`<div class="member-list">${rows.map(member=>`
      <div class="member-item">
        <div>
          <b>${safe(member.display_name || member.email || (member.role==='owner'?'店主':'成员'))}</b>
          <small>${member.role==='owner'?'店主':'成员'}${member.email?` · ${safe(member.email)}`:''}</small>
        </div>
        <span class="member-badge">${member.role==='owner'?'店主':'成员'}</span>
      </div>`).join('')}</div>`);
    window.__paiMiniMembershipRpcStatus='list-members-ok';
  }catch(error){
    if(destroyed) return;
    window.__paiMiniMembershipRpcStatus='list-members-degraded';
    console.warn('membership phase3b read-only RPC degraded',error);
    const timeout=error?.name==='MembershipTimeoutError';
    renderMemberState(`<div class="member-state">${timeout?'成员读取等待超时，直连和中转都没有及时返回。':'成员读取返回错误。'} 只降级本卡片，其他功能不受影响。</div>`);
  }finally{
    rpcBusy=false;
  }
}

function mountShell(){
  const page=document.getElementById('page-shops');
  if(!page) return false;
  ensureStyle();
  let card=document.getElementById('shopMembershipShellCard');
  if(!card){
    card=document.createElement('div');
    card.id='shopMembershipShellCard';
    card.className='card shop-membership-shell';
    page.querySelector('.page-head')?.insertAdjacentElement('afterend',card);
  }

  card.innerHTML=`
    <div class="card-title">
      <div><b>店铺成员制 ♡</b><small>隔离加载 · 第3阶段（只读）</small></div>
    </div>
    <div class="shell-note">
      <b>我加入的店铺</b>
      <small>继续使用主程序已经加载好的店铺状态，不增加网络请求。</small>
      <div id="shopMembershipJoinedList" class="joined-list"></div>
    </div>
    <div class="shell-note">
      <b>真实成员数据</b>
      <small>只启用一个只读 RPC。会先尝试直连，必要时允许核心网络保护切到中转；失败仍只降级本卡片。</small>
      <div id="shopMembershipRealMembers" class="member-list"></div>
      <div class="phase3-actions"><button id="shopMembershipRetryRead" class="tiny-btn" type="button">重新读取成员</button></div>
    </div>`;

  document.getElementById('shopMembershipRetryRead')?.addEventListener('click',()=>loadRealMembers());
  renderJoinedShops();
  mounted=true;
  return true;
}

export async function initShopMembershipShell(){
  destroyed=false;
  const ok=mountShell();
  if(!ok) throw new Error('shop page not ready');
  queueMicrotask(()=>loadRealMembers());
  return {status:'ready',phase:'real-members-readonly-phase3b'};
}

export function refreshShopMembershipShell(){
  renderJoinedShops();
}

export function destroyShopMembershipShell(){
  destroyed=true;
  document.getElementById('shopMembershipShellCard')?.remove();
  document.getElementById('shopMembershipShellStyle')?.remove();
  mounted=false;
}
