// 旧アドレスの古いオフライン用キャッシュを消して、移転先へ案内する
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) await caches.delete(k);
  await self.registration.unregister();
  for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate('https://yusaka-debug.github.io/vehicle-cost/');
})()));
