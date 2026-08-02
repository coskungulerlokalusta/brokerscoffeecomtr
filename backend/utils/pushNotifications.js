// Tarayıcı push bildirimleri — dış hesap/onay gerektirmez, VAPID anahtarları
// kendi kendine üretilir. Anahtarlar ortam değişkeninden okunur; yoksa
// varsayılan (bu kurulum için üretilmiş) anahtarlar kullanılır.
const webpush = require('web-push');
const kv = require('./kvStore');

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || 'BFVoj8mFppAm3sVbggjHUyfZBTNX4bzGRNH5Gyk7BG7n7eaoZTC9dS_x40bF1aCXDqeq4Hf0s7GQtH565mjsjY4';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || 'ByClD-WqM_62BgdTBi45e4DdPiUmIxqu4vw-ltpQcgo';

webpush.setVapidDetails('mailto:info@brokerscoffee.com.tr', VAPID_PUBLIC, VAPID_PRIVATE);

const SUBS_KEY = 'push_subscriptions';

async function loadSubscriptions() {
  return kv.getJSON(SUBS_KEY, []);
}

async function saveSubscriptions(subs) {
  return kv.setJSON(SUBS_KEY, subs);
}

async function addSubscription(subscription, customerId) {
  const subs = await loadSubscriptions();
  const exists = subs.find((s) => s.endpoint === subscription.endpoint);
  if (exists) {
    exists.customerId = customerId || exists.customerId;
  } else {
    subs.push({ ...subscription, customerId: customerId || null, createdAt: new Date().toISOString() });
  }
  await saveSubscriptions(subs);
}

async function removeSubscription(endpoint) {
  const subs = await loadSubscriptions();
  const filtered = subs.filter((s) => s.endpoint !== endpoint);
  await saveSubscriptions(filtered);
}

// Tüm abonelere (veya sadece belirli customerId'lere) bildirim gönderir
async function sendToAll(payload, customerIds) {
  const subs = await loadSubscriptions();
  const targets = customerIds && customerIds.length
    ? subs.filter((s) => customerIds.includes(s.customerId))
    : subs;

  let sent = 0;
  const deadEndpoints = [];
  for (const sub of targets) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        JSON.stringify(payload)
      );
      sent++;
    } catch (err) {
      // 410/404: abonelik artık geçersiz (kullanıcı bildirimleri kapatmış/tarayıcı değişmiş)
      if (err.statusCode === 410 || err.statusCode === 404) {
        deadEndpoints.push(sub.endpoint);
      }
    }
  }
  for (const endpoint of deadEndpoints) {
    await removeSubscription(endpoint);
  }
  return { sent, total: targets.length, cleaned: deadEndpoints.length };
}

module.exports = { VAPID_PUBLIC, addSubscription, removeSubscription, loadSubscriptions, sendToAll };
