const crypto = require('crypto');
const kv = require('./kvStore');
const { GROUPS } = require('./discountGroups');

const KEY = 'settings';

const DEFAULT_DISCOUNT_BY_GROUP = {};
GROUPS.forEach((g) => { DEFAULT_DISCOUNT_BY_GROUP[g.key] = 20; });

// Personel ve müşteri için ayrı ayrı yapılandırılabilen görünüm ayarları.
// Admin panelde iki sekme olarak gösterilir, ikisi de aynı alanlara sahip ama
// bağımsız değerler taşıyabilir (örn. müşteride adres zorunlu, personelde değil).
const AUDIENCE_VIEW_DEFAULTS = {
  showPaymentMethodSelector: true,
  paymentMethodsEnabled: { card: true, store: true, multinet: false, pluxee: false, ticket: false, metropol: false },
  showOrderPreferences: true,
  requireAddress: true,
  showDeliveryInfo: true,
  hiddenCategories: [], // menüde bu kişi tipine hiç gösterilmeyecek kategoriler
  hideCustomizationForCategories: [], // İçim Tercihi/Ekstra Shot'ın gösterilmeyeceği kategoriler
  monthlySpendTiers: [
    { threshold: 500, discount: 60 },
    { threshold: 1000, discount: 150 },
    { threshold: 1500, discount: 250 },
  ],
};

const DEFAULTS = {
  staffDiscountByGroup: DEFAULT_DISCOUNT_BY_GROUP,
  staffBannerText: 'Personel indirimi uygulanıyor.',
  staffSignupCode: crypto.randomBytes(4).toString('hex').toUpperCase(),
  pointsPerTL: 10,
  aiAutoReplyEnabled: false,
  aiInstructions: 'Sen Brokers Coffee\'nin WhatsApp/Instagram/Messenger üzerinden müşterilerle konuşan yapay zeka asistanısın. Sıcak, samimi ve kısa cevaplar ver. Menü, fiyat, teslimat ve sipariş hakkında sorulara yardımcı ol. Emin olmadığın konularda müşteriyi mağazayı aramaya veya beklemeye yönlendir.',
  audienceSettings: {
    customer: { ...AUDIENCE_VIEW_DEFAULTS, paymentMethodsEnabled: { ...AUDIENCE_VIEW_DEFAULTS.paymentMethodsEnabled }, monthlySpendTiers: AUDIENCE_VIEW_DEFAULTS.monthlySpendTiers.map((t) => ({ ...t })) },
    staff: { ...AUDIENCE_VIEW_DEFAULTS, paymentMethodsEnabled: { ...AUDIENCE_VIEW_DEFAULTS.paymentMethodsEnabled }, monthlySpendTiers: AUDIENCE_VIEW_DEFAULTS.monthlySpendTiers.map((t) => ({ ...t })) },
  },
  extraShotPrice: 10,
  deliveryFeeThreshold: 750, // bu tutarın üzerindeki siparişlerde kargo/kurye ücretsiz
  deliveryFee: 150, // eşiğin altında kalan kurye siparişlerine eklenen ücret
  categoryOrder: [],
  orderNotifyPhone1: '',
  orderNotifyPhone2: '',
  orderNotifySmsPhones: [],
};

function mergeAudienceView(stored) {
  return {
    ...AUDIENCE_VIEW_DEFAULTS,
    ...stored,
    paymentMethodsEnabled: { ...AUDIENCE_VIEW_DEFAULTS.paymentMethodsEnabled, ...((stored && stored.paymentMethodsEnabled) || {}) },
    hiddenCategories: (stored && stored.hiddenCategories) || [],
    hideCustomizationForCategories: (stored && stored.hideCustomizationForCategories) || [],
    monthlySpendTiers: (stored && stored.monthlySpendTiers) || AUDIENCE_VIEW_DEFAULTS.monthlySpendTiers,
  };
}

async function loadSettings() {
  const stored = await kv.getJSON(KEY, null);
  if (!stored) {
    await kv.setJSON(KEY, DEFAULTS);
    return DEFAULTS;
  }
  const merged = { ...DEFAULTS, ...stored };
  // Yeni bir grup eklendiyse eski kayıtlarda eksik kalmasın diye tamamla
  merged.staffDiscountByGroup = { ...DEFAULT_DISCOUNT_BY_GROUP, ...(stored.staffDiscountByGroup || {}) };
  merged.audienceSettings = {
    customer: mergeAudienceView(stored.audienceSettings && stored.audienceSettings.customer),
    staff: mergeAudienceView(stored.audienceSettings && stored.audienceSettings.staff),
  };
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

// Kurye siparişi eşiğin altındaysa kargo ücreti ekler, üstündeyse ücretsizdir.
// Gel Al siparişlerinde her zaman 0 döner.
function calculateDeliveryFee(itemsTotal, deliveryType, currentSettings) {
  if (deliveryType !== 'kurye') return 0;
  const threshold = currentSettings.deliveryFeeThreshold ?? 750;
  const fee = currentSettings.deliveryFee ?? 150;
  return itemsTotal >= threshold ? 0 : fee;
}

module.exports = { loadSettings, saveSettings, updateSettings, calculateDeliveryFee };
