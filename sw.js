const CACHE_NAME="paimini-v4";
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
    )).then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET") return;

  const url=new URL(event.request.url);

  // 不接管 Supabase、CDN 等跨域请求。
  // 这些请求直接交给浏览器网络层，避免网络失败时 Service Worker
  // 用空缓存结果响应，触发 Safari 的 FetchEvent.respondWith null 错误。
  if(url.origin!==self.location.origin) return;

  // 主页面和代码文件始终优先走网络，避免旧版 JS/CSS 被缓存。
  if(
    url.pathname.endsWith("/") ||
    url.pathname.endsWith("/index.html") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css")
  ){
    event.respondWith(
      fetch(event.request,{cache:"no-store"}).catch(async()=>{
        const cached=await caches.match(event.request);
        return cached || new Response("Network unavailable",{
          status:503,
          statusText:"Service Unavailable",
          headers:{"Content-Type":"text/plain; charset=utf-8"}
        });
      })
    );
    return;
  }

  event.respondWith(
    fetch(event.request).catch(async()=>{
      const cached=await caches.match(event.request);
      return cached || new Response("Network unavailable",{
        status:503,
        statusText:"Service Unavailable",
        headers:{"Content-Type":"text/plain; charset=utf-8"}
      });
    })
  );
});
