import pool from './db.js';
import { sendPushToAdmins } from './pushNotify.js';

// Bir şubenin deneme süresi dolmuşsa otomatik olarak "past_due" durumuna çeker.
// Gerçek otomatik tahsilat, iyzico entegrasyonu bağlandığında bu duruma tetiklenecek
// şekilde eklenecek — şu an sadece durumu değiştirip erişimi kısıtlıyoruz.
export async function checkTrialExpiry(tenant){
  if(tenant.subscription_status === 'trial' && tenant.trial_ends_at){
    const now = new Date();
    const ends = new Date(tenant.trial_ends_at);
    if(now > ends){
      await pool.query('UPDATE tenants SET subscription_status = ? WHERE id = ?', ['past_due', tenant.id]);
      tenant.subscription_status = 'past_due';
      sendPushToAdmins({
        title: '⚠ Deneme Süresi Doldu',
        body: `${tenant.name} — deneme süresi doldu, ödeme bekleniyor.`,
        data: { tenantId: String(tenant.id) },
      }).catch(()=>{}); // bildirim başarısız olsa bile asıl işlemi bozmasın
    }
  }
  return tenant;
}
