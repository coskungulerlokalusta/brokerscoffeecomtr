const crypto = require('crypto');
const kv = require('./kvStore');
const { GROUPS } = require('./discountGroups');

const KEY = 'settings';

const DEFAULT_DISCOUNT_BY_GROUP = {};
GROUPS.forEach((g) => { DEFAULT_DISCOUNT_BY_GROUP[g.key] = 20; });

const DEFAULTS = {
  staffDiscountByGroup: DEFAULT_DISCOUNT_BY_GROUP,
  staffBannerText: 'Personel indirimi uygulanıyor.',
  staffSignupCode: crypto.randomBytes(4).toString('hex').toUpperCase(),
  pointsPerTL: 10,
  aiAutoReplyEnabled: false,
  aiInstructions: 'Sen Brokers Coffee\'nin WhatsApp/Instagram/Messenger üzerinden müşterilerle konuşan yapay zeka asistanısın. Sıcak, samimi ve kısa cevaplar ver. Menü, fiyat, teslimat ve sipariş hakkında sorulara yardımcı ol. Emin olmadığın konularda müşteriyi mağazayı aramaya veya beklemeye yönlendir.',
  showPaymentMethodSelector: true,
  paymentMethodsEnabled: { card: true, store: true, multinet: false, pluxee: false, ticket: false, metropol: false },
  showOrderPreferences: true,
  hideDeliveryInfoForStaff: false,
  extraShotPrice: 10,
  hideCustomizationForCategories: [], // İçim Tercihi/Ekstra Shot'ın gösterilmeyeceği kategoriler (örn. Kruvasanlar)
  monthlySpendTiers: [
    { threshold: 500, discount: 60 },
    { threshold: 1000, discount: 150 },
    { threshold: 1500, discount: 250 },
  ],
  categoryOrder: [],
  orderNotifyPhone1: '',
  orderNotifyPhone2: '',
  orderNotifySmsPhones: [],
};

async function loadSettings() {
  const stored = await kv.getJSON(KEY, null);
  if (!stored) {
    await kv.setJSON(KEY, DEFAULTS);
    return DEFAULTS;
  }
  const merged = { ...DEFAULTS, ...stored };
  // Yeni bir grup eklendiyse eski kayıtlarda eksik kalmasın diye tamamla
  merged.staffDiscountByGroup = { ...DEFAULT_DISCOUNT_BY_GROUP, ...(stored.staffDiscountByGroup || {}) };
  merged.paymentMethodsEnabled = { ...DEFAULTS.paymentMethodsEnabled, ...(stored.paymentMethodsEnabled || {}) };
  return merged;
}

async function saveSettings(settings) {
  return kv.setJSON(KEY, settings);
}

async function updateSettings(partial) {
  const current = await loadSettings();
  const updated = { ...current, ...partial };
  await saveSettings(updated);
  return updated;
}

module.exports = { loadSettings, saveSettings, updateSettings };
