import { S3Client, PutObjectCommand, CopyObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import crypto from 'crypto';
import pool from './db.js';

// Ürün resimlerini Cloudflare R2'ye (S3 uyumlu depolama) yükler — MySQL veya
// sunucunun kendi dosya sistemi yerine burayı kullanıyoruz çünkü:
//  1) Hostinger her Redeploy'da dosya sistemini sıfırlıyor (kalıcı değil)
//  2) Binlerce işletme ölçeğinde resimleri veritabanında tutmak, hem veritabanı
//     bağlantı havuzunu hem MySQL'in kendisini gereksiz yere yorar
// R2, trafiği (resmi gösterme) hiç ücretlendirmediği için bu iş için ideal.
const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  forcePathStyle: true, // R2 için gerekli — belirtilmezse bazı isteklerde sessizce başarısız olabiliyor
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

export async function saveBase64ImageIfNeeded(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string') return imageUrl;
  if (!imageUrl.startsWith('data:')) return imageUrl; // zaten kalıcı bir URL

  if (!process.env.R2_ENDPOINT || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY || !process.env.R2_PUBLIC_URL) {
    throw new Error('Görsel depolama (R2) sunucuda henüz ayarlanmadı — ortam değişkenleri eksik.');
  }

  const match = imageUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) return imageUrl; // beklenmeyen format, olduğu gibi bırak

  const mimeType = match[1];
  const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1];
  const buffer = Buffer.from(match[2], 'base64');
  const fileName = `products/${crypto.randomBytes(16).toString('hex')}.${ext}`;

  await r2.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME || 'durakpos-images',
    Key: fileName,
    Body: buffer,
    ContentType: mimeType,
    CacheControl: 'public, max-age=31536000, immutable', // tarayıcı 1 yıl boyunca yeniden istemesin
  }));

  const publicBase = process.env.R2_PUBLIC_URL.replace(/\/$/, '');
  return `${publicBase}/${fileName}`;
}

// Daha önce (Cache-Control eklenmeden ÖNCE) yüklenmiş resimleri, dosyayı
// yeniden yüklemeden, sadece meta verisini güncelleyerek düzeltir — bir
// kerelik bakım işlemi. Panel bunu arkaplanda tek seferlik çağırır.
export async function fixExistingImageCaching() {
  const bucket = process.env.R2_BUCKET_NAME || 'durakpos-images';
  let continuationToken;
  let fixed = 0;
  do {
    const list = await r2.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'products/', ContinuationToken: continuationToken }));
    for (const obj of list.Contents || []) {
      await r2.send(new CopyObjectCommand({
        Bucket: bucket,
        Key: obj.Key,
        CopySource: `${bucket}/${obj.Key}`,
        MetadataDirective: 'REPLACE',
        CacheControl: 'public, max-age=31536000, immutable',
      }));
      fixed++;
    }
    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (continuationToken);
  return fixed;
}

// Daha önce (özel alan adına geçmeden önce) R2'nin engellenen/yavaş r2.dev
// genel adresiyle kaydedilmiş resimleri, kendi alan adımıza (R2_PUBLIC_URL)
// otomatik çevirir — önceden bu bir kerelik elle SQL'di, artık kendiliğinden.
export async function fixLegacyR2Urls() {
  if (!process.env.R2_PUBLIC_URL) return 0;
  const publicBase = process.env.R2_PUBLIC_URL.replace(/\/$/, '');
  const [rows] = await pool.query(
    "SELECT id, image_url FROM products WHERE image_url LIKE '%.r2.dev/%'"
  );
  let fixed = 0;
  for (const row of rows) {
    const match = row.image_url.match(/\/(products\/[^/?]+)$/);
    if (!match) continue;
    const newUrl = `${publicBase}/${match[1]}`;
    await pool.query('UPDATE products SET image_url = ? WHERE id = ?', [newUrl, row.id]);
    fixed++;
  }
  return fixed;
}
