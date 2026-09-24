// PaiMini 独立「预存」分区。
// 只创建一级导航和空白承载页，不搬 DOM、不轮询、不监听全页面。

function showPage(name){
  document.querySelectorAll('.page').forEach(el=>{
    el.classList.toggle('active',el.id===`page-${name}`);
  });
  document.querySelectorAll('.nav-tab').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.page===name);
  });
  document.body.classList.remove('mobile-drawer-open');
}

export function ensurePrepaidPage(){
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
    const before=document.querySelector('.nav-tab[data-page="customers"]') || document.querySelector('.nav-tab[data-page="records"]');
    nav.insertBefore(navBtn,before||null);
    navBtn.addEventListener('click',()=>showPage('prepaid'));
  }

  let page=document.getElementById('page-prepaid');
  if(!page){
    page=document.createElement('section');
    page.id='page-prepaid';
    page.className='page';
    page.innerHTML=`
      <div class="page-head">
        <div><small>PREPAID</small><h2>预存</h2><div class="active-shop-chip">当前店铺：<b data-active-shop-name>未选择店铺</b></div></div>
        <span class="head-heart">♡</span>
      </div>
      <div class="card" style="margin-bottom:14px">
        <div class="card-title"><div><b>老板预存管理</b><small>预存套餐、附赠权益与余额明细</small></div></div>
        <p class="muted" style="margin:0">选择老板后可发放预存套餐；主页面统一显示总余额，详细来源在流水中查看。</p>
      </div>
      <div id="prepaidPageMount"></div>
    `;
    const before=document.getElementById('page-customers') || document.getElementById('page-records');
    app.insertBefore(page,before||null);
  }

  return true;
}

ensurePrepaidPage();
