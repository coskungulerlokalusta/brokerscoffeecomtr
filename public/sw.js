// Brokers Coffee - Service Worker (push bildirimleri + "Ana Ekrana Ekle" desteği)
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Uygulamanın kurulabilir (installable) sayılması için bir fetch dinleyicisi
// gerekiyor — normal ağ isteğini geçiriyor, önbellekleme yok. İnternet yokken
// sayfa açılışlarında tarayıcı hata ekranı yerine basit bir uyarı sayfası gösterilir
// (Android uygulaması için Play Store bunu bekliyor).
const OFFLINE_HTML = '<!doctype html><html lang="tr"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1"><title>Brokers Coffee</title></head>' +
  '<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
  'background:#faf9f6;color:#0d1b3d;font-family:system-ui,sans-serif;text-align:center;padding:24px">' +
  '<div><h1 style="font-size:22px">İnternet bağlantısı yok</h1>' +
  '<p>Bağlantınızı kontrol edip tekrar deneyin.</p>' +
  '<button onclick="location.reload()" style="margin-top:12px;padding:12px 24px;border:0;border-radius:999px;' +
  'background:#0d1b3d;color:#fff;font-size:16px">Tekrar dene</button></div></body></html>';

self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      )
    );
    return;
  }
  event.respondWith(fetch(event.request));
});

self.addEventListener('push', (event) => {
  let data = { title: 'Brokers Coffee', body: 'Yeni bir bildirim var.' };
  try {
    data = event.data.json();
  } catch (e) {}

  event.waitUntil(
    self.registration.showNotification(data.title || 'Brokers Coffee', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(clients.openWindow(url));
});
