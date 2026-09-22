// PaiMini resilient bootstrap.
// Keeps the main UI local and only reaches external CDNs for the Supabase SDK.

const bootStarted=Date.now();
let coreStarted=false;

function unlockBoot(message){
  document.body?.classList.remove('booting');
  const auth=document.getElementById('authGate');
  const app=document.getElementById('appRoot');
  const access=document.getElementById('accessGate');
  auth?.classList.remove('hidden');
  app?.classList.add('hidden');
  access?.classList.add('hidden');
  const box=document.getElementById('connectionStatus');
  const label=document.getElementById('connectionText');
  if(box) box.className='connection-pill bad';
  if(label) label.textContent=message||'启动组件加载失败';
}

const watchdog=setTimeout(()=>{
  if(!coreStarted) unlockBoot('启动超时，请刷新后重试');
},9000);

async function importWithTimeout(url,ms){
  let timer;
  try{
    return await Promise.race([
      import(url),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('timeout:'+url)),ms);})
    ]);
  }finally{
    clearTimeout(timer);
  }
}

async function loadSupabaseSdk(){
  const sources=[
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm',
    'https://esm.sh/@supabase/supabase-js@2?bundle'
  ];
  let lastError=null;
  for(const url of sources){
    try{
      const mod=await importWithTimeout(url,4500);
      if(mod?.createClient) return mod;
    }catch(error){
      lastError=error;
      console.warn('Supabase SDK source failed',url,error);
    }
  }
  throw lastError||new Error('Supabase SDK unavailable');
}

async function start(){
  try{
    const [sdk,config,coreResponse]=await Promise.all([
      loadSupabaseSdk(),
      import('./supabase-config.js?v=20260923-stable'),
      fetch('./app-core-v20260922.js?v=20260923-stable',{cache:'no-store'})
    ]);

    if(!coreResponse.ok) throw new Error('主程序文件 HTTP '+coreResponse.status);
    let source=await coreResponse.text();

    source=source.replace(
      /import\s*\{\s*createClient\s*\}\s*from\s*["']https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\/\+esm["'];?\s*/,
      'const createClient=globalThis.__paiMiniCreateClient;\n'
    );
    source=source.replace(
      /import\s*\{\s*SUPABASE_URL\s*,\s*SUPABASE_PUBLISHABLE_KEY\s*\}\s*from\s*["']\.\/supabase-config\.js["'];?\s*/,
      'const {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY}=globalThis.__paiMiniSupabaseConfig;\n'
    );

    globalThis.__paiMiniCreateClient=sdk.createClient;
    globalThis.__paiMiniSupabaseConfig=config;

    const blob=new Blob([source],{type:'text/javascript'});
    const blobUrl=URL.createObjectURL(blob);
    try{
      await import(blobUrl);
      coreStarted=true;
      clearTimeout(watchdog);
    }finally{
      setTimeout(()=>URL.revokeObjectURL(blobUrl),30000);
    }
  }catch(error){
    console.error('PaiMini bootstrap failed',error);
    clearTimeout(watchdog);
    unlockBoot('启动失败：'+String(error?.message||error||'未知错误'));
    const hint=document.getElementById('authHint');
    if(hint) hint.textContent='网页文件已加载，但外部组件暂时不可用。可以稍后刷新重试。';
  }
}

start();
