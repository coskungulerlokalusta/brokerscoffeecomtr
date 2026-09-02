// PAYLAŞILAN YARDIMCI — kasa.html, panel.html, admin.html, patron.html,
// gorevler.html hepsi bu dosyayı yükler. Önceden her biri kendi "apiCall"
// fonksiyonunu ayrı ayrı tanımlıyordu, aralarında küçük farklar (örn.
// patron.html hatalı JSON cevaplarını düzgün yakalamıyordu) birikmişti.
// Artık tek yerden düzeltiliyor, hepsine aynı anda yansıyor.
//
// NOT: Bu dosya modül değil, klasik <script> — sayfanın kendi tanımladığı
// `token` ve `API_BASE` değişkenlerini (aynı sayfa içindeki başka bir
// <script> bloğunda olsa bile) global kapsamdan okuyabilir. Her sayfa
// KENDİ `API_BASE` değerini tanımlamaya devam eder (kasa/gorevler mutlak
// adres kullanır, panel/admin/patron göreli — bu fark bilerek korunuyor).

async function apiCall(path, opts = {}) {
  const res = await fetch(API_BASE + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(typeof token !== 'undefined' && token ? { 'Authorization': 'Bearer ' + token } : {}),
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'İstek başarısız');
  return data;
}

// panel.html/admin.html/patron.html "api" adıyla çağırıyor, kasa.html/
// gorevler.html "apiCall" adıyla — ikisi de aynı fonksiyona işaret etsin diye
// her iki ismi de tanımlıyoruz, sayfaların kendi kodunu değiştirmemize gerek kalmadı.
const api = apiCall;
