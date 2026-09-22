// PaiMini shop membership isolated shell.
// Phase 1: UI shell only. No Supabase RPCs, no auth reads, no reloads.

let mounted=false;

function ensureStyle(){
  if(document.getElementById('shopMembershipShellStyle')) return;
  const style=document.createElement('style');
  style.id='shopMembershipShellStyle';
  style.textContent=`
    .shop-membership-shell{margin-top:16px}
    .shop-membership-shell .shell-note{padding:14px 16px;border:1px solid var(--line);border-radius:16px;background:var(--paper)}
    .shop-membership-shell .shell-note b{display:block;margin-bottom:4px}
    .shop-membership-shell .shell-note small{color:var(--muted);line-height:1.55}
  `;
  document.head.appendChild(style);
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
        <div><b>店铺成员制 ♡</b><small>隔离加载测试版</small></div>
      </div>
      <div class="shell-note">
        <b>成员模块已安全挂载</b>
        <small>当前阶段不调用任何店铺成员 RPC。即使本模块失败，也不会影响派单、价格表、顾客档案、消费记录或店铺编辑。</small>
      </div>`;
    page.querySelector('.page-head')?.insertAdjacentElement('afterend',card);
  }
  mounted=true;
  return true;
}

export async function initShopMembershipShell(){
  const ok=mountShell();
  if(!ok) throw new Error('shop page not ready');
  return {status:'ready',phase:'shell-only'};
}

export function destroyShopMembershipShell(){
  document.getElementById('shopMembershipShellCard')?.remove();
  document.getElementById('shopMembershipShellStyle')?.remove();
  mounted=false;
}
