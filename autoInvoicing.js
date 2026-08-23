import pool from './db.js';
import { chargeStoredCard } from './iyzicoPayment.js';

const TR_OFFSET_MS = 3 * 3600 * 1000;
function trFrame(realDate) { return new Date(realDate.getTime() + TR_OFFSET_MS); }

// Her işletme için: aylık ücreti tanımlıysa VE bugün onun fatura kesim
// gününe ulaşıldıysa VE bu ay (dönem) için henüz fatura kesilmediyse,
// otomatik bir fatura oluşturur. "Dönem" (period) YYYY-MM formatında —
// aynı ay içinde ikinci kez fatura kesilmesini engelliyor.
export async function runAutoInvoicing() {
  const now = trFrame(new Date());
  const todayDay = now.getUTCDate();
  const currentPeriod = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

  const [tenants] = await pool.query(
    `SELECT id, name, monthly_price, billing_day, last_invoiced_period, iyzico_card_user_key, iyzico_card_token FROM tenants
     WHERE monthly_price IS NOT NULL AND monthly_price > 0`
  );
  let created = 0, autoCharged = 0;
  for (const t of tenants) {
    const billingDay = t.billing_day || 1;
    if (todayDay < billingDay) continue; // bu ayki kesim günü henüz gelmedi
    if (t.last_invoiced_period === currentPeriod) continue; // bu dönem için zaten kesilmiş

    // Fatura numarası: DP-YYYYMM-<tenantId> — hem okunaklı hem benzersiz,
    // hangi işletmenin hangi ayına ait olduğu numaradan bile anlaşılıyor
    const invoiceNumber = `DP-${currentPeriod.replace('-', '')}-${t.id}`;
    // Son ödeme tarihi: kesim gününden 7 gün sonrası
    const dueDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), billingDay + 7));

    try {
      const [result] = await pool.query(
        'INSERT INTO subscription_invoices (tenant_id, invoice_number, amount, due_date) VALUES (?, ?, ?, ?)',
        [t.id, invoiceNumber, t.monthly_price, dueDate]
      );
      await pool.query('UPDATE tenants SET last_invoiced_period = ? WHERE id = ?', [currentPeriod, t.id]);
      created++;

      // İşletmenin kayıtlı bir kartı varsa, fatura oluşturulur oluşturulmaz
      // otomatik çekmeyi deniyoruz — işletme sahibinin hiçbir şey yapmasına
      // gerek kalmadan tahsilat tamamlanmış oluyor.
      if (t.iyzico_card_user_key && t.iyzico_card_token) {
        const chargeResult = await chargeStoredCard({ invoiceId: result.insertId, tenantId: t.id, amount: t.monthly_price });
        if (chargeResult.ok) autoCharged++;
        else console.error(`Otomatik çekim başarısız (tenant ${t.id}):`, chargeResult.error);
      }
    } catch (e) {
      console.error(`Otomatik fatura oluşturulamadı (tenant ${t.id}):`, e.message);
    }
  }
  return { created, autoCharged };
}
