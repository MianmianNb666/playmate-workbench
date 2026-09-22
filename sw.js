// PaiMini emergency inert Service Worker.
// Do not intercept requests, do not navigate clients, and do not unregister here.
// Keeping this worker inert prevents the previous self-unregister + client.navigate
// cycle from reloading the page repeatedly.

self.addEventListener("install",()=>{
  self.skipWaiting();
});

self.addEventListener("activate",event=>{
  event.waitUntil(self.clients.claim());
});

// Intentionally no fetch handler.
