import Iyzipay from 'iyzipay';
import pool from './db.js';

// Ayarlar veritabanında (platform_settings) tutuluyor, süper admin panelden
// giriyor — kod değişikliği ya da sunucu yeniden başlatmadan, girilir
// girilmez bir sonraki ödeme isteğinde otomatik devreye giriyor.
async function getIyzicoClient() {
  const [[row]] = await pool.query('SELECT * FROM platform_settings WHERE id = 1');
  if (!row || !row.iyzico_api_key || !row.iyzico_secret_key) return null;
  return new Iyzipay({
    apiKey: row.iyzico_api_key,
    secretKey: row.iyzico_secret_key,
    uri: row.iyzico_base_url || 'https://api.iyzipay.com',
  });
}

export async function isPaymentConfigured() {
  const client = await getIyzicoClient();
  return !!client;
}

// Bir fatura için ödeme (Checkout Form) oturumu başlatır — dönen "checkoutFormContent"
// HTML/JS içeriği doğrudan panelde bir modala gömülüp müşteri kart bilgisini
// GÜVENLİ şekilde (iyzico'nun kendi güvenli formu üzerinden, bizim sunucumuza
// hiç kart verisi değmeden) giriyor.
export async function initCheckout({ invoiceId, tenantId, tenantName, tenantEmail, amount, callbackUrl, requestIp, billingTckn, billingAddress, billingCity }) {
  const client = await getIyzicoClient();
  if (!client) return { ok: false, error: 'Ödeme sistemi henüz yapılandırılmadı. Lütfen daha sonra tekrar deneyin veya bizimle iletişime geçin.' };
  if (!billingTckn) {
    return { ok: false, error: 'Ödeme başlatmadan önce Faturalarım sayfasında TCKN/fatura bilgilerinizi tamamlamanız gerekiyor.' };
  }

  const conversationId = `inv-${invoiceId}-${Date.now()}`;
  const address = billingAddress || 'Türkiye';
  const city = billingCity || 'Istanbul';
  const request = {
    locale: Iyzipay.LOCALE.TR,
    conversationId,
    price: Number(amount).toFixed(2),
    paidPrice: Number(amount).toFixed(2),
    currency: Iyzipay.CURRENCY.TRY,
    basketId: `subscription-${invoiceId}`,
    paymentGroup: Iyzipay.PAYMENT_GROUP.SUBSCRIPTION,
    callbackUrl,
    // Kart Saklama eklentisi iyzico hesabında aktifse, Checkout Form'da
    // otomatik olarak "Bu kartı sakla" seçeneği çıkar — müşteri işaretlerse
    // kart hiç bizim sunucumuza değmeden, sonraki otomatik çekimler için
    // token olarak saklanır (verifyAndCompletePayment içinde yakalanıyor).
    buyer: {
      id: `tenant-${tenantId}`,
      name: tenantName || 'İşletme',
      surname: 'Sahibi',
      email: tenantEmail || 'bilgi@durakpos.com',
      identityNumber: billingTckn,
      registrationAddress: address,
      ip: requestIp || '85.34.78.112',
      city, country: 'Turkey',
    },
    shippingAddress: { contactName: tenantName || 'İşletme', city, country: 'Turkey', address },
    billingAddress: { contactName: tenantName || 'İşletme', city, country: 'Turkey', address },
    basketItems: [{
      id: `sub-${invoiceId}`, name: 'DurakPOS Abonelik Ödemesi', category1: 'Yazılım Aboneliği',
      itemType: Iyzipay.BASKET_ITEM_TYPE.VIRTUAL, price: Number(amount).toFixed(2),
    }],
  };

  return new Promise((resolve) => {
    client.checkoutFormInitialize.create(request, async (err, result) => {
      if (err || !result || result.status !== 'success') {
        return resolve({ ok: false, error: (result && result.errorMessage) || (err && err.message) || 'Ödeme oturumu başlatılamadı.' });
      }
      await pool.query('UPDATE subscription_invoices SET payment_token = ?, payment_status = ? WHERE id = ?', [result.token, 'started', invoiceId]);
      resolve({ ok: true, checkoutFormContent: result.checkoutFormContent, token: result.token });
    });
  });
}

