// Zamanlanmış/yayılmış mesaj gönderimi — "şu kadar süre içinde gönder" kurgusu için.
// Örn. 50 kişiye 2 saatlik pencerede eşit aralıklarla gönderim yapar (toplu/aniden
// gönderim yerine daha doğal bir yayılma sağlar).
const crypto = require('crypto');
const kv = require('./kvStore');
const whatsapp = require('./whatsapp');
const netgsm = require('./netgsm');

const KEY = 'message_queue';

async function loadQueue() {
  return kv.getJSON(KEY, []);
}

async function saveQueue(queue) {
  return kv.setJSON(KEY, queue);
}

// recipients: [{ id, name, phone }], windowMinutes: 0 = hemen gönder, >0 = o süreye yay
async function enqueueBatch({ recipients, message, channel, windowMinutes }) {
  const queue = await loadQueue();
  const now = Date.now();
  const count = recipients.length;
  const intervalMs = windowMinutes > 0 && count > 1 ? (windowMinutes * 60 * 1000) / count : 0;

  const items = recipients.map((r, i) => ({
    id: crypto.randomUUID(),
    recipientId: r.id,
    recipientName: r.name,
    phone: r.phone,
    message,
    channel,
    sendAt: now + Math.round(i * intervalMs),
    status: 'bekliyor', // bekliyor | gonderildi | hata
    error: null,
    createdAt: new Date().toISOString(),
  }));

  queue.push(...items);
  await saveQueue(queue);
  return items;
}

// Zamanı gelmiş mesajları gönderir — server.js'ten periyodik çağrılır
async function processDue() {
  const queue = await loadQueue();
  const now = Date.now();
  const due = queue.filter((m) => m.status === 'bekliyor' && m.sendAt <= now);
  if (!due.length) return { sent: 0 };

  let sentCount = 0;
  for (const item of due) {
    try {
      if (item.channel === 'sms') {
        await netgsm.sendSms(item.phone, item.message);
      } else {
        await whatsapp.sendTextMessage(item.phone, item.message);
      }
      item.status = 'gonderildi';
      sentCount++;
    } catch (err) {
      item.status = 'hata';
      item.error = err.message;
    }
  }
  await saveQueue(queue);
  return { sent: sentCount };
}

async function loadRecent(limit = 50) {
  const queue = await loadQueue();
  return queue.slice(-limit).reverse();
}

module.exports = { enqueueBatch, processDue, loadRecent, loadQueue };
