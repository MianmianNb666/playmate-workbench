// Safe loader for shop membership.
// The membership module creates its own Supabase auth client and performs
// session/RPC work at module startup. Loading it while the core app is still
// booting can contend with the core auth/bootstrap path, so defer it until
// the core splash has been released.
(function(){
  let started=false;
  let observer=null;

  function coreReady(){
    return document.body && !document.body.classList.contains("booting");
  }

  function start(){
    if(started || !coreReady()) return;
    started=true;
    if(observer) observer.disconnect();
    import("./shop-membership.js?v=20260923-2")
      .catch(error=>console.warn("shop membership deferred load failed",error));
  }

  if(coreReady()){
    setTimeout(start,0);
    return;
  }

  observer=new MutationObserver(start);
  observer.observe(document.documentElement,{attributes:true,subtree:true,attributeFilter:["class"]});

  // Fallback polling for browsers that do not surface the body class change
  // through the observer as expected. This never forces the core app open.
  const timer=setInterval(()=>{
    if(started){clearInterval(timer);return;}
    if(coreReady()){
      clearInterval(timer);
      start();
    }
  },250);

  setTimeout(()=>{
    if(started) return;
    clearInterval(timer);
    observer?.disconnect();
    console.warn("shop membership skipped because core app did not finish booting");
  },15000);
})();