// Ödeme tamamlandıktan sonra iyzico'nun yönlendirdiği callback'te, ödemenin
// GERÇEKTEN başarılı olup olmadığını iyzico'nun kendisine SORARAK doğruluyoruz
// — tarayıcıdan gelen bilgiye asla güvenilmiyor, sahte "başarılı" bildirimi
// gönderilse bile sistem bunu kabul etmez.
export async function verifyAndCompletePayment(token) {
  const client = await getIyzicoClient();
  if (!client) return { ok: false, error: 'Ödeme sistemi yapılandırılmadı.' };

  return new Promise((resolve) => {
    client.checkoutForm.retrieve({ locale: Iyzipay.LOCALE.TR, token }, async (err, result) => {
      if (err || !result) return resolve({ ok: false, error: 'Doğrulama başarısız.' });
      const [[invoice]] = await pool.query('SELECT * FROM subscription_invoices WHERE payment_token = ?', [token]);
      if (!invoice) return resolve({ ok: false, error: 'Fatura bulunamadı.' });

      if (result.status === 'success' && result.paymentStatus === 'SUCCESS') {
        await pool.query(
          'UPDATE subscription_invoices SET paid = 1, paid_at = NOW(), payment_status = ?, payment_id = ? WHERE id = ?',
          ['success', result.paymentId, invoice.id]
        );
        // Ödeme başarılıysa, şubenin abonelik durumunu da otomatik "active" yapıyoruz
        await pool.query('UPDATE tenants SET subscription_status = ? WHERE id = ?', ['active', invoice.tenant_id]);
        // Müşteri "Bu kartı sakla" seçeneğini işaretlediyse, iyzico bu
        // sorgulama cevabında cardUserKey/cardToken döner — varsa,
        // sonraki otomatik çekimler için saklıyoruz. Kart numarasının
        // KENDİSİ bize hiç gelmiyor, sadece bu iki token.
        if (result.cardUserKey && result.cardToken) {
          const lastFour = result.lastFourDigits || null;
          await pool.query(
            'UPDATE tenants SET iyzico_card_user_key = ?, iyzico_card_token = ?, card_last_four = ?, card_registered_at = NOW() WHERE id = ?',
            [result.cardUserKey, result.cardToken, lastFour, invoice.tenant_id]
          );
        }
        return resolve({ ok: true, invoiceId: invoice.id, tenantId: invoice.tenant_id, cardSaved: !!(result.cardUserKey && result.cardToken) });
      }
      await pool.query('UPDATE subscription_invoices SET payment_status = ? WHERE id = ?', ['failed', invoice.id]);
      resolve({ ok: false, error: result.errorMessage || 'Ödeme başarısız.' });
    });
  });
}

// ============================================================
// KAYITLI KART (TOKENIZATION) — ödeme günü geldiğinde işletmenin kartından
// OTOMATİK tekrar çekim yapabilmek için. Lokalusta'da (balanceController.js
// dışındaki tek seferlik kart akışında) kanıtlanmış aynı yöntem: kart bilgisi
// iyzico'nun Payment API'sine "registerCard: 1" ile gönderiliyor, dönen
// cardUserKey/cardToken bizde saklanıyor — GERÇEK KART NUMARASI/CVC ASLA
// veritabanımıza yazılmıyor, sadece bu iki token (kart bilgisi olmadan tek
// başlarına işe yaramaz).
// ============================================================

// İlk ödeme + kart kaydı — işletme sahibi panelde kart bilgisini giriyor,
// hem o anki faturayı öder hem kartı ileride otomatik çekim için kaydeder.
export async function registerCardAndPay({ invoiceId, tenantId, tenantName, tenantEmail, amount, requestIp, billingTckn, billingAddress, billingCity, billingPhone, cardHolderName, cardNumber, expireMonth, expireYear, cvc }) {
  const client = await getIyzicoClient();
  if (!client) return { ok: false, error: 'Ödeme sistemi henüz yapılandırılmadı.' };
  if (!billingTckn) return { ok: false, error: 'Önce Faturalarım sayfasında TCKN/fatura bilgilerinizi tamamlamanız gerekiyor.' };

  const conversationId = `card-${tenantId}-${Date.now()}`;
  const address = billingAddress || 'Türkiye';
  const city = billingCity || 'Istanbul';
  const request = {
    locale: Iyzipay.LOCALE.TR,
    conversationId,
    price: Number(amount).toFixed(2),
    paidPrice: Number(amount).toFixed(2),
    currency: Iyzipay.CURRENCY.TRY,
    installment: '1',
    basketId: `subscription-${invoiceId}`,
    paymentChannel: Iyzipay.PAYMENT_CHANNEL.WEB,
    paymentGroup: Iyzipay.PAYMENT_GROUP.SUBSCRIPTION,
    paymentCard: { cardHolderName, cardNumber, expireMonth, expireYear, cvc, registerCard: '1' },
    buyer: {
      id: `tenant-${tenantId}`, name: tenantName || 'İşletme', surname: 'Sahibi',
      email: tenantEmail || 'bilgi@durakpos.com', identityNumber: billingTckn,
      registrationAddress: address, ip: requestIp || '85.34.78.112', city, country: 'Turkey',
      gsmNumber: billingPhone || undefined,
    },
    shippingAddress: { contactName: tenantName || 'İşletme', city, country: 'Turkey', address },
    billingAddress: { contactName: tenantName || 'İşletme', city, country: 'Turkey', address },
    basketItems: [{
      id: `sub-${invoiceId}`, name: 'DurakPOS Abonelik Ödemesi', category1: 'Yazılım Aboneliği',
      itemType: Iyzipay.BASKET_ITEM_TYPE.VIRTUAL, price: Number(amount).toFixed(2),
    }],
  };

  return new Promise((resolve) => {
    client.payment.create(request, async (err, result) => {
      if (err || !result || result.status !== 'success') {
        return resolve({ ok: false, error: (result && result.errorMessage) || (err && err.message) || 'Ödeme başarısız.' });
      }
      if (result.cardUserKey && result.cardToken) {
        await pool.query(
          'UPDATE tenants SET iyzico_card_user_key = ?, iyzico_card_token = ?, card_last_four = ?, card_registered_at = NOW() WHERE id = ?',
          [result.cardUserKey, result.cardToken, cardNumber.slice(-4), tenantId]
        );
      }
      await pool.query(
        'UPDATE subscription_invoices SET paid = 1, paid_at = NOW(), payment_status = ?, payment_id = ? WHERE id = ?',
        ['success', result.paymentId, invoiceId]
      );
      await pool.query('UPDATE tenants SET subscription_status = ? WHERE id = ?', ['active', tenantId]);
      resolve({ ok: true, cardSaved: !!(result.cardUserKey && result.cardToken) });
    });
  });
}

