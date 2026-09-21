const CACHE_NAME="paimini-v3";
const APP_SHELL=["./guide.html","./manifest.webmanifest","./icon.svg"];

self.addEventListener("install",event=>{
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL)).catch(()=>{})
  );
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys().then(keys=>Promise.all(
      keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET") return;
  const url=new URL(event.request.url);

  // 主页面和代码文件始终优先走网络，避免旧版本 JS/CSS 卡在手机缓存里。
  if(url.origin===location.origin && (
    url.pathname.endsWith("/") ||
    url.pathname.endsWith("/index.html") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css")
  )){
    event.respondWith(fetch(event.request,{cache:"no-store"}));
    return;
  }

  event.respondWith(
    fetch(event.request).catch(()=>caches.match(event.request))
  );
});
