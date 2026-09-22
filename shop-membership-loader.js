// PaiMini isolated shop membership loader.
// Core app must be visible first. This loader never blocks auth/bootstrap.

const LOAD_DELAY_MS=900;
const INIT_TIMEOUT_MS=6000;
const FAILURE_KEY='paimini-membership-failed-phase4';
let started=false;
let finished=false;

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
  window.__paiMiniMembershipStatus='disabled';
  console.warn('shop membership isolated module disabled for this session',error);
}

async function start(){
  if(started || finished) return;
  if(!coreReady()) return;
  try{
    if(sessionStorage.getItem(FAILURE_KEY)==='1'){
      window.__paiMiniMembershipStatus='disabled-session';
      return;
    }
  }catch{}

  started=true;
  await new Promise(resolve=>setTimeout(resolve,LOAD_DELAY_MS));

  if(!coreReady()){
    started=false;
    return;
  }

  try{
    const mod=await Promise.race([
      import('./shop-membership-shell.js?v=20260923-phase4'),
      timeoutPromise(INIT_TIMEOUT_MS,'membership import timeout')
    ]);
    await Promise.race([
      mod.initShopMembershipShell(),
      timeoutPromise(INIT_TIMEOUT_MS,'membership init timeout')
    ]);
    window.__paiMiniMembershipStatus='ready-phase4';
    finished=true;
    try{sessionStorage.removeItem(FAILURE_KEY)}catch{}
  }catch(error){
    markFailure(error);
    finished=true;
  }
}

export function scheduleShopMembershipShell(){
  const startedAt=Date.now();
  const timer=setInterval(()=>{
    if(finished){clearInterval(timer);return;}
    if(coreReady()) start();
    if(Date.now()-startedAt>30000) clearInterval(timer);
  },300);
}

if(typeof window!=="undefined" && !window.__paiMiniMembershipPhase4LoaderScheduled){
  window.__paiMiniMembershipPhase4LoaderScheduled=true;
  scheduleShopMembershipShell();
}
