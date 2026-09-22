// PaiMini shop membership isolated module.
// Phase 4: owner invite controls + join/leave/remove in one isolated module.
// Core startup remains untouched. Every membership RPC has its own timeout and degrades locally.

let mounted=false;
let destroyed=false;
let busy=false;
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

async function rpc(name,args={}){
  const ctx=coreContext();
  const supabase=ctx?.supabase;
  if(!supabase?.rpc) throw new Error('CORE_SUPABASE_NOT_READY');
  const result=await Promise.race([
    supabase.rpc(name,args),
    timeoutPromise(RPC_TIMEOUT_MS,`${name} timeout`)
  ]);
  if(result?.error) throw result.error;
  return result?.data;
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
    .shop-membership-shell .member-list,.shop-membership-shell .joined-list{display:grid;gap:9px;margin-top:10px}
    .shop-membership-shell .member-item,.shop-membership-shell .joined-item{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 12px;border:1px solid var(--line);border-radius:14px;background:var(--paper)}
    .shop-membership-shell .member-item small,.shop-membership-shell .joined-item small{display:block;color:var(--muted);margin-top:3px}
    .shop-membership-shell .member-badge{font-size:12px;padding:5px 9px;border-radius:999px;background:var(--pink-soft);white-space:nowrap}
    .shop-membership-shell .member-state{padding:12px;border:1px dashed var(--line);border-radius:14px;color:var(--muted);font-size:12px}
    .shop-membership-shell .membership-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
    .shop-membership-shell .join-row{display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:10px}
    .shop-membership-shell .join-row input{min-width:0}
    .shop-membership-shell .invite-box{display:grid;gap:8px;margin-top:10px;padding:12px;border:1px dashed var(--line);border-radius:14px}
    .shop-membership-shell .invite-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}
    .shop-membership-shell .status-line{margin-top:8px;font-size:12px;color:var(--muted)}
    .shop-membership-shell button[disabled]{opacity:.55;cursor:not-allowed}
    @media(max-width:640px){.shop-membership-shell .join-row{grid-template-columns:1fr}.shop-membership-shell .member-item,.shop-membership-shell .joined-item{align-items:flex-start;flex-direction:column}}
  `;
  document.head.appendChild(style);
}

function sessionInfo(){
  const ctx=coreContext();
  return {ctx,uid:ctx?.state?.session?.user?.id||null,shop:ctx?.shop||null,shops:Array.isArray(ctx?.state?.shops)?ctx.state.shops:[]};
}

function joinedShops(){
  const {uid,shops}=sessionInfo();
  if(!uid) return [];
  return shops.filter(shop=>shop?.user_id && shop.user_id!==uid);
}

function isCurrentShopOwned(){
  const {uid,shop}=sessionInfo();
  return !!uid && !!shop && shop.user_id===uid;
}

function status(message){
  const box=document.getElementById('shopMembershipStatus');
  if(box) box.textContent=message||'';
}

function setBusy(next,message=''){
  busy=next;
  document.querySelectorAll('#shopMembershipShellCard button').forEach(btn=>btn.disabled=next);
  if(message) status(message);
}

async function copyText(text){
  try{
    await navigator.clipboard.writeText(text);
    status('已复制 ♡');
  }catch{
    status('复制失败，请长按手动复制。');
  }
}

function renderJoined(){
  const box=document.getElementById('shopMembershipJoinedList');
  if(!box) return;
  const rows=joinedShops();
  if(!rows.length){
    box.innerHTML='<div class="member-state">目前没有已加入的店铺。</div>';
    return;
  }
  box.innerHTML=rows.map(shop=>`
    <div class="joined-item">
      <div><b>${safe(shop.name||'未命名店铺')}</b><small>成员店铺</small></div>
      <button class="tiny-btn" type="button" data-leave-shop="${safe(shop.id)}">退出店铺</button>
    </div>`).join('');
  box.querySelectorAll('[data-leave-shop]').forEach(btn=>btn.addEventListener('click',()=>leaveShop(btn.dataset.leaveShop)));
}

function renderMembers(rows=[]){
  const box=document.getElementById('shopMembershipRealMembers');
  if(!box) return;
  if(!rows.length){
    box.innerHTML='<div class="member-state">当前没有成员记录。</div>';
    return;
  }
  box.innerHTML=`<div class="member-list">${rows.map(member=>`
    <div class="member-item">
      <div>
        <b>${safe(member.display_name || member.email || (member.role==='owner'?'店主':'成员'))}</b>
        <small>${member.role==='owner'?'店主':'成员'}${member.email?` · ${safe(member.email)}`:''}</small>
      </div>
      <div class="membership-actions">
        <span class="member-badge">${member.role==='owner'?'店主':'成员'}</span>
        ${member.role==='member'?`<button class="tiny-btn" type="button" data-remove-member="${safe(member.user_id)}">移出</button>`:''}
      </div>
    </div>`).join('')}</div>`;
  box.querySelectorAll('[data-remove-member]').forEach(btn=>btn.addEventListener('click',()=>removeMember(btn.dataset.removeMember)));
}

async function loadOwnerData(){
  const {shop}=sessionInfo();
  if(!shop || !isCurrentShopOwned()){
    document.getElementById('shopMembershipOwnerPanel')?.classList.add('hidden');
    return;
  }
  document.getElementById('shopMembershipOwnerPanel')?.classList.remove('hidden');
  try{
    status('正在读取成员与邀请状态…');
    const [members,invite]=await Promise.all([
      rpc('list_my_shop_members',{p_shop_id:shop.id}),
      rpc('get_my_shop_invite',{p_shop_id:shop.id})
    ]);
    if(destroyed) return;
    renderMembers(Array.isArray(members)?members:[]);
    renderInvite(invite||{});
    status('成员数据已更新。');
  }catch(error){
    if(destroyed) return;
    console.warn('membership phase4 owner read degraded',error);
    document.getElementById('shopMembershipRealMembers').innerHTML='<div class="member-state">成员或邀请状态读取失败。只降级本卡片，主程序不受影响。</div>';
    status(error?.name==='MembershipTimeoutError'?'成员模块等待超时。':'成员模块返回错误。');
  }
}

function renderInvite(invite){
  const codeBox=document.getElementById('shopMembershipInviteCode');
  const stateBox=document.getElementById('shopMembershipInviteState');
  const toggle=document.getElementById('shopMembershipInviteToggle');
  const copyCode=document.getElementById('shopMembershipCopyCode');
  const copyLink=document.getElementById('shopMembershipCopyLink');
  const code=invite?.code||'';
  const enabled=!!invite?.is_enabled;
  if(codeBox) codeBox.textContent=code||'尚未生成';
  if(stateBox) stateBox.textContent=enabled?'当前：邀请已开启':'当前：邀请已关闭';
  if(toggle) toggle.textContent=enabled?'关闭邀请':'开启邀请';
  if(toggle) toggle.dataset.enabled=enabled?'1':'0';
  if(copyCode) copyCode.dataset.code=code;
  if(copyLink) copyLink.dataset.code=code;
}

async function previewAndJoin(){
  if(busy) return;
  const input=document.getElementById('shopMembershipJoinCode');
  const code=input?.value.trim();
  if(!code){status('先输入店铺邀请码。');return;}
  setBusy(true,'正在确认邀请…');
  try{
    const preview=await rpc('preview_shop_invite',{p_code:code});
    if(!preview?.success){status('邀请码无效、已关闭，或店铺暂不可加入。');return;}
    if(preview?.is_owner){status('这是你自己创建的店铺，不需要加入。');return;}
    if(preview?.already_joined){status(`你已经加入「${preview.shop_name||'该店铺'}」。`);return;}
    const ok=window.confirm(`确认加入「${preview.shop_name||'该店铺'}」吗？`);
    if(!ok){status('已取消加入。');return;}
    const result=await rpc('join_shop_by_code',{p_code:code});
    if(!result?.success) throw new Error(result?.reason||'JOIN_FAILED');
    status(`已加入「${result.shop_name||preview.shop_name||'店铺'}」。刷新页面后即可在主程序中使用。`);
    if(input) input.value='';
  }catch(error){
    console.warn('membership phase4 join failed',error);
    status(error?.name==='MembershipTimeoutError'?'加入等待超时，请稍后再试。':'加入失败，没有修改主程序。');
  }finally{setBusy(false);}
}

async function leaveShop(shopId){
  if(busy || !shopId) return;
  const shop=joinedShops().find(item=>item.id===shopId);
  if(!window.confirm(`确认退出「${shop?.name||'这家店铺'}」吗？`)) return;
  setBusy(true,'正在退出店铺…');
  try{
    const result=await rpc('leave_joined_shop',{p_shop_id:shopId});
    if(!result?.success) throw new Error(result?.reason||'LEAVE_FAILED');
    const {ctx}=sessionInfo();
    if(Array.isArray(ctx?.state?.shops)) ctx.state.shops=ctx.state.shops.filter(item=>item.id!==shopId);
    renderJoined();
    status('已退出店铺。若主程序其他位置仍显示旧店铺，刷新页面即可同步。');
  }catch(error){
    console.warn('membership phase4 leave failed',error);
    status(error?.name==='MembershipTimeoutError'?'退出等待超时，请稍后再试。':'退出失败，成员关系未确认修改。');
  }finally{setBusy(false);}
}

async function removeMember(userId){
  if(busy || !userId) return;
  const {shop}=sessionInfo();
  if(!shop || !isCurrentShopOwned()) return;
  if(!window.confirm('确认把这个成员移出当前店铺吗？')) return;
  setBusy(true,'正在移出成员…');
  try{
    const result=await rpc('remove_my_shop_member',{p_shop_id:shop.id,p_user_id:userId});
    if(!result?.success) throw new Error(result?.reason||'REMOVE_FAILED');
    await loadOwnerData();
    status('成员已移出。');
  }catch(error){
    console.warn('membership phase4 remove failed',error);
    status(error?.name==='MembershipTimeoutError'?'移出等待超时，请稍后再试。':'移出失败。');
  }finally{setBusy(false);}
}

async function toggleInvite(){
  if(busy) return;
  const {shop}=sessionInfo();
  const btn=document.getElementById('shopMembershipInviteToggle');
  if(!shop || !isCurrentShopOwned() || !btn) return;
  const next=btn.dataset.enabled!=='1';
  setBusy(true,next?'正在开启邀请…':'正在关闭邀请…');
  try{
    const result=await rpc('set_shop_invite_enabled',{p_shop_id:shop.id,p_enabled:next});
    renderInvite(result||{});
    status(next?'邀请已开启。':'邀请已关闭。原邀请码保留，重新开启后继续使用。');
  }catch(error){
    console.warn('membership phase4 toggle invite failed',error);
    status(error?.name==='MembershipTimeoutError'?'操作等待超时。':'邀请开关修改失败。');
  }finally{setBusy(false);}
}

async function regenerateInvite(){
  if(busy) return;
  const {shop}=sessionInfo();
  if(!shop || !isCurrentShopOwned()) return;
  if(!window.confirm('重新生成后，旧邀请码会立即失效。继续吗？')) return;
  setBusy(true,'正在重新生成邀请码…');
  try{
    const result=await rpc('regenerate_shop_invite',{p_shop_id:shop.id});
    renderInvite(result||{});
    status('新邀请码已生成，旧码已失效。');
  }catch(error){
    console.warn('membership phase4 regenerate failed',error);
    status(error?.name==='MembershipTimeoutError'?'生成等待超时。':'重新生成失败。');
  }finally{setBusy(false);}
}

function bindActions(){
  document.getElementById('shopMembershipJoinBtn')?.addEventListener('click',previewAndJoin);
  document.getElementById('shopMembershipRefreshBtn')?.addEventListener('click',()=>loadOwnerData());
  document.getElementById('shopMembershipInviteToggle')?.addEventListener('click',toggleInvite);
  document.getElementById('shopMembershipRegenerate')?.addEventListener('click',regenerateInvite);
  document.getElementById('shopMembershipCopyCode')?.addEventListener('click',event=>{
    const code=event.currentTarget.dataset.code||'';
    if(code) copyText(code); else status('当前没有邀请码可复制。');
  });
  document.getElementById('shopMembershipCopyLink')?.addEventListener('click',event=>{
    const code=event.currentTarget.dataset.code||'';
    if(!code){status('当前没有邀请码可复制。');return;}
    const url=new URL(location.href);
    url.search='';
    url.hash='';
    url.searchParams.set('join',code);
    copyText(url.toString());
  });
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
    <div class="card-title"><div><b>店铺成员制 ♡</b><small>隔离加载 · 第4阶段（完整成员操作）</small></div></div>

    <div class="shell-note">
      <b>加入店铺</b>
      <small>输入店主给你的邀请码。先预览店名，确认后才真正加入。</small>
      <div class="join-row"><input id="shopMembershipJoinCode" placeholder="例如 PM-XXXXXXXX"><button id="shopMembershipJoinBtn" class="btn primary" type="button">确认加入</button></div>
    </div>

    <div class="shell-note">
      <b>我加入的店铺</b>
      <small>这里显示主程序当前已经加载的成员店铺。退出操作只修改成员关系，不动你的个人顾客、记录和余额。</small>
      <div id="shopMembershipJoinedList" class="joined-list"></div>
    </div>

    <div id="shopMembershipOwnerPanel" class="shell-note">
      <b>当前店铺成员与邀请</b>
      <small>只有当前店铺的创建者能管理。所有写操作都需要你主动点击确认。</small>
      <div id="shopMembershipRealMembers" class="member-list"></div>
      <div class="invite-box">
        <div><small id="shopMembershipInviteState">正在读取邀请状态…</small></div>
        <div class="invite-code" id="shopMembershipInviteCode">读取中…</div>
        <div class="membership-actions">
          <button id="shopMembershipCopyCode" class="tiny-btn" type="button">复制邀请码</button>
          <button id="shopMembershipCopyLink" class="tiny-btn" type="button">复制邀请链接</button>
          <button id="shopMembershipInviteToggle" class="tiny-btn" type="button">开关邀请</button>
          <button id="shopMembershipRegenerate" class="tiny-btn" type="button">重新生成</button>
          <button id="shopMembershipRefreshBtn" class="tiny-btn" type="button">刷新成员</button>
        </div>
      </div>
    </div>
    <div id="shopMembershipStatus" class="status-line"></div>`;

  renderJoined();
  bindActions();
  mounted=true;
  return true;
}

export async function initShopMembershipShell(){
  destroyed=false;
  const ok=mountShell();
  if(!ok) throw new Error('shop page not ready');
  queueMicrotask(()=>loadOwnerData());
  return {status:'ready',phase:'membership-full-phase4'};
}

export function refreshShopMembershipShell(){
  renderJoined();
  queueMicrotask(()=>loadOwnerData());
}

export function destroyShopMembershipShell(){
  destroyed=true;
  document.getElementById('shopMembershipShellCard')?.remove();
  document.getElementById('shopMembershipShellStyle')?.remove();
  mounted=false;
}
