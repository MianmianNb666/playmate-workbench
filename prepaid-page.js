// PaiMini 独立「预存」分区。
// 只负责导航与承载现有余额/权益/套餐卡片，不改账务 RPC 逻辑。

function showPage(name){
  document.querySelectorAll('.page').forEach(el=>{
    el.classList.toggle('active',el.id===`page-${name}`);
  });
  document.querySelectorAll('.nav-tab').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.page===name);
  });
  document.body.classList.remove('mobile-drawer-open');
}

function ensurePrepaidPage(){
  const app=document.getElementById('appRoot');
  const nav=document.querySelector('.section-nav');
  if(!app||!nav)return false;

  let navBtn=document.querySelector('.nav-tab[data-page="prepaid"]');
  if(!navBtn){
    navBtn=document.createElement('button');
    navBtn.className='nav-tab';
    navBtn.type='button';
    navBtn.dataset.page='prepaid';
    navBtn.textContent='预存';
    const before=document.querySelector('.nav-tab[data-page="customers"]');
    nav.insertBefore(navBtn,before||document.querySelector('.nav-tab[data-page="records"]')||null);
    navBtn.addEventListener('click',()=>showPage('prepaid'));
  }else if(navBtn.textContent!=='预存'){
    navBtn.textContent='预存';
  }

  let page=document.getElementById('page-prepaid');
  if(!page){
    page=document.createElement('section');
    page.id='page-prepaid';
    page.className='page';
    page.innerHTML=`
      <div class="page-head">
        <div><small>PREPAID</small><h2>预存</h2></div>
        <span class="head-heart">♡</span>
      </div>
      <div class="card" style="margin-bottom:14px">
        <div class="card-title"><div><b>老板预存管理</b><small>查看余额、设置预存、管理权益和流水</small></div></div>
        <p class="muted" style="margin:0">选择老板后，可以增加或扣减预存余额、调整权益、查看每一笔变动，并导出明细。</p>
      </div>
      <div id="prepaidPageMount"></div>
    `;
    const before=document.getElementById('page-customers')||document.getElementById('page-records');
    app.insertBefore(page,before||null);
  }

  return true;
}

function moveCards(){
  if(!ensurePrepaidPage())return false;
  const mount=document.getElementById('prepaidPageMount');
  if(!mount)return false;

  let changed=false;
  const wallet=document.getElementById('bossWalletCard');
  if(wallet){
    const title=wallet.querySelector('.card-title b');
    const sub=wallet.querySelector('.card-title small');
    if(title&&title.textContent!=='老板预存余额 ♡'){title.textContent='老板预存余额 ♡';changed=true;}
    if(sub&&sub.textContent!=='设置预存、调整权益、查看流水与撤销记录'){sub.textContent='设置预存、调整权益、查看流水与撤销记录';changed=true;}
    if(wallet.parentElement!==mount){mount.appendChild(wallet);changed=true;}
  }

  const presets=document.getElementById('walletPresetCard');
  if(presets&&presets.parentElement!==mount){mount.appendChild(presets);changed=true;}
  return changed;
}

ensurePrepaidPage();
moveCards();

// 不再使用全页面 MutationObserver，避免 DOM 自己触发自己形成死循环。
// 用有限轮询等异步卡片出现，最多 15 秒，之后自动停止。
let attempts=0;
const timer=setInterval(()=>{
  attempts+=1;
  moveCards();
  if(attempts>=50 || (document.getElementById('bossWalletCard') && document.getElementById('bossWalletCard')?.parentElement===document.getElementById('prepaidPageMount'))){
    clearInterval(timer);
  }
},300);
