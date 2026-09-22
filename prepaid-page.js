// 将“预存套餐库”从价格表中移动为独立一级分区。
// 不改 wallet-features.js 的业务逻辑，只移动已经生成的卡片，降低耦合和页面拥挤。

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
    navBtn.textContent='预存套餐';
    const before=document.querySelector('.nav-tab[data-page="customers"]');
    nav.insertBefore(navBtn,before||document.querySelector('.nav-tab[data-page="records"]')||null);
    navBtn.addEventListener('click',()=>showPage('prepaid'));
  }

  let page=document.getElementById('page-prepaid');
  if(!page){
    page=document.createElement('section');
    page.id='page-prepaid';
    page.className='page';
    page.innerHTML=`
      <div class="page-head">
        <div><small>PREPAID PACKAGES</small><h2>预存套餐</h2></div>
        <span class="head-heart">♡</span>
      </div>
      <div id="prepaidPageMount"></div>
    `;
    const before=document.getElementById('page-customers')||document.getElementById('page-records');
    app.insertBefore(page,before||null);
  }

  return true;
}

function moveWalletCard(){
  if(!ensurePrepaidPage())return false;
  const card=document.getElementById('walletPresetCard');
  const mount=document.getElementById('prepaidPageMount');
  if(!card||!mount)return false;
  if(card.parentElement!==mount)mount.appendChild(card);
  return true;
}

if(!moveWalletCard()){
  const observer=new MutationObserver(()=>{
    if(moveWalletCard())observer.disconnect();
  });
  observer.observe(document.documentElement,{childList:true,subtree:true});
  setTimeout(()=>observer.disconnect(),12000);
}
