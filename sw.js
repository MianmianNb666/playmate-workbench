const CACHE_NAME="paimini-v2";
const APP_SHELL=["./","./index.html","./styles.css","./guide.html","./manifest.webmanifest","./icon.svg"];

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
  event.respondWith(
    fetch(event.request).catch(()=>caches.match(event.request))
  );
});