// Otomatik tekrar çekim — kayıtlı kart token'larıyla, kart bilgisi hiç
// istenmeden ödeme günü geldiğinde otomatik çalışır (autoInvoicing.js/
// overduePayments.js tarafından çağrılır).
export async function chargeStoredCard({ invoiceId, tenantId, amount }) {
  const client = await getIyzicoClient();
  if (!client) return { ok: false, error: 'Ödeme sistemi yapılandırılmadı.' };
  const [[tenant]] = await pool.query(
    'SELECT name, iyzico_card_user_key, iyzico_card_token, billing_tckn, billing_address, billing_city FROM tenants WHERE id = ?',
    [tenantId]
  );
  if (!tenant || !tenant.iyzico_card_user_key || !tenant.iyzico_card_token) {
    return { ok: false, error: 'Kayıtlı kart yok.' };
  }

  const conversationId = `autocharge-${invoiceId}-${Date.now()}`;
  const address = tenant.billing_address || 'Türkiye';
  const city = tenant.billing_city || 'Istanbul';
  const request = {
    locale: Iyzipay.LOCALE.TR,
    conversationId,
    price: Number(amount).toFixed(2),
    paidPrice: Number(amount).toFixed(2),
    currency: Iyzipay.CURRENCY.TRY,
    installment: '1',
    basketId: `subscription-${invoiceId}`,
    paymentChannel: Iyzipay.PAYMENT_CHANNEL.WEB,
    paymentGroup: Iyzipay.PAYMENT_GROUP.SUBSCRIPTION,
    paymentCard: { cardUserKey: tenant.iyzico_card_user_key, cardToken: tenant.iyzico_card_token },
    buyer: {
      id: `tenant-${tenantId}`, name: tenant.name || 'İşletme', surname: 'Sahibi',
      email: 'bilgi@durakpos.com', identityNumber: tenant.billing_tckn || '11111111111',
      registrationAddress: address, ip: '85.34.78.112', city, country: 'Turkey',
    },
    shippingAddress: { contactName: tenant.name || 'İşletme', city, country: 'Turkey', address },
    billingAddress: { contactName: tenant.name || 'İşletme', city, country: 'Turkey', address },
    basketItems: [{
      id: `sub-${invoiceId}`, name: 'DurakPOS Abonelik Ödemesi', category1: 'Yazılım Aboneliği',
      itemType: Iyzipay.BASKET_ITEM_TYPE.VIRTUAL, price: Number(amount).toFixed(2),
    }],
  };

  return new Promise((resolve) => {
    client.payment.create(request, async (err, result) => {
      if (err || !result || result.status !== 'success') {
        const errorMsg = (result && result.errorMessage) || (err && err.message) || 'Otomatik çekim başarısız.';
        await pool.query('UPDATE subscription_invoices SET auto_charge_attempts = auto_charge_attempts + 1 WHERE id = ?', [invoiceId]);
        return resolve({ ok: false, error: errorMsg });
      }
      await pool.query(
        'UPDATE subscription_invoices SET paid = 1, paid_at = NOW(), payment_status = ?, payment_id = ? WHERE id = ?',
        ['success', result.paymentId, invoiceId]
      );
      await pool.query('UPDATE tenants SET subscription_status = ? WHERE id = ?', ['active', tenantId]);
      resolve({ ok: true });
    });
  });
}
