// No authenticated response or customer data is cached: the worker only delivers push notifications.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
  let data={};
  try{data=event.data?event.data.json():{};}catch{data={body:event.data?event.data.text():''};}
  event.waitUntil(self.registration.showNotification(data.title||'SupportFlow',{
    body:data.body||'',icon:'/icon-192.png',badge:'/icon-192.png',tag:data.tag||undefined,renotify:Boolean(data.tag),
    requireInteraction:true,data:{url:data.url||'/'}
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const url=new URL((event.notification.data&&event.notification.data.url)||'/',self.location.origin);
  if(url.origin!==self.location.origin)return;
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    const open=list.find(client=>new URL(client.url).origin===url.origin);
    return open?open.navigate(url.href).then(client=>(client||open).focus()):self.clients.openWindow(url.href);
  }));
});
