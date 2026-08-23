// Gemini ile ürün görseli üretir — hem AI Asistan (reports.js) hem panelin
// doğrudan "AI ile Oluştur" butonu (menu.js) bu fonksiyonu paylaşıyor.
// Not: Google'ın görsel üretme modeli sık değişiyor (Imagen ayrı bir API,
// "gemini-2.5-flash-image" ise standart generateContent uç noktasından
// görsel döndürüyor) — şu an ikincisini kullanıyoruz.
export async function generateImageWithGemini(prompt) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('Gemini API anahtarı sunucuda tanımlı değil — görsel üretme özelliği henüz aktif değil.');
  }
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Görsel üretilemedi');
  const parts = data.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find(p => p.inlineData || p.inline_data);
  const inline = imagePart ? (imagePart.inlineData || imagePart.inline_data) : null;
  if (!inline || !inline.data) throw new Error('Görsel üretilemedi — Gemini görsel içeren bir cevap döndürmedi.');
  return inline.data; // base64
}

export function buildProductImagePrompt(productName, visualDescription) {
  return `Ticari bir POS/menü sisteminde kullanılacak, temiz beyaz veya sade arka planlı, profesyonel ürün fotoğrafı tarzında bir görsel: "${productName}". ${visualDescription || ''} Gerçek marka logoları veya tescilli marka görsellerini birebir kopyalama — genel/stilize bir ürün görseli olsun.`;
}
