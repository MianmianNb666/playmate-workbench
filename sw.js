// PaiMini safe Service Worker cleanup.
// Removes old caches and unregisters itself without navigating/reloading clients.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    try{
      const keys=await caches.keys();
      await Promise.all(keys.filter(k=>k.startsWith('paimini-')).map(k=>caches.delete(k)));
    }catch(_){}
    try{await self.registration.unregister();}catch(_){}
  })());
});
// No fetch handler on purpose.
