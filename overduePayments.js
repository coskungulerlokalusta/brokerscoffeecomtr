import pool from './db.js';
import { sendPushToTenant } from './pushNotify.js';
import { sendSms } from './netgsmSms.js';

const GRACE_PERIOD_MS = 3 * 24 * 60 * 60 * 1000; // ödeme günü geçtikten sonra 3 gün süre

// İşletme sahibinin telefon numarası varsa SMS de gönderiyoruz — push
// bildirim (uygulama açık değilse kaçırılabilir) ile SMS'i (herkeste her
// zaman ulaşır) birlikte kullanmak, ödeme hatırlatmasının gerçekten
// görülmesini garantiliyor.
async function notifyTenant(tenantId, { title, pushBody, smsBody }) {
  await sendPushToTenant(tenantId, { app: 'patron', title, body: pushBody }).catch(() => {});
  const [[t]] = await pool.query('SELECT billing_phone FROM tenants WHERE id = ?', [tenantId]);
  if (t?.billing_phone) {
    await sendSms(t.billing_phone, smsBody).catch(() => {});
  }
}

// Her gün çalışır: ödeme günü geçmiş ama henüz süresi (3 gün) dolmamış
// faturalar için bir kere uyarı bildirimi gönderir; süresi dolmuş ve hâlâ
// ödenmemiş faturalar için işletmenin hesabını otomatik askıya alır.
// Ödeme yapıldığında (iyzicoPayment.js → verifyAndCompletePayment) hesap
// zaten otomatik olarak "active" durumuna dönüyor — yani "ödenince otomatik
// açılma" tarafı bu dosyanın DIŞINDA, ödeme onaylandığı anda gerçekleşiyor.
export async function checkOverduePayments() {
  const now = new Date();

  // 1) Ödeme günü yeni geçmiş, henüz uyarı gönderilmemiş faturalar
  const [freshlyOverdue] = await pool.query(
    `SELECT si.*, t.name as tenant_name FROM subscription_invoices si
     JOIN tenants t ON t.id = si.tenant_id
     WHERE si.paid = 0 AND si.overdue_reminder_sent = 0 AND si.due_date < ?`,
    [now]
  );
  let remindersSent = 0;
  for (const inv of freshlyOverdue) {
    await notifyTenant(inv.tenant_id, {
      title: '⚠ Ödeme Süreniz Doldu',
      pushBody: `${inv.invoice_number} numaralı faturanız (${Number(inv.amount).toFixed(2)}₺) ödenmedi. 3 gün içinde ödeme yapılmazsa hesabınız otomatik olarak askıya alınacaktır.`,
      smsBody: `DurakPOS: ${inv.invoice_number} numarali faturaniz (${Number(inv.amount).toFixed(2)}TL) odenmedi. 3 gun icinde odeme yapilmazsa hesabiniz askiya alinacaktir.`,
    });
    await pool.query('UPDATE subscription_invoices SET overdue_reminder_sent = 1 WHERE id = ?', [inv.id]);
    remindersSent++;
  }

  // 2) Ödeme günü üzerinden 3 gün geçmiş, hâlâ ödenmemiş faturalar — hesap askıya alınır
  const graceExpiredBefore = new Date(now.getTime() - GRACE_PERIOD_MS);
  const [expiredGrace] = await pool.query(
    `SELECT DISTINCT si.tenant_id, t.name as tenant_name, t.subscription_status FROM subscription_invoices si
     JOIN tenants t ON t.id = si.tenant_id
     WHERE si.paid = 0 AND si.due_date < ? AND t.subscription_status = 'active'`,
    [graceExpiredBefore]
  );
  let suspended = 0;
  for (const t of expiredGrace) {
    await pool.query('UPDATE tenants SET subscription_status = ? WHERE id = ?', ['past_due', t.tenant_id]);
    await notifyTenant(t.tenant_id, {
      title: '🔒 Hesabınız Askıya Alındı',
      pushBody: `Ödemeniz 3 gündür bekliyor — hesabınız askıya alındı. Kasa ve panel erişiminizi geri açmak için ödeme yapmanız yeterli, ödeme onaylanır onaylanmaz otomatik olarak yeniden açılacaktır.`,
      smsBody: `DurakPOS: Odemeniz 3 gundur bekliyor, hesabiniz askiya alindi. Odeme yapinca hesabiniz otomatik olarak yeniden acilacaktir.`,
    });
    suspended++;
  }

  return { remindersSent, suspended };
}
