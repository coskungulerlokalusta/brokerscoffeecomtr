// Brokers Coffee - Push bildirim service worker'ı
self.addEventListener('push', (event) => {
  let data = { title: 'Brokers Coffee', body: 'Yeni bir bildirim var.' };
  try {
    data = event.data.json();
  } catch (e) {}

  event.waitUntil(
    self.registration.showNotification(data.title || 'Brokers Coffee', {
      body: data.body || '',
      icon: '/uploads/site/icon.png',
      badge: '/uploads/site/icon.png',
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(clients.openWindow(url));
});
