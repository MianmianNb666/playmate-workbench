// PaiMini 顾客档案按钮文案收口：将“去派单”统一改为“去结账”。
// 只改按钮显示文案，不改原有点击逻辑。

let started=false;
let observer=null;

function applyLabels(){
  const list=document.getElementById('customerProfileList');
  if(!list)return;
  list.querySelectorAll('[data-use-customer]').forEach(btn=>{
    if(btn.textContent.trim()!=='去结账')btn.textContent='去结账';
  });
}

export function initCustomerCheckoutLabelSafe(){
  if(started)return;
  started=true;
  const list=document.getElementById('customerProfileList');
  if(!list){started=false;throw new Error('customer profile list not ready')}
  applyLabels();
  observer=new MutationObserver(()=>queueMicrotask(applyLabels));
  observer.observe(list,{childList:true,subtree:true});
}
