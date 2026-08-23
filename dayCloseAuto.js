import pool from './db.js';

const TR_OFFSET_MS = 3 * 3600 * 1000;
function trFrame(realDate) { return new Date(realDate.getTime() + TR_OFFSET_MS); }
function trToReal(trFrameDate) { return new Date(trFrameDate.getTime() - TR_OFFSET_MS); }

// Bir tenant'ın açılış saatine göre, ŞU AN hangi iş gününün içinde olduğumuzu
// hesaplar (opening_time'dan önceki saatlerde hâlâ ÖNCEKİ gün sayılır).
export function businessDayStartUtc(now, openingTime) {
  const [oh, om] = (openingTime || '00:00:00').split(':').map(Number);
  const tf = trFrame(now);
  let start = new Date(Date.UTC(tf.getUTCFullYear(), tf.getUTCMonth(), tf.getUTCDate(), oh, om, 0));
  if (tf < start) start.setUTCDate(start.getUTCDate() - 1);
  return trToReal(start);
}

// Bir işletme için, süresi dolmuş (henüz kapatılmamış) iş günü varsa otomatik
// kapatır: o günün kasa özetini kaydeder, hâlâ açık kalan siparişleri
// "ödenmeden otomatik kapatıldı" olarak işaretler — böylece açık tutar bir
// sonraki güne hiç sarkmaz. Kasadaki manuel "Kasa Kapanışı" ile aynı hesabı
// kullanır, sadece kendiliğinden, personel tıklamadan tetiklenir.
// Gerçekten kapanış GEREKİYORSA true, zaten güncelse false döner — çağıran
// taraf (runAutoDayCloseForAllTenants) bunu sayaç için kullanıyor, ekstra
// sorgu atmasına gerek kalmıyor.
export async function runAutoDayCloseIfNeeded(tenantId, openingTimeHint) {
  let openingTime = openingTimeHint;
  if (openingTime === undefined) {
    const [[tenant]] = await pool.query('SELECT opening_time FROM tenants WHERE id = ?', [tenantId]);
    if (!tenant) return false;
    openingTime = tenant.opening_time;
  }
  const now = new Date();
  const currentDayStart = businessDayStartUtc(now, openingTime);
  // Kapatılması gereken önceki iş günü, şu anki iş gününden hemen önceki 24 saatlik dilim
  const prevDayStart = new Date(currentDayStart.getTime() - 24 * 3600 * 1000);
  const prevDayEnd = currentDayStart; // önceki gün, şu anki günün başladığı anda bitiyor
  const closureDateLabel = trFrame(prevDayStart).toISOString().slice(0, 10);

  const [[existing]] = await pool.query(
    'SELECT id FROM day_closures WHERE tenant_id = ? AND closure_date = ?',
    [tenantId, closureDateLabel]
  );
  if (existing) return false; // bu iş günü zaten kapatılmış, tekrar işlem yapma

  // Önceki iş gününe ait, henüz ödenmemiş her siparişi zorla kapatıyoruz —
  // gerçek satış geliri olarak SAYILMIYOR, sadece "açık" durumundan çıkıyor.
  const [staleOpenOrders] = await pool.query(
    `SELECT id FROM orders WHERE tenant_id = ? AND status = 'open' AND created_at < ?`,
    [tenantId, currentDayStart]
  );
  if (staleOpenOrders.length > 0) {
    const ids = staleOpenOrders.map(o => o.id);
    await pool.query(
      `UPDATE orders SET status = 'closed', auto_closed_unpaid = 1 WHERE id IN (?)`,
      [ids]
    );
  }

  const [payments] = await pool.query(
    `SELECT op.pay_label, SUM(op.amount) as total FROM order_payments op
     JOIN orders o ON o.id = op.order_id WHERE o.tenant_id = ? AND op.created_at BETWEEN ? AND ? GROUP BY op.pay_label`,
    [tenantId, prevDayStart, prevDayEnd]
  );
  const [[expenseRow]] = await pool.query(
    `SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE tenant_id = ? AND created_at BETWEEN ? AND ?`,
    [tenantId, prevDayStart, prevDayEnd]
  );
  let cashTotal = 0, cardTotal = 0, otherTotal = 0;
  payments.forEach(p => {
    const label = (p.pay_label || '').toLowerCase();
    if (label.includes('nakit')) cashTotal += Number(p.total);
    else if (label.includes('kart')) cardTotal += Number(p.total);
    else otherTotal += Number(p.total);
  });
  const revenueTotal = cashTotal + cardTotal + otherTotal;
  const expenseTotal = Number(expenseRow.total);

  await pool.query(
    `INSERT INTO day_closures (tenant_id, closure_date, cash_total, card_total, other_total, expense_total, net_total, closed_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'Otomatik')`,
    [tenantId, closureDateLabel, cashTotal, cardTotal, otherTotal, expenseTotal, revenueTotal - expenseTotal]
  );
  return true;
}

// Bir siparişin, tenant'ın o anki iş gününde kaçıncı sipariş olduğunu
// hesaplar — "1. Adisyon, 2. Adisyon" diye her iş günü sıfırdan başlasın diye.
export async function computeDailyOrderNumber(tenantId, openingTime) {
  const dayStart = businessDayStartUtc(new Date(), openingTime);
  const [[row]] = await pool.query(
    'SELECT COUNT(*) as c FROM orders WHERE tenant_id = ? AND created_at >= ?',
    [tenantId, dayStart]
  );
  return Number(row.c) + 1;
}

// Sunucu her açıldığında (Redeploy dahil) TÜM işletmeler için kontrol eder —
// kimse giriş yapmamış olsa bile süresi dolmuş bir iş günü varsa kapatılır.
export async function runAutoDayCloseForAllTenants() {
  // Tüm işletmelerin açılış saatini TEK sorguda çekiyoruz — 1000 işletmede
  // 1000 ayrı sorgu yerine 1 sorgu. runAutoDayCloseIfNeeded artık kendisi
  // kapatma yapıp yapmadığını (true/false) döndürüyor, önce/sonra sayımı için
  // ekstra sorguya gerek kalmadı.
  const [tenants] = await pool.query('SELECT id, opening_time FROM tenants');
  let closed = 0;
  for (const t of tenants) {
    try {
      const didClose = await runAutoDayCloseIfNeeded(t.id, t.opening_time);
      if (didClose) closed++;
    } catch (e) { console.error(`Tenant ${t.id} için otomatik gün sonu başarısız:`, e.message); }
  }
  return closed;
}
