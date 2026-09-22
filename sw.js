// PaiMini safe no-op Service Worker cleanup.
self.addEventListener('install',event=>{self.skipWaiting();});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    try{
      const keys=await caches.keys();
      await Promise.all(keys.filter(k=>k.startsWith('paimini-')).map(k=>caches.delete(k)));
    }catch(_){ }
    try{await self.registration.unregister();}catch(_){ }
  })());
});
