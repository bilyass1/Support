// No authenticated response or customer data is cached in this starter.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
 event.waitUntil(self.registration.showNotification('Solumove Support',{
  body:'Une nouvelle activité est disponible dans votre espace.',icon:'/icon-192.png',badge:'/icon-192.png',tag:'solumove-activity',data:{url:'/'}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(windows=>{
  const current=windows.find(w=>new URL(w.url).origin===self.location.origin);return current?current.focus():self.clients.openWindow('/');
 }));
});

