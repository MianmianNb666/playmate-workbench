// Temporary self-unregistering Service Worker for PaiMini.
// Purpose: remove stale Safari/iOS workers that were intercepting Auth requests.

self.addEventListener("install",event=>{
  self.skipWaiting();
});

self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    try{
      const keys=await caches.keys();
      await Promise.all(
        keys
          .filter(key=>key.startsWith("paimini-"))
          .map(key=>caches.delete(key))
      );
    }catch(_){}

    try{
      await self.registration.unregister();
    }catch(_){}

    try{
      const clients=await self.clients.matchAll({type:"window",includeUncontrolled:true});
      clients.forEach(client=>client.navigate(client.url));
    }catch(_){}
  })());
});

// Intentionally no fetch handler.
// After activation this worker unregisters itself, so all requests go directly
// through the browser network layer instead of Service Worker interception.
