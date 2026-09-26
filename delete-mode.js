// 派Mini 删除模式
// 默认隐藏所有危险删除按钮。用户需要在「设置」里显式开启删除模式后才显示。
// 使用 sessionStorage：刷新当前标签页仍保留，但新会话默认关闭，减少误删风险。

const DELETE_MODE_KEY='paimini-delete-mode-enabled';
const DELETE_SELECTORS=[
  '[data-delete-shop]',
  '[data-delete-category]',
  '[data-delete-item]',
  '[data-delete-customer]',
  '[data-delete-record]',
  '[data-delete-wallet]'
];
const DELETE_SELECTOR=DELETE_SELECTORS.join(',');

function toast(message){
  if(window.paiMiniOrderBridge?.toast){window.paiMiniOrderBridge.toast(message);return}
  const el=document.getElementById('toast');
  if(!el)return;
  el.textContent=message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer=setTimeout(()=>el.classList.remove('show'),2200);
}

function isReadonly(){
  return document.body.classList.contains('paimini-readonly');
}

function storedEnabled(){
  try{return sessionStorage.getItem(DELETE_MODE_KEY)==='1'}catch{return false}
}

function setStoredEnabled(value){
  try{sessionStorage.setItem(DELETE_MODE_KEY,value?'1':'0')}catch{}
}

function injectStyle(){
  if(document.getElementById('deleteModeStyle'))return;
  const style=document.createElement('style');
  style.id='deleteModeStyle';
  const hiddenSelectors=DELETE_SELECTORS.map(selector=>`body:not(.paimini-delete-mode) ${selector}`).join(',');
  style.textContent=`
    ${hiddenSelectors}{display:none!important}
    .delete-mode-card{margin-top:16px}
    .delete-mode-row{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}
    .delete-mode-copy small{display:block;color:var(--muted);line-height:1.55;margin-top:4px}
    .delete-mode-status{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;background:var(--pink-soft);font-size:12px}
    .delete-mode-status.on{font-weight:700}
    .delete-mode-warning{margin-top:10px;font-size:12px;color:var(--muted);line-height:1.55}
    @media(max-width:720px){.delete-mode-row{align-items:flex-start;flex-direction:column}.delete-mode-row .btn{width:100%}}
  `;
  document.head.appendChild(style);
}

function injectCard(){
  const page=document.getElementById('page-settings');
  if(!page||document.getElementById('deleteModeCard'))return false;

  const card=document.createElement('div');
  card.id='deleteModeCard';
  card.className='card delete-mode-card';
  card.innerHTML=`
    <div class="card-title">
      <div><b>删除模式</b><small>平时隐藏删除按钮，需要时再临时开启</small></div>
    </div>
    <div class="delete-mode-row">
      <div class="delete-mode-copy">
        <span id="deleteModeStatus" class="delete-mode-status">已关闭</span>
        <small>开启后会显示店铺、价格分类/项目、顾客档案、消费记录、预存套餐等已有删除按钮。</small>
      </div>
      <button id="toggleDeleteModeBtn" class="btn ghost" type="button">开启删除模式</button>
    </div>
    <div class="delete-mode-warning">删除店铺现在会移入回收站，不会删除价格表、老板、消费记录、预存或权益；可以在“我的店铺”里恢复。删除预存套餐仍只删除模板，已发放的余额、权益和流水不会跟着消失。</div>
  `;

  page.querySelector('.page-head')?.insertAdjacentElement('afterend',card);
  document.getElementById('toggleDeleteModeBtn')?.addEventListener('click',toggleDeleteMode);
  render();
  return true;
}

function render(){
  const enabled=storedEnabled()&&!isReadonly();
  document.body.classList.toggle('paimini-delete-mode',enabled);

  const status=document.getElementById('deleteModeStatus');
  const button=document.getElementById('toggleDeleteModeBtn');
  if(status){
    status.textContent=enabled?'已开启':'已关闭';
    status.classList.toggle('on',enabled);
  }
  if(button){
    button.textContent=enabled?'关闭删除模式':'开启删除模式';
    button.disabled=isReadonly();
    button.title=isReadonly()?'账号已到期，当前为只读模式':'';
  }
}

function toggleDeleteMode(){
  if(isReadonly()){
    setStoredEnabled(false);
    render();
    toast('账号已到期，当前为只读模式');
    return;
  }

  if(storedEnabled()){
    setStoredEnabled(false);
    render();
    toast('删除模式已关闭');
    return;
  }

  const ok=confirm('开启删除模式后，各页面会显示删除按钮。删除操作可能不可恢复，确定开启吗？');
  if(!ok)return;
  setStoredEnabled(true);
  render();
  toast('删除模式已开启');
}

// 捕获阶段再做一道保险：即使 DOM 被手动改出删除按钮，关闭删除模式时也不会执行删除。
document.addEventListener('click',event=>{
  const target=event.target.closest?.(DELETE_SELECTOR);
  if(!target)return;

  if(isReadonly()||!storedEnabled()){
    event.preventDefault();
    event.stopImmediatePropagation();
    if(isReadonly())toast('账号已到期，当前为只读模式');
    else toast('请先到「设置」开启删除模式');
    return;
  }

  // 预存套餐原本没有二次确认，这里补上；店铺等原功能已有自己的确认框。
  if(target.matches('[data-delete-wallet]')){
    const ok=confirm('确定删除这个预存套餐模板吗？已经发放给老板的余额、权益和流水会保留。');
    if(!ok){
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }
},true);

injectStyle();
injectCard();
render();

const observer=new MutationObserver(()=>{
  injectCard();
  if(isReadonly()&&storedEnabled())setStoredEnabled(false);
  render();
});
observer.observe(document.documentElement,{childList:true,subtree:true});
