// Push bildirim aboneliği — sitenin her sayfasında kullanılabilir

// Service worker'ı her sayfada kaydet — site "Ana Ekrana Ekle" ile gerçek
// bir uygulama gibi (tarayıcı çubuğu olmadan) açılabilsin diye gerekli
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, error: 'Tarayıcın push bildirimi desteklemiyor.' };
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return { ok: false, error: 'Bildirim izni verilmedi.' };
    }
    const reg = await navigator.serviceWorker.register('/sw.js');
    const keyRes = await fetch('/api/push/vapid-public-key');
    const { publicKey } = await keyRes.json();

    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription }),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function getPushSubscriptionStatus() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    if (!reg) return 'not-subscribed';
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'subscribed' : 'not-subscribed';
  } catch (e) {
    return 'not-subscribed';
  }
}
