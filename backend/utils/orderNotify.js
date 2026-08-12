// Yeni sipariş geldiğinde admin'in belirlediği numaralara WhatsApp + SMS (NetGSM) bildirimi gönderir,
// ve siparişi DurakPOS'a iletir (menü/sipariş sistemi artık orada).
const settings = require('./settings');
const whatsapp = require('./whatsapp');
const netgsm = require('./netgsm');
const durakpos = require('./durakpos');

async function notifyNewOrder(order) {
  try {
    durakpos.submitOrder({
      items: order.items,
      customerName: order.customerName,
      customerPhone: order.phone,
      note: order.orderNote || '',
    }).catch((err) => console.error('DurakPOS sipariş gönderimi başarısız:', err.message));
  } catch (err) {
    console.error('DurakPOS sipariş gönderim hatası:', err.message);
  }

  try {
    const s = await settings.loadSettings();
    const waNumbers = [s.orderNotifyPhone1, s.orderNotifyPhone2].filter(Boolean);
    const smsNumbers = (s.orderNotifySmsPhones || []).filter(Boolean);
    if (!waNumbers.length && !smsNumbers.length) return;

    const itemsText = order.items.map((i) => `${i.qty}x ${i.name}${i.size ? ' (' + i.size + ')' : ''}`).join(', ');
    const methodText = order.paymentMethod === 'store' ? 'Mağazada Ödeme' : 'Kredi Kartı (Ödendi)';
    const prefsParts = [];
    if (order.orderIntensity === 'yumusak') prefsParts.push('Yumuşak İçim');
    if (order.orderExtraShot) prefsParts.push('Ekstra Shot');
    const prefsText = prefsParts.length ? `\n☕ ${prefsParts.join(', ')}` : '';
    const noteText = order.orderNote ? `\n📝 Not: ${order.orderNote}` : '';
    const message = `🔔 Yeni Sipariş!\n\n👤 ${order.customerName} — ${order.phone}\n📦 ${itemsText}${prefsText}${noteText}\n💰 ₺${order.total}\n💳 ${methodText}\n🚚 ${order.deliveryType === 'kurye' ? 'Kurye' : 'Gel Al'}${order.address ? '\n📍 ' + order.address : ''}`;

    for (const phone of waNumbers) {
      try {
        await whatsapp.sendTextMessage(phone, message);
      } catch (err) {
        console.error('Sipariş WhatsApp bildirimi gönderilemedi (' + phone + '):', err.message);
      }
    }

    if (smsNumbers.length) {
      // SMS karakter sınırlı olduğu için daha kısa bir metin kullanılıyor
      const smsMessage = `Yeni Siparis! ${order.customerName} - ${itemsText} - Toplam: ${order.total} TL (${methodText})`;
      for (const phone of smsNumbers) {
        try {
          await netgsm.sendSms(phone, smsMessage);
        } catch (err) {
          console.error('Sipariş SMS bildirimi gönderilemedi (' + phone + '):', err.message);
        }
      }
    }
  } catch (err) {
    console.error('Sipariş bildirimi hatası:', err.message);
  }
}

module.exports = { notifyNewOrder };
