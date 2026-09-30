// Yönetim paneli — Uygulama Stüdyosu: müşteri uygulamasının içeriğini düzenler,
// değişiklikleri kaydetmeden önce telefon önizlemesinde canlı gösterir.
(function () {
  const S = { saved: null, draft: null, ordering: null, products: [], cats: [], tab: 'guide', page: '/', audience: 'customer', open: null, pickerQ: {} };
  let root;

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const P = (arr) => esc(JSON.stringify(arr));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const get = (path) => path.reduce((o, k) => (o == null ? undefined : o[k]), S.draft);
  function set(path, val) {
    let o = S.draft;
    for (let i = 0; i < path.length - 1; i++) {
      if (o[path[i]] == null || typeof o[path[i]] !== 'object') o[path[i]] = typeof path[i + 1] === 'number' ? [] : {};
      o = o[path[i]];
    }
    o[path[path.length - 1]] = val;
  }

  const TABS = [
    ['guide', '🧭', 'Rehber'], ['layout', '🧩', 'Sayfa Düzeni'], ['store', '🏪', 'Mağaza'], ['slides', '🎞️', 'Slider'], ['offers', '🎁', 'Fırsatlar'], ['cats', '🗂️', 'Kategoriler'],
    ['rails', '⭐', 'Raflar'], ['brand', '💛', 'Club & Hikaye'], ['contact', '📞', 'İletişim'], ['faq', '❓', 'SSS'], ['announce', '📢', 'Duyuru'], ['pages', '📄', 'Sayfalar'],
  ];
  const PAGES = [['/', 'Anasayfa'], ['/siparis.html', 'Sipariş Ver'], ['/menu.html', 'Menü'], ['/club.html', 'Club'], ['/diger.html', 'Diğer']];
  const TAB_PAGE = { guide: '/', layout: '/', pages: '/diger.html', store: '/siparis.html', slides: '/', offers: '/club.html#firsatlar', cats: '/siparis.html', rails: '/', brand: '/club.html', contact: '/diger.html', faq: '/diger.html', announce: '/' };
  const THEMES = [['navy', '#0d1b3d'], ['gold', '#f5c542'], ['cream', '#f1ece0'], ['dark', '#111']];
  const TONES = [['gold', '#f5c542'], ['navy', '#0d1b3d'], ['red', '#e3262f'], ['green', '#16a34a']];
  const AUD = [['both', 'Herkes'], ['customer', 'Sadece müşteri'], ['staff', 'Sadece personel']];

  // ---------- API ----------
  async function api(url, opts) {
    const r = await fetch(url, opts);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'İşlem başarısız');
    return d;
  }

  // ---------- Alan yardımcıları ----------
  const fText = (p, label, o = {}) => `<div class="st-field ${o.full ? 'full' : ''}"><label>${label}</label><input type="${o.type || 'text'}" data-p="${P(p)}" value="${esc(get(p) ?? '')}" placeholder="${esc(o.ph || '')}" ${o.max ? `maxlength="${o.max}"` : ''}/>${o.help ? `<div class="st-help" style="margin-top:4px">${o.help}</div>` : ''}</div>`;
  const fArea = (p, label, o = {}) => `<div class="st-field full"><label>${label}</label><textarea data-p="${P(p)}" placeholder="${esc(o.ph || '')}" rows="${o.rows || 3}">${esc(get(p) ?? '')}</textarea></div>`;
  const fSelect = (p, label, opts, o = {}) => `<div class="st-field ${o.full ? 'full' : ''}"><label>${label}</label><select data-p="${P(p)}">${opts.map(([v, t]) => `<option value="${esc(v)}" ${String(get(p) ?? '') === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>`;
  const fAudience = (p) => fSelect(p, 'Kimler görsün?', AUD);
  const fToggle = (p, label, help = '') => `<div class="st-row full" style="grid-column:1/-1;padding:6px 0"><div><b style="font-size:14px">${label}</b>${help ? `<div class="st-help">${help}</div>` : ''}</div><span class="st-toggle"><input type="checkbox" data-p="${P(p)}" ${get(p) ? 'checked' : ''}/></span></div>`;
  function linkOptions() {
    return [['', '— Hızlı seç —'], ['/siparis.html', 'Sipariş Ver sayfası'], ['/menu.html', 'Menü'], ['/club.html', 'Brokers Club'], ['/club.html#firsatlar', 'Fırsatlar'], ['/register.html', 'Üye ol'], ['/diger.html', 'Diğer'],
      ...S.cats.map((c) => ['/menu.html?cat=' + encodeURIComponent(c), 'Kategori: ' + c]),
      ...S.products.map((p) => ['/product.html?id=' + encodeURIComponent(p.id), 'Ürün: ' + p.name])];
  }
  const fLink = (p, label) => `<div class="st-field"><label>${label}</label><input type="text" data-p="${P(p)}" value="${esc(get(p) ?? '')}" placeholder="/siparis.html"/>
    <select class="st-input" style="margin-top:6px;height:36px;font-size:13px" data-linkfor="${P(p)}">${linkOptions().map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('')}</select></div>`;
  const fImage = (p, label) => {
    const v = get(p) || '';
    return `<div class="st-field full"><label>${label}</label><div class="st-img"><div class="st-thumb" data-thumb="${P(p)}">${v ? `<img src="${esc(v)}" alt=""/>` : '🖼️'}</div>
      <div class="st-img-in"><input type="text" data-p="${P(p)}" value="${esc(v)}" placeholder="https://… veya bilgisayardan yükle"/>
      <div class="st-img-btns"><label class="st-btn st-btn-line st-btn-sm" style="cursor:pointer">⬆️ Yükle<input type="file" accept=".jpg,.jpeg,.png,.webp" hidden data-upload="${P(p)}"/></label>${v ? `<button class="st-btn st-btn-danger st-btn-sm" data-act="clearimg" data-path="${P(p)}">Kaldır</button>` : ''}</div></div></div></div>`;
  };
  const fSwatch = (p, label, list) => `<div class="st-field full"><label>${label}</label><div class="st-swatches">${list.map(([v, c]) => `<button class="st-swatch ${get(p) === v ? 'on' : ''}" style="background:${c}" title="${v}" data-act="swatch" data-path="${P(p)}" data-v="${v}"></button>`).join('')}</div></div>`;
  const fDate = (p, label) => { const v = get(p); return `<div class="st-field"><label>${label}</label><input type="date" data-p="${P(p)}" data-date value="${v ? esc(String(v).slice(0, 10)) : ''}"/></div>`; };

  // ---------- Liste düzenleyici (slider, fırsatlar, raflar, SSS) ----------
  function listEditor(key, { titleOf, subOf, thumbOf, body, addLabel, newItem, noActive }) {
    const items = S.draft[key] || [];
    return `${items.map((it, i) => {
      const id = key + ':' + i; const open = S.open === id;
      const pills = [];
      if (it.audience === 'staff') pills.push('<span class="st-pill staff">Personel</span>');
      if (it.audience === 'customer') pills.push('<span class="st-pill customer">Müşteri</span>');
      if (!noActive && it.active === false) pills.push('<span class="st-pill">Pasif</span>');
      if (it.expiresAt && new Date(it.expiresAt) < new Date()) pills.push('<span class="st-pill warn">Süresi doldu</span>');
      return `<div class="st-item ${open ? 'open' : ''} ${!noActive && it.active === false ? 'off' : ''}">
        <div class="st-item-head" data-act="open" data-id="${esc(id)}">
          ${thumbOf ? `<div class="st-thumb">${thumbOf(it)}</div>` : ''}
          <div class="st-item-title"><b data-head="${esc(id)}">${esc(titleOf(it) || 'Başlıksız')}</b><small>${pills.join('')}${esc(subOf ? subOf(it) : '')}</small></div>
          <div class="st-item-acts">
            ${noActive ? '' : `<span class="st-toggle" title="Aktif/Pasif"><input type="checkbox" data-p="${P([key, i, 'active'])}" ${it.active !== false ? 'checked' : ''} data-rerender/></span>`}
            <button class="st-icon" title="Yukarı" data-act="up" data-key="${key}" data-i="${i}" ${i === 0 ? 'disabled' : ''}>▲</button>
            <button class="st-icon" title="Aşağı" data-act="down" data-key="${key}" data-i="${i}" ${i === items.length - 1 ? 'disabled' : ''}>▼</button>
            <button class="st-icon" title="Sil" data-act="del" data-key="${key}" data-i="${i}">🗑️</button>
          </div></div>
        <div class="st-item-body"><div class="st-grid">${open ? body(i, it) : ''}</div></div></div>`;
    }).join('')}<button class="st-add" data-act="add" data-key="${key}">＋ ${addLabel}</button>`;
    // newItem, S.newItems üzerinden kullanılır
  }
  const NEW = {
    slides: () => ({ id: uid(), active: true, audience: 'both', theme: 'navy', eyebrow: 'Yeni', title: 'Yeni slayt başlığı', subtitle: '', ctaText: 'Sipariş Ver', link: '/siparis.html', image: '' }),
    offers: () => ({ id: uid(), active: true, audience: 'both', group: 'Fırsatlar', badge: 'HEDİYE', title: 'Yeni fırsat', description: '', image: '', link: '/siparis.html', expiresAt: null }),
    rails: () => ({ id: uid(), active: true, audience: 'both', title: 'Yeni raf', subtitle: '', productIds: [] }),
    faq: () => ({ q: 'Yeni soru?', a: '' }),
    quick: () => ({ id: uid(), active: true, icon: '✨', label: 'Yeni kutu', link: '/menu.html' }),
    moreLinks: () => ({ id: uid(), active: true, icon: '🔗', title: 'Yeni bağlantı', link: '/' }),
    pages: () => ({ id: uid(), active: true, inMore: true, icon: '📄', slug: 'sayfa-' + uid().slice(0, 4), title: 'Yeni sayfa', subtitle: '', image: '', body: '' }),
  };
  // Sunucudaki ile aynı kural: Türkçe harfler sadeleşir, küçük harf ve tire
  const slugify = (v) => String(v || '').toLocaleLowerCase('tr').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sayfa';
  const imgThumb = (u) => (u ? `<img src="${esc(u)}" alt="" onerror="this.remove()"/>` : '🖼️');

  // ---------- Bölüm tanımları ----------
  const SECTION_META = {
    hello: { ic: '👋', t: 'Karşılama ve ana başlık', d: 'Günaydın + marka sloganı + sipariş durumu', tab: 'brand' },
    slider: { ic: '🎞️', t: 'Slider', d: 'Kayan büyük kampanya görselleri', tab: 'slides' },
    quick: { ic: '⚡', t: 'Hızlı erişim kutuları', d: 'Kısayol kutuları — aşağıdan düzenle' },
    club: { ic: '💛', t: 'Club kartı', d: 'Puan / üyelik daveti', tab: 'brand' },
    offers: { ic: '🎁', t: 'Fırsatlar şeridi', d: 'Fırsat kartları (yana kayar)', tab: 'offers' },
    rails: { ic: '⭐', t: 'Ürün rafları', d: 'Cazip Teklifler, En Sevilenler…', tab: 'rails' },
    categories: { ic: '🗂️', t: 'Kategori kartları', d: 'Menüyü keşfet ızgarası', tab: 'cats' },
    about: { ic: '📖', t: 'Hikayemiz', d: 'Görsel + hikaye metni', tab: 'brand' },
    store: { ic: '📍', t: 'Mağaza kartı', d: 'Adres, açık/kapalı, yol tarifi, ara', tab: 'store' },
    orders: { ic: '🧾', t: 'Geçmiş siparişlerim', d: 'Tek dokunuşla tekrar sipariş' },
  };

  function guideHtml() {
    const d = S.draft;
    const n = (arr) => (arr || []).length;
    const stat = (big, lbl, tab) => `<button class="st-stat" data-act="tab" data-v="${tab}"><b>${big}</b><span>${lbl}</span></button>`;
    const cap = { edit: '✏️ Düzenlenir', add: '➕ Eklenir / silinir', sort: '↕️ Sıralanır', hide: '👁️ Gizlenir', aud: '🎯 Müşteri / personel', img: '🖼️ Görsel yüklenir', no: '🔒 Sabit' };
    const chips = (list) => list.map((k) => `<span class="st-cap ${k === 'no' ? 'no' : ''}">${cap[k]}</span>`).join('');
    const go = (tab, label) => `<button class="st-btn st-btn-line st-btn-sm" data-act="tab" data-v="${tab}">${label || 'Düzenle'} →</button>`;
    const goAdmin = (sec, label) => `<button class="st-btn st-btn-line st-btn-sm" data-act="goto" data-v="${sec}">${label} ↗</button>`;
    const item = (ic, title, desc, caps, btn) => `<div class="st-g-item"><div class="st-g-ic">${ic}</div><div style="flex:1;min-width:0"><b>${title}</b><p>${desc}</p><div class="st-caps">${chips(caps)}</div></div><div>${btn || ''}</div></div>`;
    const page = (emoji, title, url, items) => `<div class="st-g-page"><div class="st-g-head"><span>${emoji}</span><div><h4>${title}</h4><small>${url}</small></div>
      <button class="st-btn st-btn-gold st-btn-sm" data-act="page" data-v="${url}" style="margin-left:auto">📱 Göster</button></div>${items.join('')}</div>`;

    return `<div class="st-guide">
      <div class="st-g-hero"><div><span class="st-g-kicker">KONTROL SENDE</span><h3>Sitenin neredeyse her köşesi buradan yönetiliyor</h3>
        <p>Kod bilmeden: görsel yükle, kampanya ekle, bölümleri sırala, sayfa oluştur. Sağdaki telefonda anında gör, <b>Yayınla</b> ile canlıya al.</p></div>
        <div class="st-stats">${stat(n(d.slides), 'slayt', 'slides')}${stat(n(d.offers), 'fırsat', 'offers')}${stat(n(d.rails), 'ürün rafı', 'rails')}${stat(S.cats.length, 'kategori', 'cats')}${stat(n(d.pages), 'özel sayfa', 'pages')}${stat(S.products.length, 'ürün', 'guide')}</div></div>

      <div class="st-legend">${Object.values(cap).map((c, i) => `<span class="st-cap ${i === 6 ? 'no' : ''}">${c}</span>`).join('')}</div>

      <h3 class="st-g-title">📱 Müşterinin gördüğü sayfalar</h3>
      <div class="st-g-grid">
      ${page('🏠', 'Anasayfa', '/', [
        item('🧩', 'Bölüm sırası', '9 bölümün yerini değiştir, istemediğini gizle.', ['sort', 'hide'], go('layout')),
        item('🎞️', 'Slider', 'En fazla 12 slayt: görsel, başlık, buton, renk.', ['add', 'sort', 'img', 'aud'], go('slides')),
        item('⚡', 'Hızlı erişim kutuları', 'En fazla 8 kısayol, emoji ikonlu.', ['add', 'sort', 'edit'], go('layout')),
        item('⭐', 'Ürün rafları', 'En fazla 10 raf, her rafta 30 ürün seç.', ['add', 'sort', 'aud'], go('rails')),
        item('📖', 'Hikayemiz + marka sloganı', 'Görsel, başlık, metin.', ['edit', 'img'], go('brand')),
        item('📢', 'Duyuru bandı', 'Tüm sayfaların üstünde renkli bant.', ['edit', 'hide', 'aud'], go('announce')),
      ])}
      ${page('🛵', 'Sipariş Ver', '/siparis.html', [
        item('🏪', 'Mağaza kartı & sipariş durumu', 'Adres, saatler, Açık / Saatlere göre / Kapalı.', ['edit'], go('store')),
        item('🗂️', 'Kategori kartları', 'Her kategoriye görsel, "YENİ" rozeti, gizle.', ['edit', 'img', 'hide'], go('cats')),
        item('🧩', 'Bölüm sırası', 'Mağaza, slider, geçmiş siparişler, kategoriler.', ['sort', 'hide'], go('layout')),
      ])}
      ${page('💛', 'Club & Fırsatlar', '/club.html', [
        item('🎁', 'Fırsat kartları', 'En fazla 40 kart; rozet, filtre grubu, bitiş tarihi.', ['add', 'sort', 'img', 'aud'], go('offers')),
        item('🏆', 'Ödüller ve puanlar', 'Ödül ekle/sil, puan değerleri, aylık kademeler.', ['add', 'edit'], goAdmin('loyalty', 'Sadakat Programı')),
        item('💬', 'Club metinleri', 'Başlık ve açıklama.', ['edit'], go('brand')),
      ])}
      ${page('☕', 'Menü & Ürünler', '/menu.html', [
        item('☕', 'Ürünler', 'Ürün ekle/sil, fiyat, boy, fotoğraf, açıklama, toplu fiyat.', ['add', 'edit', 'img', 'sort'], goAdmin('products', 'Ürün Yönetimi')),
        item('🗂️', 'Kategori sırası', 'Kategorilerin menüdeki sırası.', ['sort'], goAdmin('products', 'Ürün Yönetimi')),
        item('👔', 'Personel / müşteri görünürlüğü', 'Kategori ve ürünleri kişi tipine göre gizle, personel indirimleri.', ['hide', 'aud'], goAdmin('order-settings', 'Sipariş Ayarları')),
      ])}
      ${page('•••', 'Diğer', '/diger.html', [
        item('📄', 'Kendi sayfaların', 'Şubeler, Kariyer, Etkinlik… en fazla 20 sayfa.', ['add', 'edit', 'img', 'sort'], go('pages')),
        item('🔗', 'Menü bağlantıları', 'Google yorum, Instagram, rezervasyon… en fazla 12.', ['add', 'sort'], go('layout')),
        item('❓', 'SSS (Yardım)', 'Soru-cevaplar, en fazla 30.', ['add', 'sort', 'edit'], go('faq')),
        item('📞', 'İletişim & sosyal medya', 'Telefon, WhatsApp, 5 sosyal ağ.', ['edit'], go('contact')),
      ])}
      ${page('🛒', 'Sepet & Ödeme', '/cart.html', [
        item('💳', 'Ödeme yöntemleri, kurye ücreti', 'Kart, mağazada öde, yemek kartları, teslimat eşiği.', ['edit'], goAdmin('order-settings', 'Sipariş Ayarları')),
        item('🏷️', 'İndirim kampanyaları', 'Yüzde/tutar indirimleri ve personel duyurusu.', ['add', 'edit'], goAdmin('campaigns', 'Kampanyalar')),
        item('🔒', 'Sayfa tasarımı', 'Sepet ve ödeme ekranının düzeni.', ['no']),
      ])}
      </div>

      <h3 class="st-g-title">🖼️ Görsel ölçüleri (en iyi sonuç için)</h3>
      <div class="st-sizes">
        ${[['🎞️', 'Slider', '1600 × 900', '16:9 yatay'], ['🎁', 'Fırsat kartı', '1200 × 750', '16:10 yatay'], ['🗂️', 'Kategori kartı', '800 × 600', '4:3'], ['☕', 'Ürün fotoğrafı', '1000 × 1000', 'kare'], ['📖', 'Hikayemiz', '1600 × 900', '16:9'], ['📄', 'Sayfa kapağı', '1600 × 600', 'geniş yatay']].map(([ic, t, px, r]) => `<div class="st-size"><span>${ic}</span><b>${t}</b><strong>${px}</strong><small>${r}</small></div>`).join('')}
      </div>
      <p class="st-help" style="margin-top:8px">JPG, PNG veya WEBP · en fazla 5 MB · ürünün ortada olduğu, sade arka planlı fotoğraflar en şık sonucu verir.</p>

      <h3 class="st-g-title">🧪 Hazır tarifler</h3>
      <div class="st-recipes">
        <div class="st-recipe"><b>☀️ Yaz kampanyası duyur</b><ol><li>Fırsatlar → kart ekle, rozet "%20", bitiş tarihi seç</li><li>Slider → aynı kampanyaya slayt ekle</li><li>Duyuru bandını aç</li><li>Yayınla 🚀</li></ol></div>
        <div class="st-recipe"><b>🆕 Yeni ürün lansmanı</b><ol><li>Ürün Yönetimi → ürünü ekle</li><li>Kategoriler → rozet "YENİ"</li><li>Raflar → ürünü en başa koy</li><li>Yayınla 🚀</li></ol></div>
        <div class="st-recipe"><b>⛔ Yoğunluk / tatil</b><ol><li>Mağaza → "Kapalı"</li><li>Kapalı mesajını yaz</li><li>Yayınla — site sipariş almayı durdurur</li></ol></div>
        <div class="st-recipe"><b>👔 Sadece personele duyuru</b><ol><li>Slider veya fırsatta "Sadece personel" seç</li><li>Sağ üstte "Personel gözüyle" ile kontrol et</li><li>Yayınla 🚀</li></ol></div>
      </div>

      <h3 class="st-g-title">🔒 Şimdilik panelden yapılamayanlar</h3>
      <div class="st-cant">
        <div>🧭 <b>Alt menüdeki 5 sekme</b> sabittir (Anasayfa, Club, Sipariş Ver, Menü, Diğer).</div>
        <div>🎨 <b>Renkler ve yazı tipi</b> marka kimliğine göre sabittir.</div>
        <div>⚖️ <b>Kullanım Koşulları / Gizlilik / KVKK</b> metinleri hukuki olduğu için kodda durur — değişiklik gerekirse yazılımcı günceller.</div>
        <div>🛒 <b>Sepet ve ödeme ekranının düzeni</b> güvenlik için sabittir (içerikleri Sipariş Ayarları'ndan).</div>
        <div>🏷️ <b>Kampanyalar (indirim kuralları)</b> fırsat kartlarına otomatik düşmez — duyurmak için Fırsatlar'a kart ekle.</div>
        <div>🏪 <b>Eski "Şubelerimiz" ve "Blog" sayfaları</b> sabit; yerlerine <b>Sayfalar</b> sekmesinden yenisini oluşturabilirsin.</div>
      </div>
    </div>`;
  }

  // ---------- Sekmeler ----------
  function storeStatus() {
    const st = S.draft.store;
    if (st.mode === 'closed') return { open: false, msg: 'Siparişe kapalı' };
    if (st.mode === 'auto') {
      const now = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
      const inH = st.openTime <= st.closeTime ? now >= st.openTime && now < st.closeTime : now >= st.openTime || now < st.closeTime;
      return inH ? { open: true, msg: `Şu an açık · ${st.closeTime}'a kadar` } : { open: false, msg: `Şu an kapalı · ${st.openTime}'da açılır` };
    }
    return { open: true, msg: 'Sipariş alıyor' };
  }
  const T = {
    store() {
      const st = S.draft.store; const s = storeStatus();
      const seg = (v, ic, t, d) => `<button class="${st.mode === v ? 'on' : ''}" data-act="mode" data-v="${v}"><span class="ic">${ic}</span><b>${t}</b><span>${d}</span></button>`;
      return `<div class="st-card"><div class="st-row" style="margin-bottom:12px"><div><h3>Sipariş durumu</h3><p class="st-help">"Kapalı" seçiliyken site yeni sipariş ve ödeme kabul etmez.</p></div><span class="st-live ${s.open ? '' : 'closed'}"><i></i>${esc(s.msg)}</span></div>
        <div class="st-seg">${seg('open', '🟢', 'Açık', 'Her zaman sipariş alır')}${seg('auto', '🕘', 'Saatlere göre', 'Çalışma saatinde açık')}${seg('closed', '⛔', 'Kapalı', 'Yoğunluk / tatil')}</div>
        <div class="st-grid" style="margin-top:14px">${fText(['store', 'openTime'], 'Açılış saati', { type: 'time' })}${fText(['store', 'closeTime'], 'Kapanış saati', { type: 'time' })}
        ${fText(['store', 'closedMessage'], 'Kapalıyken gösterilecek mesaj', { full: true, max: 200 })}</div></div>
        <div class="st-card"><h3>Mağaza bilgileri</h3><p class="st-help">Sipariş Ver ekranındaki mağaza kartında görünür.</p><div class="st-grid">
        ${fArea(['store', 'address'], 'Adres', { rows: 2 })}${fText(['store', 'mapsUrl'], 'Google Haritalar bağlantısı', { ph: 'https://maps.google.com/…' })}
        ${fText(['store', 'prepMinutes'], 'Ortalama hazırlık (dk)', { type: 'number' })}${fText(['store', 'deliveryNote'], 'Teslimat notu', { full: true, ph: '750 TL üzeri kurye ücretsiz' })}</div></div>`;
    },
    slides() {
      return `<div class="st-card"><h3>Ana slider</h3><p class="st-help">Anasayfa ve Sipariş Ver ekranının üstünde kayan büyük görseller. Sıralamayı oklarla değiştir, her slaytı müşteriye veya personele özel yapabilirsin.</p>
        ${listEditor('slides', { titleOf: (x) => x.title, subOf: (x) => x.link, thumbOf: (x) => imgThumb(x.image), addLabel: 'Slayt ekle',
          body: (i) => `${fImage(['slides', i, 'image'], 'Görsel (yatay, en az 1200px)')}${fText(['slides', i, 'eyebrow'], 'Üst etiket', { ph: 'Torium AVM · Esenyurt' })}${fText(['slides', i, 'title'], 'Başlık', { max: 90 })}
            ${fText(['slides', i, 'subtitle'], 'Alt metin', { full: true, max: 160 })}${fText(['slides', i, 'ctaText'], 'Buton yazısı', { ph: 'Sipariş Ver' })}${fLink(['slides', i, 'link'], 'Buton bağlantısı')}
            ${fSwatch(['slides', i, 'theme'], 'Renk teması', THEMES)}${fAudience(['slides', i, 'audience'])}` })}</div>`;
    },
    offers() {
      const groups = [...new Set((S.draft.offers || []).map((o) => o.group).filter(Boolean))];
      return `<div class="st-card"><h3>Fırsatlar</h3><p class="st-help">Club sayfasındaki "Fırsatlar" kartları ve anasayfadaki fırsat şeridi. Bitiş tarihi yaklaşınca "Kullanım süresi dolmak üzere" etiketi otomatik çıkar, süresi dolunca kendiliğinden gizlenir.</p>
        <datalist id="st-groups">${groups.map((g) => `<option value="${esc(g)}">`).join('')}</datalist>
        ${listEditor('offers', { titleOf: (x) => x.title, subOf: (x) => ` ${x.group || ''}${x.expiresAt ? ' · ' + new Date(x.expiresAt).toLocaleDateString('tr-TR') + "'e kadar" : ''}`, thumbOf: (x) => imgThumb(x.image), addLabel: 'Fırsat ekle',
          body: (i) => `${fImage(['offers', i, 'image'], 'Görsel')}${fText(['offers', i, 'title'], 'Başlık', { full: true, max: 100 })}${fArea(['offers', i, 'description'], 'Açıklama', { rows: 2 })}
            <div class="st-field"><label>Grup (filtre çipi)</label><input type="text" list="st-groups" data-p="${P(['offers', i, 'group'])}" value="${esc(get(['offers', i, 'group']) || '')}" placeholder="Fırsatlar, Kahve, AVM'ye özel…"/></div>
            ${fText(['offers', i, 'badge'], 'Rozet', { ph: 'HEDİYE, %20, 1+1', max: 20 })}${fLink(['offers', i, 'link'], 'Bağlantı')}${fDate(['offers', i, 'expiresAt'], 'Bitiş tarihi (opsiyonel)')}${fAudience(['offers', i, 'audience'])}` })}</div>`;
    },
    cats() {
      if (!S.cats.length) return '<div class="st-card"><h3>Kategoriler</h3><p class="st-help">Henüz ürün yok. Önce Ürün Yönetimi\'nden ürün ekle.</p></div>';
      return `<div class="st-card"><h3>Kategori kartları</h3><p class="st-help">Sipariş Ver ve Menü ekranlarındaki büyük kartlar. Görsel seçmezsen kategorideki ilk ürünün fotoğrafı kullanılır. Kartların sırası Ürün Yönetimi → kategori sıralamasından gelir.</p>
        <div class="st-catgrid">${S.cats.map((c) => {
          const m = (S.draft.categories || {})[c] || {}; const img = m.image || (S.products.find((p) => (p.subcategory || p.category) === c && p.image) || {}).image;
          const base = ['categories', c];
          return `<div class="st-cat ${m.hidden ? 'off' : ''}"><div class="ph" style="${img ? `background-image:url('${esc(img)}')` : ''}">${m.badge ? `<span class="badge">${esc(m.badge)}</span>` : ''}</div>
            <div class="bd"><div class="st-row"><b style="font-size:15px">${esc(c)}</b><span class="st-toggle" title="Uygulamada göster"><input type="checkbox" data-p="${P([...base, 'hidden'])}" data-invert ${m.hidden ? '' : 'checked'} data-rerender/></span></div>
            <div class="st-img-btns"><label class="st-btn st-btn-line st-btn-sm" style="cursor:pointer">⬆️ Görsel<input type="file" accept=".jpg,.jpeg,.png,.webp" hidden data-upload="${P([...base, 'image'])}"/></label>${m.image ? `<button class="st-btn st-btn-danger st-btn-sm" data-act="clearimg" data-path="${P([...base, 'image'])}">Sıfırla</button>` : ''}</div>
            <div class="st-field"><label>Rozet</label><input type="text" maxlength="16" data-p="${P([...base, 'badge'])}" value="${esc(m.badge || '')}" placeholder="YENİ"/></div>
            <div class="st-img-btns">${['YENİ', '🔥', 'POPÜLER'].map((b) => `<button class="st-btn st-btn-line st-btn-sm" data-act="badge" data-path="${P([...base, 'badge'])}" data-v="${b}">${b}</button>`).join('')}</div></div></div>`;
        }).join('')}</div></div>`;
    },
    rails() {
      return `<div class="st-card"><h3>Ürün rafları</h3><p class="st-help">Anasayfada yana kayan ürün şeritleri (Cazip Teklifler, En Sevilenler gibi). Ürün seçmezsen otomatik doldurulur.</p>
        ${listEditor('rails', { titleOf: (x) => x.title, subOf: (x) => ` ${x.productIds.length ? x.productIds.length + ' ürün' : 'otomatik'}`, addLabel: 'Raf ekle',
          body: (i, r) => {
            const q = (S.pickerQ[i] || '').toLocaleLowerCase('tr');
            const picked = r.productIds.map((id) => S.products.find((p) => p.id === id)).filter(Boolean);
            const pool = S.products.filter((p) => !r.productIds.includes(p.id) && (!q || p.name.toLocaleLowerCase('tr').includes(q)));
            return `${fText(['rails', i, 'title'], 'Raf başlığı', { max: 60 })}${fText(['rails', i, 'subtitle'], 'Alt başlık', { max: 120 })}${fAudience(['rails', i, 'audience'])}
              <div class="st-field full"><label>Seçili ürünler (${picked.length})</label><div class="st-picked">${picked.map((p, j) => `<div class="pk"><div class="st-thumb">${imgThumb(p.image)}</div><b>${esc(p.name)}</b>
                <button class="st-icon" data-act="pup" data-i="${i}" data-j="${j}" ${j === 0 ? 'disabled' : ''}>▲</button><button class="st-icon" data-act="pdown" data-i="${i}" data-j="${j}" ${j === picked.length - 1 ? 'disabled' : ''}>▼</button><button class="st-icon" data-act="prem" data-i="${i}" data-j="${j}">✕</button></div>`).join('') || '<span class="st-help">Otomatik: menüden ürünler gösterilir.</span>'}</div>
                <input class="st-input" type="search" placeholder="Ürün ara ve ekle…" data-pickq="${i}" value="${esc(S.pickerQ[i] || '')}"/>
                <div class="st-picker">${pool.slice(0, 60).map((p) => `<button data-act="padd" data-i="${i}" data-id="${esc(p.id)}"><span class="st-thumb">${imgThumb(p.image)}</span>${esc(p.name)}<small>${esc(p.subcategory || p.category)}</small></button>`).join('') || '<div class="st-help" style="padding:8px">Eşleşen ürün yok</div>'}</div></div>`;
          } })}</div>`;
    },
    brand() {
      return `<div class="st-card"><h3>Marka</h3><div class="st-grid">${fText(['brand', 'name'], 'Marka adı', { max: 60 })}${fText(['brand', 'tagline'], 'Anasayfa ana başlığı', { max: 120 })}</div></div>
        <div class="st-card"><h3>Brokers Club</h3><p class="st-help">Club sayfasının üst kısmı ve anasayfadaki üyelik kartı. Ödüller ve puanlar "Sadakat Programı" bölümünden yönetilir.</p><div class="st-grid">
          ${fText(['club', 'title'], 'Program adı', { max: 40 })}${fText(['club', 'headline'], 'Büyük başlık', { max: 80 })}${fArea(['club', 'text'], 'Açıklama')}</div></div>
        <div class="st-card"><h3>Hikayemiz / Hakkımızda</h3><div class="st-grid">${fImage(['about', 'image'], 'Görsel')}${fText(['about', 'title'], 'Başlık', { full: true, max: 80 })}${fArea(['about', 'text'], 'Metin', { rows: 5 })}</div></div>`;
    },
    contact() {
      return `<div class="st-card"><h3>İletişim</h3><p class="st-help">Sayfa altındaki büyük telefon numarası, WhatsApp butonu ve sosyal medya ikonları. Boş bıraktığın sosyal hesap gösterilmez.</p><div class="st-grid">
        ${fText(['contact', 'phone'], 'Telefon', { ph: '0532 642 47 38' })}${fText(['contact', 'whatsapp'], 'WhatsApp numarası', { ph: '905326424738', help: 'Ülke koduyla, boşluksuz' })}
        ${fText(['contact', 'email'], 'E-posta')}${fText(['contact', 'instagram'], 'Instagram', { ph: 'https://instagram.com/…' })}
        ${fText(['contact', 'facebook'], 'Facebook', { ph: 'https://facebook.com/…' })}${fText(['contact', 'tiktok'], 'TikTok', { ph: 'https://tiktok.com/@…' })}
        ${fText(['contact', 'youtube'], 'YouTube', { ph: 'https://youtube.com/@…' })}${fText(['contact', 'x'], 'X (Twitter)', { ph: 'https://x.com/…' })}</div></div>`;
    },
    faq() {
      return `<div class="st-card"><h3>Sık sorulan sorular</h3><p class="st-help">Diğer → Yardım ve Destek ekranında gösterilir.</p>
        ${listEditor('faq', { titleOf: (x) => x.q, noActive: true, addLabel: 'Soru ekle', body: (i) => `${fText(['faq', i, 'q'], 'Soru', { full: true, max: 160 })}${fArea(['faq', i, 'a'], 'Cevap', { rows: 3 })}` })}</div>`;
    },
    guide() { return guideHtml(); },
    layout() {
      const row = (page, i, it, n) => {
        const m = SECTION_META[it.key] || { ic: '▫️', t: it.key, d: '' };
        return `<div class="st-item ${it.on ? '' : 'off'}"><div class="st-item-head" style="cursor:default">
          <div class="st-thumb" style="font-size:22px">${m.ic}</div>
          <div class="st-item-title"><b>${esc(m.t)}</b><small>${esc(m.d)}</small></div>
          <div class="st-item-acts">
            ${m.tab ? `<button class="st-btn st-btn-line st-btn-sm" data-act="tab" data-v="${m.tab}">İçerik ✏️</button>` : ''}
            <span class="st-toggle" title="Göster/Gizle"><input type="checkbox" data-p="${P(['layout', page, i, 'on'])}" ${it.on ? 'checked' : ''} data-rerender/></span>
            <button class="st-icon" data-act="lmove" data-page="${page}" data-i="${i}" data-d="-1" ${i === 0 ? 'disabled' : ''}>▲</button>
            <button class="st-icon" data-act="lmove" data-page="${page}" data-i="${i}" data-d="1" ${i === n - 1 ? 'disabled' : ''}>▼</button>
          </div></div></div>`;
      };
      const block = (page, title, help) => {
        const list = S.draft.layout[page];
        return `<div class="st-card"><div class="st-row" style="margin-bottom:10px"><div><h3>${title}</h3><p class="st-help">${help}</p></div>
          <button class="st-btn st-btn-line st-btn-sm" data-act="page" data-v="${page === 'home' ? '/' : '/siparis.html'}">Önizle 👉</button></div>
          ${list.map((it, i) => row(page, i, it, list.length)).join('')}</div>`;
      };
      return `${block('home', 'Anasayfa bölümleri', 'Bölümleri oklarla sırala, anahtarla gizle/göster. Gizlenen bölümün içeriği silinmez, sadece görünmez.')}
        ${block('siparis', 'Sipariş Ver bölümleri', 'Sipariş Ver ekranındaki bölümlerin sırası ve görünürlüğü.')}
        <div class="st-card"><h3>Hızlı erişim kutuları</h3><p class="st-help">Anasayfadaki küçük kısayol kutuları (en fazla 8). Emoji ikon, yazı ve bağlantı seç.</p>
          ${listEditor('quick', { titleOf: (x) => x.label, subOf: (x) => ' ' + (x.link || ''), thumbOf: (x) => `<span style="font-size:24px">${esc(x.icon || '☕')}</span>`, addLabel: 'Kutu ekle',
            body: (i) => `${fText(['quick', i, 'icon'], 'İkon (emoji)', { ph: '☕', max: 8, help: 'Telefon klavyesindeki emoji: ☕ 🥐 🎁 ⭐ 🛵 🔥 🍰 🧋' })}${fText(['quick', i, 'label'], 'Yazı', { max: 24 })}${fLink(['quick', i, 'link'], 'Bağlantı')}` })}</div>
        <div class="st-card"><h3>"Diğer" menüsüne bağlantı ekle</h3><p class="st-help">Örn: Google yorum sayfanız, Instagram, rezervasyon formu, menü PDF'i. Sayfalar sekmesinde oluşturduğun sayfalar da otomatik bu menüye eklenir.</p>
          ${listEditor('moreLinks', { titleOf: (x) => x.title, subOf: (x) => ' ' + (x.link || ''), thumbOf: (x) => `<span style="font-size:24px">${esc(x.icon || '🔗')}</span>`, addLabel: 'Bağlantı ekle',
            body: (i) => `${fText(['moreLinks', i, 'icon'], 'İkon (emoji)', { ph: '🔗', max: 8 })}${fText(['moreLinks', i, 'title'], 'Başlık', { max: 50 })}${fLink(['moreLinks', i, 'link'], 'Bağlantı (site içi veya https://…)')}` })}</div>`;
    },
    pages() {
      return `<div class="st-card"><h3>Bilgi sayfaları</h3><p class="st-help">Kendi sayfanı oluştur: Şubelerimiz, Kariyer, Etkinlikler, Kampanya detayı, Alerjen bilgisi… "Diğer" menüsünde görünür, adresini slider/fırsat butonlarına da bağlayabilirsin.
        <br/>Yazım: boş satır = yeni paragraf · <b>## Başlık</b> = ara başlık · <b>- madde</b> = liste · https://… = bağlantı</p>
        ${listEditor('pages', { titleOf: (x) => x.title, subOf: (x) => ` /sayfa.html?s=${x.slug}${x.inMore === false ? ' · menüde gizli' : ''}`, thumbOf: (x) => (x.image ? imgThumb(x.image) : `<span style="font-size:24px">${esc(x.icon || '📄')}</span>`), addLabel: 'Sayfa oluştur',
          body: (i, pg) => `${fText(['pages', i, 'title'], 'Sayfa başlığı', { max: 80 })}${fText(['pages', i, 'icon'], 'İkon (emoji)', { ph: '📄', max: 8 })}
            ${fText(['pages', i, 'subtitle'], 'Kısa açıklama', { full: true, max: 160 })}${fImage(['pages', i, 'image'], 'Kapak görseli (opsiyonel, yatay)')}
            ${fArea(['pages', i, 'body'], 'İçerik', { rows: 10, ph: 'İlk paragraf…\n\n## Ara başlık\n- madde 1\n- madde 2' })}
            ${fText(['pages', i, 'slug'], 'Sayfa adresi', { help: 'brokerscoffee.com.tr/sayfa.html?s=<b>' + esc(pg.slug) + '</b> — küçük harf, tire' })}
            ${fToggle(['pages', i, 'inMore'], '"Diğer" menüsünde göster')}
            <div class="full"><button class="st-btn st-btn-gold st-btn-sm" data-act="pagepreview" data-i="${i}">📱 Telefonda önizle</button></div>` })}</div>`;
    },
    announce() {
      return `<div class="st-card"><h3>Duyuru bandı</h3><p class="st-help">Tüm uygulama sayfalarının en üstünde ince bir bant. Örn: "Bugün tüm soğuk kahvelerde %20 indirim!"</p><div class="st-grid">
        ${fToggle(['announcement', 'active'], 'Duyuruyu göster')}${fText(['announcement', 'text'], 'Duyuru metni', { full: true, max: 200 })}
        ${fSwatch(['announcement', 'tone'], 'Renk', TONES)}${fAudience(['announcement', 'audience'])}</div></div>`;
    },
  };

  // ---------- Çizim ----------
  function render() {
    const dirty = isDirty();
    root.innerHTML = `
      <div class="st-hero"><div><h2>📱 Uygulama Stüdyosu <span class="st-spark">✨</span></h2><p>Müşterinin telefonda gördüğü her şeyi buradan düzenle — değişiklikler sağdaki telefonda anında görünür.</p></div>
        <div class="st-hero-acts"><span class="st-dirty ${dirty ? 'on' : ''}"><i></i>Yayınlanmamış değişiklikler</span>
          <button class="st-btn st-btn-ghost" data-act="revert" ${dirty ? '' : 'disabled'}>Geri al</button>
          <button class="st-btn st-btn-gold" data-act="save" ${dirty ? '' : 'disabled'}>🚀 Yayınla</button></div></div>
      <div class="st-layout">
        <div><div class="st-tabs" role="tablist">${TABS.map(([k, ic, t]) => `<button class="st-tab ${S.tab === k ? 'on' : ''}" data-act="tab" data-v="${k}" role="tab">${ic} ${t}</button>`).join('')}</div>
          <div id="st-editor">${T[S.tab]()}</div></div>
        <div class="st-phone-col">
          <div class="st-aud">${[['customer', '👤 Müşteri gözüyle'], ['staff', '👔 Personel gözüyle']].map(([v, t]) => `<button class="${S.audience === v ? 'on' : ''}" data-act="aud" data-v="${v}">${t}</button>`).join('')}</div>
          <div class="st-phone-bar">${PAGES.map(([u, t]) => `<button class="${S.page.split('#')[0] === u ? 'on' : ''}" data-act="page" data-v="${u}">${t}</button>`).join('')}</div>
          <div class="st-phone"><div class="st-screen"><iframe id="st-frame" title="Uygulama önizlemesi" src="${esc(withPreview(S.page))}"></iframe></div></div>
          <div class="st-phone-foot">Canlı önizleme · yayınlamadan müşteriler görmez</div>
        </div></div>`;
  }
  function withPreview(u) { const [path, hash] = u.split('#'); return path + (path.includes('?') ? '&' : '?') + 'preview=1' + (hash ? '#' + hash : ''); }
  function renderEditor() {
    const ed = root.querySelector('#st-editor'); if (!ed) return;
    const y = window.scrollY; ed.innerHTML = T[S.tab](); window.scrollTo(0, y);
    updateDirty();
  }
  function isDirty() { return S.saved && JSON.stringify(S.saved) !== JSON.stringify(S.draft); }
  function updateDirty() {
    const d = isDirty();
    root.querySelector('.st-dirty').classList.toggle('on', !!d);
    root.querySelectorAll('[data-act="save"],[data-act="revert"]').forEach((b) => (b.disabled = !d));
  }

  // ---------- Canlı önizleme ----------
  let postT;
  function postPreview() {
    clearTimeout(postT);
    postT = setTimeout(() => {
      const f = root.querySelector('#st-frame');
      if (f && f.contentWindow) f.contentWindow.postMessage({ type: 'bc-preview', config: S.draft, audience: S.audience }, location.origin);
    }, 180);
  }
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data || e.data.type !== 'bc-preview-ready') return;
    postPreview();
  });
  function goPage(u) {
    S.page = u;
    const f = root.querySelector('#st-frame'); if (f) f.src = withPreview(u);
    root.querySelectorAll('.st-phone-bar button').forEach((b) => b.classList.toggle('on', b.dataset.v === u.split('#')[0]));
  }

  // ---------- Etkileşim ----------
  function onInput(e) {
    const el = e.target;
    if (el.dataset.pickq !== undefined) { S.pickerQ[el.dataset.pickq] = el.value; const pos = el.selectionStart; renderEditor(); const n = root.querySelector(`[data-pickq="${el.dataset.pickq}"]`); if (n) { n.focus(); n.setSelectionRange(pos, pos); } return; }
    if (el.dataset.linkfor) { if (!el.value) return; const p = JSON.parse(el.dataset.linkfor); set(p, el.value); const inp = root.querySelector(`[data-p='${CSS.escape(el.dataset.linkfor)}']`) || [...root.querySelectorAll('[data-p]')].find((x) => x.dataset.p === el.dataset.linkfor); if (inp) inp.value = el.value; el.value = ''; changed(); return; }
    if (!el.dataset.p) return;
    const p = JSON.parse(el.dataset.p);
    let v;
    if (el.type === 'checkbox') v = el.dataset.invert !== undefined ? !el.checked : el.checked;
    else if (el.type === 'number') v = el.value === '' ? 0 : Number(el.value);
    else if (el.dataset.date !== undefined) v = el.value ? new Date(el.value + 'T23:59:00').toISOString() : null;
    else v = el.value;
    set(p, v);
    // Başlık değişince liste satırındaki başlığı da güncelle
    if (p.length === 3 && typeof p[1] === 'number') { const h = root.querySelector(`[data-head="${p[0]}:${p[1]}"]`); if (h && ['title', 'q'].includes(p[2])) h.textContent = v || 'Başlıksız'; }
    if (p[p.length - 1] === 'image') { const th = [...root.querySelectorAll('[data-thumb]')].find((x) => x.dataset.thumb === el.dataset.p); if (th) th.innerHTML = v ? `<img src="${esc(v)}" alt=""/>` : '🖼️'; }
    if (el.dataset.rerender !== undefined || (p[0] === 'store' && ['openTime', 'closeTime'].includes(p[1]))) renderEditorKeepFocus(el);
    changed();
  }
  function renderEditorKeepFocus(el) { const sel = el.dataset.p; renderEditor(); if (el.type !== 'checkbox') { const n = [...root.querySelectorAll('[data-p]')].find((x) => x.dataset.p === sel); if (n) n.focus(); } }
  function changed() { updateDirty(); postPreview(); }

  async function onClick(e) {
    const b = e.target.closest('[data-act]'); if (!b || !root.contains(b)) return;
    if (e.target.closest('.st-toggle') && b.dataset.act === 'open') return; // aktif anahtarına basınca satırı açma
    const a = b.dataset.act; const key = b.dataset.key; const i = Number(b.dataset.i);
    const list = key ? S.draft[key] : null;
    switch (a) {
      case 'tab': S.tab = b.dataset.v; S.open = null; root.querySelectorAll('.st-tab').forEach((t) => t.classList.toggle('on', t.dataset.v === S.tab)); renderEditor(); if (TAB_PAGE[S.tab] && TAB_PAGE[S.tab] !== S.page) goPage(TAB_PAGE[S.tab]); return;
      case 'page': goPage(b.dataset.v); return;
      case 'aud': S.audience = b.dataset.v; root.querySelectorAll('.st-aud button').forEach((x) => x.classList.toggle('on', x.dataset.v === S.audience)); postPreview(); return;
      case 'open': S.open = S.open === b.dataset.id ? null : b.dataset.id; renderEditor(); return;
      case 'add': list.push(NEW[key]()); S.open = key + ':' + (list.length - 1); break;
      case 'del': if (!confirm('Silinsin mi?')) return; list.splice(i, 1); S.open = null; break;
      case 'up': if (i > 0) { [list[i - 1], list[i]] = [list[i], list[i - 1]]; S.open = null; } break;
      case 'down': if (i < list.length - 1) { [list[i + 1], list[i]] = [list[i], list[i + 1]]; S.open = null; } break;
      case 'mode': S.draft.store.mode = b.dataset.v; break;
      case 'pagepreview': { const pg = S.draft.pages[i]; pg.slug = slugify(pg.slug || pg.title); const inp = [...root.querySelectorAll('[data-p]')].find((x) => x.dataset.p === JSON.stringify(['pages', i, 'slug'])); if (inp) inp.value = pg.slug; changed(); goPage('/sayfa.html?s=' + encodeURIComponent(pg.slug)); return; }
      case 'lmove': { const l = S.draft.layout[b.dataset.page]; const d = Number(b.dataset.d); const j = i + d; if (l[j]) [l[i], l[j]] = [l[j], l[i]]; break; }
      case 'goto': { const btn = document.querySelector(`.sidebar-link[data-section="${b.dataset.v}"]`); if (btn) { btn.click(); window.scrollTo({ top: 0, behavior: 'smooth' }); } return; }
      case 'swatch': set(JSON.parse(b.dataset.path), b.dataset.v); break;
      case 'badge': { const p = JSON.parse(b.dataset.path); set(p, get(p) === b.dataset.v ? '' : b.dataset.v); break; }
      case 'clearimg': set(JSON.parse(b.dataset.path), ''); break;
      case 'padd': S.draft.rails[i].productIds.push(b.dataset.id); break;
      case 'prem': S.draft.rails[i].productIds.splice(Number(b.dataset.j), 1); break;
      case 'pup': case 'pdown': { const ids = S.draft.rails[i].productIds; const j = Number(b.dataset.j); const k = a === 'pup' ? j - 1 : j + 1; if (ids[k] !== undefined) [ids[j], ids[k]] = [ids[k], ids[j]]; break; }
      case 'revert': if (!confirm('Yayınlanmamış tüm değişiklikler geri alınsın mı?')) return; S.draft = clone(S.saved); S.open = null; break;
      case 'save': await save(b); return;
      default: return;
    }
    renderEditor(); changed();
  }

  async function onUpload(e) {
    const el = e.target; if (!el.dataset.upload || !el.files[0]) return;
    const fd = new FormData(); fd.append('image', el.files[0]);
    const label = el.closest('label'); const old = label.firstChild.textContent; label.firstChild.textContent = '⏳ Yükleniyor…';
    try {
      const d = await api('/api/app-config/admin/upload', { method: 'POST', body: fd });
      set(JSON.parse(el.dataset.upload), d.url);
      renderEditor(); changed(); toast('Görsel yüklendi ✓');
    } catch (err) { toast('⚠️ ' + err.message); label.firstChild.textContent = old; }
  }

  async function save(btn) {
    btn.disabled = true; btn.textContent = 'Yayınlanıyor…';
    try {
      const d = await api('/api/app-config/admin', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(S.draft) });
      S.saved = d.config; S.draft = clone(d.config); S.ordering = d.ordering;
      render(); postPreview(); toast('🚀 Yayınlandı! Müşteriler yeni hali görüyor.'); confetti();
    } catch (err) { toast('⚠️ ' + err.message); btn.disabled = false; btn.textContent = '🚀 Yayınla'; }
  }

  let toastEl; let toastT;
  function toast(m) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'st-toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = m; toastEl.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }
  function confetti() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const colors = ['#f5c542', '#0d1b3d', '#16a34a', '#e3262f', '#fff4d6'];
    for (let n = 0; n < 60; n++) {
      const c = document.createElement('i'); c.className = 'st-confetti';
      c.style.left = Math.random() * 100 + 'vw'; c.style.background = colors[n % colors.length];
      c.style.animationDelay = Math.random() * .4 + 's'; c.style.animationDuration = 1.2 + Math.random() * .9 + 's';
      document.body.appendChild(c); setTimeout(() => c.remove(), 2600);
    }
  }

  window.addEventListener('beforeunload', (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });

  window.loadStudio = async function () {
    root = document.getElementById('section-studio'); if (!root) return;
    root.innerHTML = '<p style="color:#827472">Stüdyo yükleniyor…</p>';
    try {
      const [cfg, products] = await Promise.all([api('/api/app-config/admin'), api('/api/admin/products').catch(() => [])]);
      S.saved = cfg.config; S.draft = clone(cfg.config); S.ordering = cfg.ordering;
      S.products = Array.isArray(products) ? products : [];
      S.cats = [...new Set(S.products.map((p) => p.subcategory || p.category).filter(Boolean))];
      const order = await api('/api/admin/settings').then((s) => s.categoryOrder || []).catch(() => []);
      S.cats.sort((a, b) => { const ia = order.indexOf(a); const ib = order.indexOf(b); return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib); });
      render();
      root.addEventListener('input', onInput);
      root.addEventListener('change', (e) => { if (e.target.dataset.upload) onUpload(e); });
      root.addEventListener('click', onClick);
    } catch (err) {
      root.innerHTML = `<p style="color:#b42318">Stüdyo yüklenemedi: ${esc(err.message)}</p>`;
    }
  };
})();
