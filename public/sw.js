// Brokers Coffee - Service Worker (push bildirimleri + "Ana Ekrana Ekle" desteği)
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Uygulamanın kurulabilir (installable) sayılması için bir fetch dinleyicisi
// gerekiyor — şimdilik sadece normal ağ isteğini geçiriyor, önbellekleme yok.
self.addEventListener('fetch', (event) => {
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
