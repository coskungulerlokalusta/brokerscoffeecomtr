import express from 'express';
import pool from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { initCheckout, verifyAndCompletePayment, isPaymentConfigured } from '../iyzicoPayment.js';

const router = express.Router();
router.use(requireAuth);

// İşletmenin kendi abonelik faturalarını görmesi — süper adminin oluşturduğu
// faturalar burada listelenir (Kardo'daki "Kardo Faturaları" ekranının karşılığı)
router.get('/', async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM subscription_invoices WHERE tenant_id = ? ORDER BY due_date DESC',
    [req.tenantId]
  );
  res.json(rows);
});

// Ödeme sistemi (iyzico/Paynet) yapılandırılmış mı — panelde "Öde" butonunun
// görünüp görünmeyeceğini belirlemek için kullanılıyor.
router.get('/payment-status', async (req, res) => {
  res.json({ configured: await isPaymentConfigured() });
});

// Bir fatura için ödeme oturumu başlatır — döndürdüğü HTML/JS içeriği panelde
// bir modala gömülüp müşteri kart bilgisini iyzico'nun güvenli formu üzerinden giriyor.
router.post('/:id/checkout', async (req, res) => {
  const [[invoice]] = await pool.query('SELECT * FROM subscription_invoices WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
  if (!invoice) return res.status(404).json({ error: 'Fatura bulunamadı' });
  if (invoice.paid) return res.status(400).json({ error: 'Bu fatura zaten ödenmiş' });
  const [[tenant]] = await pool.query('SELECT name, billing_tckn, billing_address, billing_city FROM tenants WHERE id = ?', [req.tenantId]);
  const [[owner]] = await pool.query(`SELECT email FROM users WHERE tenant_id = ? AND role = 'owner' LIMIT 1`, [req.tenantId]);

  const requestIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim().replace('::ffff:', '');
  const result = await initCheckout({
    invoiceId: invoice.id, tenantId: req.tenantId, tenantName: tenant?.name, tenantEmail: owner?.email,
    amount: invoice.amount,
    callbackUrl: `${req.protocol}://${req.get('host')}/billing/payment-callback`,
    requestIp, billingTckn: tenant?.billing_tckn, billingAddress: tenant?.billing_address, billingCity: tenant?.billing_city,
  });
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ checkoutFormContent: result.checkoutFormContent });
});

// Kart kaydederek ödeme — DOĞRUDAN KART API'Sİ (Lokalusta'daki gibi).
// ŞU AN KULLANILMIYOR: panel arayüzü artık daha güvenli olan Checkout Form +
// "Bu kartı sakla" yöntemini kullanıyor (kart bilgisi hiç sunucumuza
// değmiyor). Bu uç nokta, ileride kendi form tasarımımızı isterseniz diye
// iyzicoPayment.js'de (registerCardAndPay) hazır bekliyor ama şu an hiçbir
// arayüzden çağrılmıyor.

// İşletmenin kayıtlı bir kartı var mı — panelde "Kayıtlı Kart: **** 1234"
// gösterip göstermeyeceğimizi belirlemek için.
router.get('/card-status', async (req, res) => {
  const [[row]] = await pool.query('SELECT card_last_four, card_registered_at FROM tenants WHERE id = ?', [req.tenantId]);
  res.json({ hasCard: !!row?.card_last_four, lastFour: row?.card_last_four || null, registeredAt: row?.card_registered_at || null });
});

router.delete('/card', async (req, res) => {
  await pool.query('UPDATE tenants SET iyzico_card_user_key = NULL, iyzico_card_token = NULL, card_last_four = NULL, card_registered_at = NULL WHERE id = ?', [req.tenantId]);
  res.json({ ok: true });
});

export default router;
