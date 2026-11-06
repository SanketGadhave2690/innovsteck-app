/* Innovsteck service worker - offline support. Change VERSION when you update the app. */
var VERSION='innovsteck-v8';
var FILES=['./','./index.html','./manifest.json','./privacy.html','./icon-192.png','./icon-512.png','./icon-maskable-512.png'];
self.addEventListener('install',function(e){
  e.waitUntil(caches.open(VERSION).then(function(c){
    return Promise.all(FILES.map(function(f){return c.add(f).catch(function(){})}));
  }));
  self.skipWaiting();
});
self.addEventListener('activate',function(e){
  e.waitUntil(caches.keys().then(function(k){
    return Promise.all(k.filter(function(x){return x!==VERSION}).map(function(x){return caches.delete(x)}));
  }));
  self.clients.claim();
});
self.addEventListener('fetch',function(e){
  var r=e.request;
  if(r.method!=='GET'||r.headers.has('range')||new URL(r.url).origin!==location.origin)return;
  e.respondWith(
    fetch(r).then(function(res){
      if(res&&res.status===200){var c=res.clone();caches.open(VERSION).then(function(x){x.put(r,c)})}
      return res;
    }).catch(function(){
      return caches.match(r).then(function(m){return m||(r.mode==='navigate'?caches.match('./index.html'):undefined)});
    })
  );
});
