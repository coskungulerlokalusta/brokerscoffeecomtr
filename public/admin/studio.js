// Yönetim paneli — Uygulama Stüdyosu: müşteri uygulamasının içeriğini düzenler,
// değişiklikleri kaydetmeden önce telefon önizlemesinde canlı gösterir.
(function () {
  const S = { saved: null, draft: null, ordering: null, products: [], cats: [], tab: 'store', page: '/', audience: 'customer', open: null, pickerQ: {} };
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
    ['store', '🏪', 'Mağaza'], ['slides', '🎞️', 'Slider'], ['offers', '🎁', 'Fırsatlar'], ['cats', '🗂️', 'Kategoriler'],
    ['rails', '⭐', 'Raflar'], ['brand', '💛', 'Club & Hikaye'], ['contact', '📞', 'İletişim'], ['faq', '❓', 'SSS'], ['announce', '📢', 'Duyuru'],
  ];
  const PAGES = [['/', 'Anasayfa'], ['/siparis.html', 'Sipariş Ver'], ['/menu.html', 'Menü'], ['/club.html', 'Club'], ['/diger.html', 'Diğer']];
  const TAB_PAGE = { store: '/siparis.html', slides: '/', offers: '/club.html#firsatlar', cats: '/siparis.html', rails: '/', brand: '/club.html', contact: '/diger.html', faq: '/diger.html', announce: '/' };
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
  };
  const imgThumb = (u) => (u ? `<img src="${esc(u)}" alt="" onerror="this.remove()"/>` : '🖼️');

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
