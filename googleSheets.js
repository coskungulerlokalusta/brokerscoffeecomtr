import { google } from 'googleapis';
import pool from './db.js';

// Servis hesabı bilgisi artık HER İŞLETMENİN KENDİ panelinden girdiği,
// kendine ait bir bilgi — süper panelle hiçbir ilgisi yok. Her işletme kendi
// Google Cloud servis hesabını oluşturup, kendi tablosunu o hesapla
// paylaşıyor.
async function getSheetsClient(tenantId) {
  const [[row]] = await pool.query('SELECT google_service_account_email, google_service_account_key FROM tenants WHERE id = ?', [tenantId]);
  if (!row || !row.google_service_account_email || !row.google_service_account_key) return null;
  const auth = new google.auth.JWT({
    email: row.google_service_account_email,
    key: row.google_service_account_key.replace(/\\n/g, '\n'), // panelden yapıştırılan anahtarda satır sonları kaçış karakteri olarak gelebiliyor
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

export async function isSheetsConfigured(tenantId) {
  const client = await getSheetsClient(tenantId);
  return !!client;
}

// Bir Google Sheets linkinden ("https://docs.google.com/spreadsheets/d/XXXX/edit...")
// sadece ID kısmını (XXXX) çıkarır — panelde kullanıcı tam linki yapıştırabilsin diye.
export function extractSheetId(urlOrId) {
  if (!urlOrId) return null;
  const match = urlOrId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : urlOrId.trim();
}

// Tabloya tek bir satır ekler — tarih, kategori, açıklama, tutar. "Kayıtlar"
// adlı bir sayfa (tab) yoksa otomatik oluşturur, başlık satırını da kendisi ekler.
export async function appendRow(tenantId, { category, description, amount }) {
  const sheets = await getSheetsClient(tenantId);
  if (!sheets) return { ok: false, error: 'Google Sheets henüz bağlanmamış — panelde AI Asistan sayfasındaki ⚙️ ikonundan kendi servis hesabı bilgilerinizi ve tablo linkinizi girmeniz gerekiyor.' };
  const [[tenant]] = await pool.query('SELECT google_sheet_id FROM tenants WHERE id = ?', [tenantId]);
  if (!tenant || !tenant.google_sheet_id) return { ok: false, error: 'Henüz bir Google E-Tablosu bağlanmamış — panelden Ayarlar sayfasına link eklemeniz gerekiyor.' };
  const sheetId = tenant.google_sheet_id;

  const now = new Date();
  const trDate = now.toLocaleDateString('tr-TR') + ' ' + now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

  try {
    // İlk kayıtta başlık satırının olup olmadığını kontrol ediyoruz — yoksa ekliyoruz.
    const existing = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'A1:D1' }).catch(() => null);
    if (!existing || !existing.data.values || existing.data.values.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId, range: 'A1:D1', valueInputOption: 'RAW',
        requestBody: { values: [['Tarih', 'Kategori', 'Açıklama', 'Tutar']] },
      });
    }
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId, range: 'A:D', valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [[trDate, category || '', description || '', amount != null ? amount : '']] },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'Tabloya yazılamadı: ' + (e.message || 'bilinmeyen hata') + ' — tabloyu servis hesabı e-postasıyla paylaştığınızdan emin olun.' };
  }
}
