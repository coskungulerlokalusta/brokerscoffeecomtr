import pool from './db.js';

// Ödeme tipleri artık panelden yönetiliyor — ama önceden sabit kodluydu
// (Nakit, Kredi Kartı, Yemek Kartı+Multinet/Setcard/Ticket/Sodexo). Hiçbir
// işletmenin ödeme ekranı aniden boş kalmasın diye, hiç ödeme tipi
// tanımlanmamış her işletmeye bu varsayılanları otomatik oluşturuyoruz.
export async function seedDefaultPaymentMethods() {
  const [tenants] = await pool.query('SELECT id FROM tenants');
  let seeded = 0;
  for (const t of tenants) {
    const [[existing]] = await pool.query('SELECT id FROM payment_methods WHERE tenant_id = ? LIMIT 1', [t.id]);
    if (existing) continue;
    const [nakit] = await pool.query('INSERT INTO payment_methods (tenant_id, name, icon, sort_order) VALUES (?, ?, ?, ?)', [t.id, 'Nakit', '💵', 1]);
    await pool.query('INSERT INTO payment_methods (tenant_id, name, icon, sort_order) VALUES (?, ?, ?, ?)', [t.id, 'Kredi Kartı', '💳', 2]);
    const [yemek] = await pool.query('INSERT INTO payment_methods (tenant_id, name, icon, sort_order) VALUES (?, ?, ?, ?)', [t.id, 'Yemek Kartı', '🍽', 3]);
    const yemekId = yemek.insertId;
    const subs = ['Multinet', 'Setcard', 'Ticket', 'Sodexo'];
    for (let i = 0; i < subs.length; i++) {
      await pool.query('INSERT INTO payment_method_subtypes (payment_method_id, name, sort_order) VALUES (?, ?, ?)', [yemekId, subs[i], i]);
    }
    seeded++;
  }
  return seeded;
}
