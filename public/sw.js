// No authenticated response or customer data is cached in this starter.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
 let body='Une nouvelle activité est disponible dans votre espace.';
 try{const data=event.data?event.data.json():null;if(data&&typeof data.body==='string'&&data.body)body=data.body.slice(0,200);}catch{}
 event.waitUntil(self.registration.showNotification('Solumove Support',{
  body,requireInteraction:true,icon:'/icon-192.png',badge:'/icon-192.png',tag:'solumove-activity',renotify:true,data:{url:'/'}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(windows=>{
  const current=windows.find(w=>new URL(w.url).origin===self.location.origin);return current?current.focus():self.clients.openWindow('/');
 }));
});

