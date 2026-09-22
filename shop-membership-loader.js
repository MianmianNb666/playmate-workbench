// PaiMini isolated shop membership loader.
// Core app must be visible first. This loader never blocks auth/bootstrap.

const LOAD_DELAY_MS=900;
const INIT_TIMEOUT_MS=6000;
const FAILURE_KEY='paimini-membership-failed-this-session';
let started=false;

function timeoutPromise(ms,label){
  return new Promise((_,reject)=>setTimeout(()=>reject(new Error(label||'membership timeout')),ms));
}

function coreReady(){
  const body=document.body;
  const app=document.getElementById('appRoot');
  return !!body && !body.classList.contains('booting') && !!app && !app.classList.contains('hidden');
}

function removeMembershipUi(){
  document.getElementById('shopMembershipShellCard')?.remove();
  document.getElementById('shopMembershipCard')?.remove();
}

function markFailure(error){
  try{sessionStorage.setItem(FAILURE_KEY,'1')}catch{}
  removeMembershipUi();
  console.warn('shop membership isolated module disabled for this session',error);
}

async function start(){
  if(started) return;
  if(!coreReady()) return;
  if(sessionStorage.getItem(FAILURE_KEY)==='1') return;
  started=true;

  await new Promise(resolve=>setTimeout(resolve,LOAD_DELAY_MS));

  try{
    const mod=await Promise.race([
      import('./shop-membership-shell.js?v=20260923-shell1'),
      timeoutPromise(INIT_TIMEOUT_MS,'membership import timeout')
    ]);
    await Promise.race([
      mod.initShopMembershipShell(),
      timeoutPromise(INIT_TIMEOUT_MS,'membership init timeout')
    ]);
    window.__paiMiniMembershipStatus='ready-shell';
  }catch(error){
    window.__paiMiniMembershipStatus='disabled';
    markFailure(error);
  }
}

export function scheduleShopMembershipShell(){
  const timer=setInterval(()=>{
    if(started){clearInterval(timer);return;}
    if(coreReady()){
      clearInterval(timer);
      start();
    }
  },300);
  setTimeout(()=>clearInterval(timer),30000);
}

scheduleShopMembershipShell();
