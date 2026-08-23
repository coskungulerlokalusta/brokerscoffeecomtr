import rateLimit from 'express-rate-limit';

// AI Asistan / görsel oluşturma gibi GERÇEK PARA maliyeti olan uç noktalar —
// biri saniyede yüzlerce istek gönderse hem sunucuyu yorar hem gerçek Claude/
// Gemini faturası çıkarır. Kişi (IP) başına makul bir sınır koyuyoruz — normal
// kullanımda (bir kasiyerin sohbet etmesi) asla bu sınıra takılmaz.
export const aiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 dakika
  limit: 30, // 5 dakikada en fazla 30 istek
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla istek gönderildi, birkaç dakika sonra tekrar deneyin.' },
});

// PIN girişi — sadece 4 haneli (10.000 ihtimal), art arda deneme yapılarak
// tahmin edilmeye çalışılmasın diye IP başına sınırlıyoruz.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 dakika
  limit: 20, // 15 dakikada en fazla 20 giriş denemesi
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla giriş denemesi yapıldı, birkaç dakika sonra tekrar deneyin.' },
});
