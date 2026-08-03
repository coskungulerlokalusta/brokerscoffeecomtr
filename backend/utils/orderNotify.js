// Yeni sipariş geldiğinde admin'in belirlediği 2 numaraya WhatsApp bildirimi gönderir.
const settings = require('./settings');
const whatsapp = require('./whatsapp');

async function notifyNewOrder(order) {
  try {
    const s = await settings.loadSettings();
    const numbers = [s.orderNotifyPhone1, s.orderNotifyPhone2].filter(Boolean);
    if (!numbers.length) return;

    const itemsText = order.items.map((i) => `${i.qty}x ${i.name}${i.size ? ' (' + i.size + ')' : ''}`).join(', ');
    const methodText = order.paymentMethod === 'store' ? 'Mağazada Ödeme' : 'Kredi Kartı (Ödendi)';
    const prefsParts = [];
    if (order.orderIntensity === 'yumusak') prefsParts.push('Yumuşak İçim');
    if (order.orderExtraShot) prefsParts.push('Ekstra Shot');
    const prefsText = prefsParts.length ? `\n☕ ${prefsParts.join(', ')}` : '';
    const noteText = order.orderNote ? `\n📝 Not: ${order.orderNote}` : '';
    const message = `🔔 Yeni Sipariş!\n\n👤 ${order.customerName} — ${order.phone}\n📦 ${itemsText}${prefsText}${noteText}\n💰 ₺${order.total}\n💳 ${methodText}\n🚚 ${order.deliveryType === 'kurye' ? 'Kurye' : 'Gel Al'}${order.address ? '\n📍 ' + order.address : ''}`;

    for (const phone of numbers) {
      try {
        await whatsapp.sendTextMessage(phone, message);
      } catch (err) {
        console.error('Sipariş bildirimi gönderilemedi (' + phone + '):', err.message);
      }
    }
  } catch (err) {
    console.error('Sipariş bildirimi hatası:', err.message);
  }
}

module.exports = { notifyNewOrder };
