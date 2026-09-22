// PaiMini shop membership isolated shell.
// Phase 2: read joined shops from the already-loaded core state only.
// No membership RPCs, no extra auth reads, no page reloads.

let mounted=false;

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

function ensureStyle(){
  if(document.getElementById('shopMembershipShellStyle')) return;
  const style=document.createElement('style');
  style.id='shopMembershipShellStyle';
  style.textContent=`
    .shop-membership-shell{margin-top:16px}
    .shop-membership-shell .shell-note{padding:14px 16px;border:1px solid var(--line);border-radius:16px;background:var(--paper)}
    .shop-membership-shell .shell-note b{display:block;margin-bottom:4px}
    .shop-membership-shell .shell-note small{color:var(--muted);line-height:1.55}
    .shop-membership-shell .joined-list{display:grid;gap:9px;margin-top:10px}
    .shop-membership-shell .joined-item{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 12px;border:1px solid var(--line);border-radius:14px;background:var(--paper)}
    .shop-membership-shell .joined-item small{display:block;color:var(--muted);margin-top:3px}
    .shop-membership-shell .joined-badge{font-size:12px;padding:5px 9px;border-radius:999px;background:var(--pink-soft);white-space:nowrap}
    .shop-membership-shell .joined-empty{padding:12px;border:1px dashed var(--line);border-radius:14px;color:var(--muted);font-size:12px}
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
    box.innerHTML='<div class="joined-empty">目前没有已加入的店铺。当前阶段只读取核心已经加载好的店铺数据，不会额外请求 Supabase。</div>';
    return;
  }
  box.innerHTML=rows.map(shop=>`
    <div class="joined-item">
      <div><b>${safe(shop.name||'未命名店铺')}</b><small>已加入 · 只读展示</small></div>
      <span class="joined-badge">成员</span>
    </div>`).join('');
}

function mountShell(){
  if(mounted) return true;
  const page=document.getElementById('page-shops');
  if(!page) return false;
  ensureStyle();
  let card=document.getElementById('shopMembershipShellCard');
  if(!card){
    card=document.createElement('div');
    card.id='shopMembershipShellCard';
    card.className='card shop-membership-shell';
    card.innerHTML=`
      <div class="card-title">
        <div><b>店铺成员制 ♡</b><small>隔离加载 · 第2阶段</small></div>
      </div>
      <div class="shell-note">
        <b>我加入的店铺</b>
        <small>只读取主程序已经加载好的店铺状态，不调用任何成员 RPC，不读取邀请，不允许加入、退出或成员管理。</small>
        <div id="shopMembershipJoinedList" class="joined-list"></div>
      </div>`;
    page.querySelector('.page-head')?.insertAdjacentElement('afterend',card);
  }
  renderJoinedShops();
  mounted=true;
  return true;
}

export async function initShopMembershipShell(){
  const ok=mountShell();
  if(!ok) throw new Error('shop page not ready');
  return {status:'ready',phase:'joined-shops-readonly'};
}

export function refreshShopMembershipShell(){
  renderJoinedShops();
}

export function destroyShopMembershipShell(){
  document.getElementById('shopMembershipShellCard')?.remove();
  document.getElementById('shopMembershipShellStyle')?.remove();
  mounted=false;
}
