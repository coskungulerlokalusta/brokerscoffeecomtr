// Brokers Coffee — uygulama kabuğu: alt menü, sepet balonu, ortak veri yükleme,
// ikonlar ve yönetim panelindeki canlı önizleme. cart.js'ten SONRA yüklenmeli.
(function () {
  const BC = (window.BC = window.BC || {});
  const FALLBACK_IMG = 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?q=80&w=800&auto=format&fit=crop';
  BC.FALLBACK_IMG = FALLBACK_IMG;

  // ---------- İkonlar ----------
  const s = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
  const I = {
    home: s('<path class="fill-on" d="M5 10h12v5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5v-5Z"/><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H17"/><path class="stroke-on" d="M8.5 3.5c-.8 1 .8 2-.1 3M12 3c-.8 1 .8 2-.1 3M15.4 3.5c-.8 1 .8 2-.1 3"/>'),
    club: s('<path d="M3 20V12a9 9 0 0 1 18 0v8"/><path class="stroke-on" d="M7 20v-7a5 5 0 0 1 10 0v7"/><path d="M2 20h20"/><path class="fill-on stroke-on" d="m12 9.2.9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2L9.1 11.3l2-.3.9-1.8Z" stroke-width="1.2"/>'),
    order: s('<path class="fill-on" d="M3 6h7v6H3z"/><path d="M3 12h9l2-5h3"/><circle cx="6" cy="17.5" r="2.5"/><circle cx="18" cy="17.5" r="2.5"/><path d="M8.5 17.5h7M15 7l3 8"/><path class="stroke-on" d="M17 4.5h3"/>'),
    menu: s('<path class="fill-on" d="M4 9h9l-1.2 11H5.2L4 9Z"/><path d="M3 9h11M8.5 9V3.5"/><path class="stroke-on" d="M15 13h6l-.8 7h-4.4L15 13Z"/><path d="M18 13v-3l1.5-1.5"/>'),
    more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="fill-on" cx="5" cy="12" r="2" fill="currentColor"/><circle class="fill-on" cx="12" cy="12" r="2" fill="currentColor"/><circle class="fill-on" cx="19" cy="12" r="2" fill="currentColor"/></svg>',
    chev: s('<path d="m9 5 7 7-7 7"/>'),
    back: s('<path d="M15 5 8 12l7 7"/>'),
    arrow: s('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    plus: s('<path d="M12 5v14M5 12h14" stroke-width="2.4"/>'),
    check: s('<path d="m5 12 5 5 9-10" stroke-width="2.4"/>'),
    user: s('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
    info: s('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>'),
    mail: s('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
    doc: s('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4"/><path d="M14 3v5h5M9 9h3M9 13h6M9 17h2"/><circle cx="17" cy="17" r="4"/><path d="m15.5 17 1 1 2-2"/>'),
    help: s('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.3M12 17v.01"/>'),
    shield: s('<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>'),
    pin: s('<path class="fill-on" d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z" fill="#f5c542" stroke="#d9a927"/><circle cx="12" cy="9.5" r="2.5" fill="#fff" stroke="#d9a927"/>'),
    phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2Z"/></svg>',
    clock: s('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    bag: s('<path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>'),
    search: s('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
    gift: s('<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12M12 8c-2-3-6-3-5 0M12 8c2-3 6-3 5 0"/>'),
    star: s('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z"/>'),
    store: s('<path d="M4 9 5.5 4h13L20 9M4 9v11h16V9M4 9h16M9 20v-6h6v6"/>'),
    receipt: s('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6M9 16h3"/>'),
    blog: s('<path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h8M8 17h5"/>'),
    logout: s('<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>'),
    spark: s('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>'),
    whatsapp: '<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="#fff" d="M16 3C9.4 3 4 8.4 4 15c0 2.4.7 4.6 1.9 6.5L4 29l7.7-1.8A12 12 0 0 0 16 27c6.6 0 12-5.4 12-12S22.6 3 16 3zm7 16.9c-.3.8-1.5 1.5-2.4 1.7-.6.1-1.5.2-4.2-.9-3.6-1.5-5.8-5.1-6-5.3-.2-.2-1.4-1.9-1.4-3.7 0-1.7.9-2.6 1.2-3 .3-.3.7-.4.9-.4h.7c.2 0 .5-.1.8.6.3.7 1 2.4 1.1 2.6.1.2.1.4 0 .6-.1.2-.2.4-.4.6l-.5.6c-.2.2-.4.4-.2.7.2.4.9 1.5 2 2.4 1.4 1.2 2.5 1.6 2.8 1.8.4.2.6.1.8-.1.2-.2.9-1 1.1-1.4.2-.4.5-.3.8-.2.3.1 2 1 2.4 1.1.4.2.6.3.7.4.1.1.1.9-.2 1.7z"/></svg>',
    instagram: s('<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5v.01"/>'),
    facebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13.5 21v-7.5h2.5l.4-3h-2.9V8.6c0-.9.3-1.5 1.5-1.5h1.5V4.4c-.3 0-1.2-.1-2.2-.1-2.2 0-3.7 1.3-3.7 3.8v2.4H8v3h2.6V21h2.9Z"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.8 3h3l-6.6 7.6L22 21h-6.1l-4.8-6.3L5.6 21h-3l7.1-8.1L2.3 3h6.2l4.3 5.8L17.8 3Zm-1 16.2h1.7L7.4 4.7H5.6l11.2 14.5Z"/></svg>',
    youtube: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4a2.5 2.5 0 0 0-1.8 1.8C2 8.8 2 12 2 12s0 3.2.4 4.8a2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8c.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8ZM10 15V9l5.2 3L10 15Z"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.6 3c.3 2.2 1.7 3.8 3.9 4v3a7 7 0 0 1-3.9-1.3v6.1A5.8 5.8 0 1 1 10.8 9v3.1a2.8 2.8 0 1 0 2 2.7V3h3.8Z"/></svg>',
  };
  BC.icons = I;

  // ---------- Yardımcılar ----------
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  BC.esc = esc;
  BC.money = (n) => '₺' + Number(n || 0).toLocaleString('tr-TR', { maximumFractionDigits: 2 });
  BC.eff = (size) => (size && size.effectivePrice !== undefined ? size.effectivePrice : size ? size.price : 0);
  BC.qs = (k) => new URLSearchParams(location.search).get(k);
  BC.isPreview = BC.qs('preview') === '1';

  BC.img = (url) => esc(url || FALLBACK_IMG);
  BC.imgTag = (url, alt, cls = '') => `<img class="${cls}" src="${BC.img(url)}" alt="${esc(alt || '')}" loading="lazy" onerror="this.onerror=null;this.src='${FALLBACK_IMG}'"/>`;

  // Fiyat etiketi — personel indirimli fiyat varsa üstü çizili gösterir
  BC.priceHtml = (p) => {
    if (!p || !p.sizes || !p.sizes.length) return '';
    const effs = p.sizes.map(BC.eff);
    const min = Math.min(...effs);
    const minSize = p.sizes[effs.indexOf(min)];
    const disc = min < minSize.price;
    const max = Math.max(...effs);
    const range = max > min ? ` – ${BC.money(max)}` : '';
    return `<span class="bc-price ${disc ? 'disc' : ''}">${disc && !range ? `<s>${BC.money(minSize.price)}</s>` : ''}${BC.money(min)}${range}</span>`;
  };

  async function getJSON(url) {
    const r = await fetch(url, { credentials: 'same-origin' });
    if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
    return r.json();
  }
  BC.getJSON = getJSON;

  // ---------- Durum ----------
  BC.state = { config: null, products: null, categories: null, me: null, settings: null, content: null };
  const listeners = [];
  BC.onChange = (fn) => listeners.push(fn);
  BC.emit = () => listeners.forEach((fn) => { try { fn(BC.state); } catch (e) { console.error(e); } });

  // İhtiyaç duyulan verileri paralel yükler. need: ['products','categories','me','settings','content']
  BC.load = async (need = []) => {
    const jobs = [getJSON('/api/app-config').then((c) => (BC.state.config = BC._previewCfg || c)).catch(() => (BC.state.config = BC.state.config || fallbackConfig()))];
    if (need.includes('products')) jobs.push(getJSON('/api/products').then((d) => (BC.state.products = d)).catch(() => (BC.state.products = [])));
    if (need.includes('categories')) jobs.push(getJSON('/api/categories').then((d) => (BC.state.categories = d)).catch(() => (BC.state.categories = [])));
    if (need.includes('me')) jobs.push(getJSON('/api/account/me').then((d) => (BC.state.me = d)).catch(() => (BC.state.me = null)));
    if (need.includes('settings')) jobs.push(getJSON('/api/settings/public').then((d) => (BC.state.settings = d)).catch(() => (BC.state.settings = null)));
    if (need.includes('content')) jobs.push(getJSON('/api/site-content').then((d) => (BC.state.content = d)).catch(() => (BC.state.content = {})));
    await Promise.all(jobs);
    BC._loaded = true;
    applyBrand();
    return BC.state;
  };

  function fallbackConfig() {
    return { brand: { name: 'Brokers Coffee' }, store: {}, slides: [], offers: [], categories: {}, rails: [], club: {}, about: {}, contact: {}, faq: [], announcement: {}, ordering: { open: true } };
  }

  // Kategori kartı görseli: panelden seçilen görsel, yoksa kategorideki ilk ürünün fotoğrafı
  BC.categoryMeta = (name) => {
    const cfg = (BC.state.config && BC.state.config.categories) || {};
    const meta = cfg[name] || {};
    let image = meta.image;
    if (!image && BC.state.products) {
      const p = BC.state.products.find((x) => (x.subcategory || x.category) === name && x.image);
      image = p && p.image;
    }
    return { image: image || FALLBACK_IMG, badge: meta.badge || '', hidden: !!meta.hidden };
  };
  // Panelde gizlenen kategoriler ve bu kişinin (müşteri/personel) görebildiği ürünü olmayan kategoriler çıkarılır
  BC.visibleCategories = () => (BC.state.categories || []).filter((c) => !BC.categoryMeta(c).hidden && (!BC.state.products || BC.productsIn(c).length > 0));
  BC.productsIn = (cat) => (BC.state.products || []).filter((p) => (p.subcategory || p.category) === cat);

  // Rafın ürünleri: panelde seçilenler, yoksa site içeriğindeki "Öne Çıkanlar", o da yoksa ilk ürünler
  BC.railProducts = (rail, index = 0) => {
    const all = BC.state.products || [];
    let ids = rail.productIds || [];
    if (!ids.length && index === 0 && BC.state.content && BC.state.content.featuredProductIds) ids = BC.state.content.featuredProductIds;
    if (ids.length) return ids.map((id) => all.find((p) => p.id === id)).filter(Boolean);
    const start = (index * 6) % Math.max(all.length, 1);
    return all.slice(start, start + 8).concat(start + 8 > all.length ? all.slice(0, Math.max(0, start + 8 - all.length)) : []).slice(0, 8);
  };

  // ---------- Sepet ----------
  BC.needsDetail = (p) => {
    if (!p) return true;
    if (p.sizes && p.sizes.length > 1) return true;
    if ((p.name || '').toLocaleLowerCase('tr').includes('türk kahvesi')) return true; // şeker seçimi zorunlu
    return false;
  };
  BC.quickAdd = (p, btn) => {
    if (BC.needsDetail(p)) { location.href = '/product.html?id=' + encodeURIComponent(p.id); return; }
    const size = p.sizes[0];
    if (typeof addToCart !== 'function') return;
    addToCart({ productId: p.id, name: p.name, price: size.price, size: size.label || null, extras: [], intensity: 'normal', extraShot: false, note: '', qty: 1 });
    if (btn) {
      btn.classList.add('done'); btn.innerHTML = I.check;
      setTimeout(() => { btn.classList.remove('done'); btn.innerHTML = I.plus; }, 1300);
      const card = btn.closest('[data-pid]');
      const img = card && card.querySelector('img');
      if (img) BC.fly(img);
    }
    BC.toast(`${p.name} sepete eklendi`);
  };
  BC.fly = (img) => {
    const target = document.querySelector('.bc-cartpill.show .cnt') || document.querySelector('.bc-nav a[data-k="order"]');
    if (!target || !img.getBoundingClientRect) return;
    const a = img.getBoundingClientRect(); const b = target.getBoundingClientRect();
    const f = document.createElement('img');
    f.src = img.src; f.className = 'bc-fly';
    f.style.left = a.left + a.width / 2 - 32 + 'px'; f.style.top = a.top + a.height / 2 - 32 + 'px';
    document.body.appendChild(f);
    requestAnimationFrame(() => {
      f.style.transform = `translate(${b.left + b.width / 2 - (a.left + a.width / 2)}px, ${b.top + b.height / 2 - (a.top + a.height / 2)}px) scale(.2)`;
      f.style.opacity = '.3';
    });
    setTimeout(() => f.remove(), 800);
  };

  let toastEl; let toastT;
  BC.toast = (msg) => {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'bc-toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 2200);
  };

  // ---------- Kabuk: alt menü, sepet balonu, WhatsApp ----------
  const TABS = [
    { k: 'home', href: '/', label: 'Anasayfa', icon: 'home' },
    { k: 'club', href: '/club.html', label: 'Club', icon: 'club' },
    { k: 'order', href: '/siparis.html', label: 'Sipariş Ver', icon: 'order' },
    { k: 'menu', href: '/menu.html', label: 'Menü', icon: 'menu' },
    { k: 'more', href: '/diger.html', label: 'Diğer', icon: 'more' },
  ];
  function activeTab() {
    const p = location.pathname.replace(/\/+$/, '') || '/';
    if (p === '/' || p === '/index.html') return 'home';
    if (/\/(club|loyalty)\.html$/.test(p)) return 'club';
    if (/\/(siparis|cart|checkout|payment-result)\.html$/.test(p)) return 'order';
    if (/\/(menu|product)\.html$/.test(p)) return 'menu';
    return 'more';
  }
  BC.activeTab = activeTab;

  function mountShell() {
    if (document.querySelector('.bc-nav')) return;
    const act = activeTab();
    // Eski sayfalardaki eski alt menüyü kaldır, WhatsApp butonunu yeni menünün üstüne taşı
    if (!document.body.classList.contains('bc')) {
      const font = document.createElement('link');
      font.rel = 'stylesheet';
      font.href = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&display=swap';
      document.head.appendChild(font);
      document.querySelectorAll('body > nav').forEach((n) => { if (/\bfixed\b/.test(n.className) && /\bbottom-0\b/.test(n.className)) n.remove(); });
      document.querySelectorAll('a[aria-label="WhatsApp\'tan yaz"]').forEach((a) => { a.style.bottom = 'calc(var(--bc-nav-h) + 26px + env(safe-area-inset-bottom))'; });
    }
    const nav = document.createElement('nav');
    nav.className = 'bc-nav'; nav.setAttribute('aria-label', 'Ana gezinme');
    nav.innerHTML = TABS.map((t) => `<a href="${t.href}${BC.isPreview ? (t.href.includes('?') ? '&' : '?') + 'preview=1' : ''}" data-k="${t.k}" class="${t.k === act ? 'on' : ''}" ${t.k === act ? 'aria-current="page"' : ''}>${I[t.icon]}<span class="lbl">${t.label}</span>${t.k === 'order' ? '<span class="bc-badge" data-bc-count hidden>0</span>' : ''}</a>`).join('');
    document.body.appendChild(nav);
    document.body.classList.add('bc-has-nav');

    const page = location.pathname;
    const noPill = /\/(cart|checkout|payment-result)\.html$/.test(page);
    if (!noPill) {
      const pill = document.createElement('a');
      pill.className = 'bc-cartpill'; pill.href = '/cart.html';
      pill.innerHTML = '<span class="cnt" data-bc-pillcount>0</span><span class="txt" data-bc-pilltxt>Sepetim</span><span class="go">Sepete Git</span>';
      document.body.appendChild(pill);
    }
    if (document.body.classList.contains('bc')) {
      const chat = document.createElement('a');
      chat.className = 'bc-chat'; chat.target = '_blank'; chat.rel = 'noopener'; chat.setAttribute('aria-label', "WhatsApp'tan yaz");
      chat.dataset.bcChat = '';
      chat.href = 'https://wa.me/905326424738?text=' + encodeURIComponent('Merhaba, sipariş vermek istiyorum');
      chat.innerHTML = I.whatsapp;
      document.body.appendChild(chat);
    }
    syncCart();
  }

  let lastCount = null;
  function syncCart() {
    if (typeof getCart !== 'function') return;
    const cart = getCart();
    const count = cart.reduce((a, i) => a + (i.qty || 0), 0);
    const total = cart.reduce((a, i) => a + i.price * i.qty, 0);
    document.querySelectorAll('[data-bc-count]').forEach((b) => { b.textContent = count; b.hidden = count === 0; });
    const pill = document.querySelector('.bc-cartpill');
    if (pill) {
      pill.querySelector('[data-bc-pillcount]').textContent = count;
      pill.querySelector('[data-bc-pilltxt]').textContent = `${count} ürün · ${BC.money(total)}`;
      pill.classList.toggle('show', count > 0);
      document.body.classList.toggle('bc-cart-open', count > 0);
      if (lastCount !== null && count > lastCount) { pill.classList.remove('bump'); void pill.offsetWidth; pill.classList.add('bump'); }
    }
    lastCount = count;
  }
  BC.syncCart = syncCart;
  if (typeof saveCart === 'function') {
    const orig = saveCart;
    window.saveCart = saveCart = function (cart) { orig(cart); syncCart(); }; // eslint-disable-line no-global-assign
  }
  window.addEventListener('storage', syncCart);

  function applyBrand() {
    const c = BC.state.config; if (!c) return;
    const wa = c.contact && c.contact.whatsapp;
    const chat = document.querySelector('[data-bc-chat]');
    if (chat && wa) chat.href = `https://wa.me/${wa}?text=${encodeURIComponent('Merhaba, sipariş vermek istiyorum')}`;
    if (chat && c.contact && !wa) chat.hidden = true;
  }

  // ---------- Ortak parçalar ----------
  BC.topbar = ({ title, back } = {}) => {
    const me = BC.state.me;
    const logo = BC.state.content && BC.state.content.logo;
    const left = back
      ? `<a class="bc-back" href="${esc(back)}">${I.back}<span>Geri</span></a>`
      : `<a class="bc-brand" href="/"><span class="bc-brand-mark">${logo ? `<img src="${esc(logo)}" alt=""/>` : 'B'}</span>${title ? `<span class="bc-top-title">${esc(title)}</span>` : `<span class="bc-brand-name">${esc((BC.state.config && BC.state.config.brand && BC.state.config.brand.name) || 'Brokers Coffee')}</span>`}</a>`;
    const mid = title && back ? `<div class="bc-top-title">${esc(title)}</div>` : '';
    const right = me
      ? `<a class="bc-account-btn" href="/account.html"><span class="bc-avatar">${esc(initials(me.name))}</span>${esc((me.name || '').split(' ')[0])}</a>`
      : `<a class="bc-account-btn" href="/login.html"><span class="bc-avatar">${I.user}</span>Giriş</a>`;
    return `<header class="bc-top" data-bc-top><div class="bc-wrap bc-top-in">${left}${mid}${right}</div></header>`;
  };
  function initials(n) { return (n || '?').split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toLocaleUpperCase('tr'); }

  BC.bars = () => {
    const c = BC.state.config || {};
    let h = '';
    if (c.staffBannerText && c.audience === 'staff') h += `<div class="bc-staffbar">👔 ${esc(c.staffBannerText)}</div>`;
    const a = c.announcement;
    if (a && a.active && a.text) h += `<div class="bc-announce ${esc(a.tone || 'gold')}">${esc(a.text)}</div>`;
    return h;
  };

  BC.statusChip = () => {
    const c = BC.state.config || {}; const o = c.ordering || { open: true }; const st = c.store || {};
    if (!o.open) return `<span class="bc-status closed"><i></i>Siparişe kapalı</span>`;
    const hours = st.mode === 'auto' && st.closeTime ? ` · ${esc(st.closeTime)}'a kadar` : '';
    return `<span class="bc-status"><i></i>Sipariş alıyoruz${hours}</span>`;
  };

  BC.footer = () => {
    const c = (BC.state.config && BC.state.config.contact) || {};
    const socials = ['facebook', 'x', 'instagram', 'youtube', 'tiktok'].filter((k) => c[k]).map((k) => `<a href="${esc(c[k])}" target="_blank" rel="noopener" aria-label="${k}">${I[k]}</a>`).join('');
    const tel = (c.phone || '').replace(/[^\d+]/g, '');
    return `<footer class="bc-foot">
      ${socials ? `<div class="bc-social">${socials}</div>` : ''}
      ${c.phone ? `<a class="bc-phone" href="tel:${esc(tel)}">${I.phone}<span>${esc(c.phone)}</span></a>` : ''}
      <div class="bc-foot-links"><a href="/terms.html">Kullanım Koşulları</a><a href="/privacy-policy.html">Gizlilik Politikası</a><a href="/contact.html">İletişim</a><a href="/subeler.html">Şubelerimiz</a></div>
      <div class="bc-copy">© ${new Date().getFullYear()} ${esc((BC.state.config && BC.state.config.brand && BC.state.config.brand.name) || 'Brokers Coffee')}</div>
    </footer>`;
  };

  BC.productCard = (p) => `<div class="bc-pcard" data-pid="${esc(p.id)}">
      <a class="ph" href="/product.html?id=${encodeURIComponent(p.id)}">${BC.imgTag(p.image, p.name)}</a>
      <div class="bd"><a class="nm" href="/product.html?id=${encodeURIComponent(p.id)}">${esc(p.name)}</a>
        <div class="ft">${BC.priceHtml(p)}<button class="bc-add" data-add="${esc(p.id)}" aria-label="${esc(p.name)} sepete ekle">${I.plus}</button></div></div></div>`;
  BC.productRow = (p) => `<div class="bc-prow" data-pid="${esc(p.id)}">
      <a class="ph" href="/product.html?id=${encodeURIComponent(p.id)}">${BC.imgTag(p.image, p.name)}</a>
      <a class="bd" href="/product.html?id=${encodeURIComponent(p.id)}"><span class="nm">${esc(p.name)}</span>${p.description ? `<span class="ds">${esc(p.description)}</span>` : ''}${BC.priceHtml(p)}</a>
      <button class="bc-add" data-add="${esc(p.id)}" aria-label="${esc(p.name)} sepete ekle">${I.plus}</button></div>`;
  BC.categoryCard = (name, { wide = false } = {}) => {
    const m = BC.categoryMeta(name);
    return `<a class="bc-cat ${wide ? 'wide' : ''}" href="/menu.html?cat=${encodeURIComponent(name)}">${m.badge ? `<span class="bc-new">${esc(m.badge)}</span>` : ''}<span class="ph">${BC.imgTag(m.image, name)}</span><span class="nm">${esc(name)}</span></a>`;
  };
  // Kategori ızgarası: tek sayıda kart varsa sonuncusu tam genişlik (fotoğraftaki "Dürümler" gibi)
  BC.categoryGrid = (cats) => `<div class="bc-catgrid">${cats.map((c, i) => BC.categoryCard(c, { wide: cats.length % 2 === 1 && i === cats.length - 1 })).join('')}</div>`;

  BC.offerCard = (o, mini = false) => {
    const exp = o.expiresAt ? new Date(o.expiresAt) : null;
    const daysLeft = exp ? Math.ceil((exp - Date.now()) / 86400000) : null;
    const tag = daysLeft !== null && daysLeft <= 3 ? '<span class="tag"><i></i>Kullanım süresi dolmak üzere</span>' : daysLeft !== null ? `<span class="tag">⏳ ${daysLeft} gün kaldı</span>` : '';
    return `<a class="bc-offer ${mini ? 'bc-offer-mini' : ''}" href="${esc(o.link || '/siparis.html')}">
      <div class="ph">${BC.imgTag(o.image, o.title)}</div>${tag}${o.badge ? `<span class="badge">${esc(o.badge)}</span>` : ''}
      <div class="bd"><h3>${esc(o.title)}</h3>${o.description && !mini ? `<p>${esc(o.description)}</p>` : ''}</div></a>`;
  };

  // Mağaza kartı (adres, durum, yol tarifi, arama)
  BC.storeCard = () => {
    const c = BC.state.config || {}; const st = c.store || {}; const ct = c.contact || {}; const o = c.ordering || { open: true };
    const tel = (ct.phone || '').replace(/[^\d+]/g, '');
    return `<div class="bc-store" id="magaza"><div class="pin">${I.pin}</div><div style="flex:1;min-width:0">
      <h3>${esc(st.address || '')}</h3>
      <div class="meta">${BC.statusChip()}${st.mode === 'auto' ? `<span>${I.clock.replace('<svg', '<svg style="width:16px;height:16px;vertical-align:-3px"')} ${esc(st.openTime)} - ${esc(st.closeTime)}</span>` : ''}</div>
      ${!o.open && o.message ? `<p style="margin-top:10px;font-weight:600;color:#b42318">${esc(o.message)}</p>` : ''}
      ${st.deliveryNote ? `<p class="bc-muted" style="margin-top:8px;font-size:14px">🛵 ${esc(st.deliveryNote)}${st.prepMinutes ? ` · ⏱ ~${esc(st.prepMinutes)} dk hazırlık` : ''}</p>` : ''}
      <div class="acts">${st.mapsUrl ? `<a class="bc-btn bc-btn-line bc-btn-sm" href="${esc(st.mapsUrl)}" target="_blank" rel="noopener">${I.pin} Yol tarifi</a>` : ''}${tel ? `<a class="bc-btn bc-btn-line bc-btn-sm" href="tel:${esc(tel)}">${I.phone} Ara</a>` : ''}</div>
    </div></div>`;
  };

  // Club kartı: giriş yapmışsa puan + aylık kademe ilerlemesi, değilse üyelik daveti
  BC.clubCard = (progress) => {
    const me = BC.state.me; const club = (BC.state.config && BC.state.config.club) || {};
    if (!me) {
      return `<a class="bc-club" href="/club.html" style="display:block"><div class="row"><div>
        <span class="bc-eyebrow" style="color:var(--bc-gold-2)">${esc(club.title || 'Brokers Club')}</span>
        <div class="bc-h2" style="margin:6px 0 8px">${esc(club.headline || 'Sipariş ver, puanları topla')}</div>
        <p>${esc(club.text || '')}</p></div><div class="coin">B</div></div>
        <div style="margin-top:16px"><span class="bc-btn bc-btn-gold bc-btn-sm">Ücretsiz Katıl ${I.arrow}</span></div></a>`;
    }
    let bar = ''; let txt = '';
    if (progress && progress.tiers && progress.tiers.length) {
      const max = progress.tiers[progress.tiers.length - 1].threshold;
      const pct = Math.min(100, (progress.spend / max) * 100);
      bar = `<div class="bc-progress"><i data-w="${pct.toFixed(1)}"></i></div>`;
      if (progress.unclaimedTier) txt = `🎉 ${BC.money(progress.unclaimedTier.discount)} indirim kazandın! Bir sonraki siparişinde kullan.`;
      else if (progress.nextTier) txt = `${BC.money(progress.nextTier.threshold - progress.spend)} daha harca, ${BC.money(progress.nextTier.discount)} indirim kazan.`;
      else txt = 'Bu ayın tüm kademelerini tamamladın! 🎉';
    }
    return `<a class="bc-club" href="/club.html" style="display:block"><div class="row"><div>
      <span class="bc-eyebrow" style="color:var(--bc-gold-2)">${esc(club.title || 'Brokers Club')}</span>
      <div class="pts" style="margin-top:8px"><span data-count="${Number(me.loyaltyPoints || 0)}">0</span><small>puan</small></div></div><div class="coin">B</div></div>
      ${bar}<p>${esc(txt || 'Puanlarını ödüllere dönüştürmek için dokun.')}</p></a>`;
  };
  // Club kartındaki sayaç ve çubuk animasyonu
  BC.animateClub = (scope = document) => {
    scope.querySelectorAll('[data-count]').forEach((el) => {
      const to = Number(el.dataset.count) || 0; const t0 = performance.now();
      const step = (t) => { const k = Math.min(1, (t - t0) / 1100); el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))).toLocaleString('tr-TR'); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
    scope.querySelectorAll('.bc-progress i[data-w]').forEach((el) => requestAnimationFrame(() => setTimeout(() => (el.style.width = el.dataset.w + '%'), 60)));
  };

  // "+" butonları için tek dinleyici
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-add]');
    if (!btn) return;
    e.preventDefault();
    const p = (BC.state.products || []).find((x) => x.id === btn.dataset.add);
    if (p) BC.quickAdd(p, btn);
  });

  // Slider: kaydırınca noktaları güncelle, otomatik geçiş
  BC.carousel = (root) => {
    if (!root) return;
    const track = root.querySelector('.bc-track');
    const slides = [...track.children];
    const dots = root.querySelector('.bc-dots');
    if (dots) dots.innerHTML = slides.length > 1 ? slides.map((_, i) => `<button aria-label="${i + 1}. slayt" class="${i === 0 ? 'on' : ''}"></button>`).join('') : '';
    let cur = 0;
    const set = (i) => {
      cur = i; slides.forEach((s, j) => s.classList.toggle('cur', j === i));
      if (dots) [...dots.children].forEach((d, j) => d.classList.toggle('on', j === i));
    };
    set(0);
    track.addEventListener('scroll', () => {
      const i = Math.round(track.scrollLeft / Math.max(1, slides[0].offsetWidth + 14));
      if (i !== cur && slides[i]) set(i);
    }, { passive: true });
    if (dots) [...dots.children].forEach((d, i) => d.addEventListener('click', () => track.scrollTo({ left: slides[i].offsetLeft - slides[0].offsetLeft, behavior: 'smooth' })));
    if (root._timer) clearInterval(root._timer);
    if (slides.length > 1) {
      let paused = false;
      root.addEventListener('pointerenter', () => (paused = true));
      root.addEventListener('pointerleave', () => (paused = false));
      root.addEventListener('touchstart', () => (paused = true), { passive: true });
      root._timer = setInterval(() => {
        if (paused || document.hidden || !root.isConnected) return;
        const n = (cur + 1) % slides.length;
        track.scrollTo({ left: slides[n].offsetLeft - slides[0].offsetLeft, behavior: 'smooth' });
      }, 5000);
    }
  };
  BC.slide = (x) => `<div class="bc-slide ${esc(x.theme || 'navy')}">${BC.imgTag(x.image, x.title, 'bg')}<div class="bc-slide-in">${x.eyebrow ? `<span class="bc-eyebrow">${esc(x.eyebrow)}</span>` : ''}<h2>${esc(x.title)}</h2>${x.subtitle ? `<p>${esc(x.subtitle)}</p>` : ''}${x.ctaText ? `<a class="bc-btn ${x.theme === 'gold' ? 'bc-btn-navy' : 'bc-btn-gold'}" href="${esc(x.link || '/siparis.html')}">${esc(x.ctaText)} ${I.arrow}</a>` : ''}</div></div>`;

  // Belirerek gelme efekti
  BC.reveal = (scope = document) => {
    const els = scope.querySelectorAll('.bc-reveal:not(.in)');
    if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
    const io = new IntersectionObserver((ents) => ents.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { rootMargin: '0px 0px -8% 0px' });
    els.forEach((e) => io.observe(e));
  };

  // Alt sayfa (sheet)
  BC.sheet = (html) => {
    const bg = document.createElement('div'); bg.className = 'bc-sheet-bg';
    const sh = document.createElement('div'); sh.className = 'bc-sheet'; sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true');
    sh.innerHTML = '<div class="grab"></div>' + html;
    document.body.append(bg, sh);
    requestAnimationFrame(() => { bg.classList.add('open'); sh.classList.add('open'); });
    const close = () => { bg.classList.remove('open'); sh.classList.remove('open'); setTimeout(() => { bg.remove(); sh.remove(); }, 400); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    bg.addEventListener('click', close); document.addEventListener('keydown', onKey);
    sh.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    return { el: sh, close };
  };

  BC.greeting = () => {
    const h = Number(new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', hour12: false }).format(new Date()));
    if (h < 5) return 'İyi geceler'; if (h < 12) return 'Günaydın'; if (h < 18) return 'İyi günler'; return 'İyi akşamlar';
  };

  // Üst bar kaydırınca gölge
  window.addEventListener('scroll', () => { const t = document.querySelector('[data-bc-top]'); if (t) t.classList.toggle('scrolled', scrollY > 4); }, { passive: true });

  // ---------- Yönetim panelinden canlı önizleme ----------
  function orderingFor(cfg) {
    const st = cfg.store || {};
    if (st.mode === 'closed') return { open: false, message: st.closedMessage };
    if (st.mode === 'auto') {
      const now = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
      const inH = st.openTime <= st.closeTime ? now >= st.openTime && now < st.closeTime : now >= st.openTime || now < st.closeTime;
      if (!inH) return { open: false, message: `Şu an kapalıyız. Sipariş saatlerimiz ${st.openTime} - ${st.closeTime}.` };
    }
    return { open: true, message: '' };
  }
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data || e.data.type !== 'bc-preview') return;
    const cfg = JSON.parse(JSON.stringify(e.data.config));
    const who = e.data.audience === 'staff' ? 'staff' : 'customer';
    const vis = (x) => x.active !== false && (!x.audience || x.audience === 'both' || x.audience === who);
    cfg.slides = (cfg.slides || []).filter(vis);
    cfg.offers = (cfg.offers || []).filter((o) => vis(o) && (!o.expiresAt || new Date(o.expiresAt) > new Date()));
    cfg.rails = (cfg.rails || []).filter(vis);
    if (!cfg.announcement || !vis(cfg.announcement)) cfg.announcement = { active: false };
    cfg.ordering = orderingFor(cfg);
    cfg.audience = who;
    cfg.staffBannerText = who === 'staff' ? (e.data.staffBannerText || 'Personel indirimi uygulanıyor.') : '';
    BC._previewCfg = cfg; // sayfanın kendi yüklemesi bu taslağı ezmesin
    BC.state.config = cfg;
    applyBrand();
    if (BC.state.config && document.getElementById('bc-root') && BC._loaded) BC.emit();
  });
  if (BC.isPreview && window.parent !== window) {
    // Önizlemede bağlantılar da önizleme modunda kalsın
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="/"]');
      if (a && !a.href.includes('preview=1')) { e.preventDefault(); const u = new URL(a.href); u.searchParams.set('preview', '1'); location.href = u.toString(); }
    }, true);
    window.addEventListener('load', () => window.parent.postMessage({ type: 'bc-preview-ready', path: location.pathname + location.search }, location.origin));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountShell); else mountShell();
})();
