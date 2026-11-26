// Yönetim paneli — E-posta Stüdyosu: e-postaları bloklarla tasarla, sonra görev ver
// (kime, hangi olayda ya da hangi tarihte gideceğini belirle). Marka Bahçem'deki stüdyonun uyarlaması.
(function () {
  const S = { home: null, tab: 'flows', view: 'home', tpl: null, saved: '', sel: null, device: 'desk', logRule: null, logStatus: '', products: null };
  let root;

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rid = () => Math.random().toString(36).slice(2, 10);
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const fmt = (ms, o) => (ms ? new Date(ms).toLocaleString('tr-TR', o || { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

  async function api(url, opts = {}) {
    const init = { ...opts };
    if (opts.body && typeof opts.body !== 'string' && !(opts.body instanceof FormData)) { init.body = JSON.stringify(opts.body); init.headers = { 'Content-Type': 'application/json' }; }
    const r = await fetch(url, init);
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) { window.location.href = '/admin/login.html'; throw new Error('Oturum gerekli'); }
    if (!r.ok) throw new Error(d.error || 'İşlem başarısız');
    return d;
  }
  function toast(msg, err) {
    const t = document.createElement('div'); t.className = 'ms-toast' + (err ? ' err' : ''); t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 2800);
  }
  const fail = (e) => toast(e.message || String(e), true);

  /* ---------------- tanımlar ---------------- */
  const BLOCKS = [
    { type: 'hero', icon: '🌅', name: 'Afiş', make: () => ({ title: 'Büyük başlık', text: 'Kısa bir açıklama', image: '', bg: '#0d1b3d', fg: '#ffffff' }) },
    { type: 'heading', icon: '🔠', name: 'Başlık', make: () => ({ text: 'Başlık', size: 'lg', align: 'left' }) },
    { type: 'text', icon: '📝', name: 'Metin', make: () => ({ text: 'Merhaba {ad}, buraya mesajını yaz.', align: 'left' }) },
    { type: 'button', icon: '🔘', name: 'Düğme', make: () => ({ text: 'Sipariş ver', url: '/siparis.html', align: 'center' }) },
    { type: 'image', icon: '🖼', name: 'Görsel', make: () => ({ url: '', alt: '', link: '', width: 100, align: 'center', radius: 'lg', caption: '' }) },
    { type: 'imagetext', icon: '🪟', name: 'Görsel + yazı', make: () => ({ image: '', alt: '', side: 'left', ratio: 40, valign: 'middle', title: 'Başlık', text: 'Kısa bir açıklama yaz.', btnText: 'İncele', btnUrl: '/menu.html' }) },
    { type: 'cards', icon: '🗂', name: 'Kartlar', make: () => ({ cols: 2, items: [{ image: '', title: 'Birinci kart', text: 'Kısa açıklama', link: '' }, { image: '', title: 'İkinci kart', text: 'Kısa açıklama', link: '' }] }) },
    { type: 'products', icon: '☕', name: 'Ürünler', make: () => ({ title: 'Senin için seçtiklerimiz', ids: [], cols: 2 }) },
    { type: 'coupon', icon: '🎟', name: 'Kupon', make: () => ({ code: 'KOD10', note: 'Sepette geçerli' }) },
    { type: 'divider', icon: '➖', name: 'Çizgi', make: () => ({}) },
    { type: 'spacer', icon: '↕️', name: 'Boşluk', make: () => ({ h: 24 }) },
    { type: 'social', icon: '🔗', name: 'Sosyal medya', make: () => ({ instagram: '', tiktok: '', whatsapp: '' }) },
  ];
  const meta = (t) => BLOCKS.find((b) => b.type === t) || { icon: '▫️', name: t };
  function label(b) {
    switch (b.type) {
      case 'hero': return b.title;
      case 'heading': case 'text': return String(b.text || '').replace(/\*\*/g, '').slice(0, 60);
      case 'button': return `${b.text} → ${b.url}`;
      case 'image': return b.url ? `${b.alt || 'Görsel'} · %${b.width || 100}` : 'Görsel seçilmedi';
      case 'imagetext': return `${b.side === 'right' ? 'Görsel sağda' : 'Görsel solda'} · ${b.title || ''}`;
      case 'cards': return `${(b.items || []).length} kart · ${b.cols || 2} sütun`;
      case 'products': return (b.ids || []).length ? `${b.ids.length} ürün` : 'Ürün seçilmedi';
      case 'coupon': return b.code;
      case 'spacer': return `${b.h || 24} px`;
      case 'social': return [b.instagram && 'Instagram', b.tiktok && 'TikTok', b.whatsapp && 'WhatsApp'].filter(Boolean).join(', ') || 'Bağlantı yok';
      default: return '';
    }
  }

  const TRIGGERS = [
    { key: 'signup', icon: '🎉', name: 'Yeni üye olunca', when: 'Biri üye olduktan (ya da e-postasını ekledikten)', desc: 'Hoş geldin serisi: hemen, 3 gün sonra, 1 hafta sonra…' },
    { key: 'order_delivered', icon: '📦', name: 'Sipariş teslim edilince', when: 'Sipariş "Teslim Edildi" olduktan', desc: 'Teşekkür, puan hatırlatma, tekrar sipariş' },
    { key: 'inactive', icon: '💛', name: 'Bir süredir sipariş vermeyince', when: 'Son siparişinden', desc: '"Seni özledik" e-postası (her ara için bir kez)' },
    { key: 'once', icon: '📅', name: 'Belirli bir tarihte', when: 'Seçtiğin tarihte', desc: 'Kampanya, duyuru; bir kitleye tek seferde' },
  ];
  const trig = (k) => TRIGGERS.find((t) => t.key === k) || TRIGGERS[0];
  const AUDIENCES = [['all', '👥', 'Herkes'], ['customers', '☕', 'Müşteriler'], ['staff', '🏪', 'Personel']];
  const DELAYS = [[0, 'Hemen'], [60, '1 saat'], [180, '3 saat'], [1440, '1 gün'], [4320, '3 gün'], [10080, '1 hafta']];
  const IDLE = [[10080, '1 hafta'], [20160, '2 hafta'], [43200, '30 gün'], [86400, '60 gün']];
  function delayText(min) {
    if (!min) return 'hemen';
    if (min % 10080 === 0) return `${min / 10080} hafta sonra`;
    if (min % 1440 === 0) return `${min / 1440} gün sonra`;
    if (min % 60 === 0) return `${min / 60} saat sonra`;
    return `${min} dakika sonra`;
  }
  function ruleSentence(r, tplName) {
    const night = r.quietHours ? ' Gece 21:00–09:00 arasına denk gelirse sabah 09:00\'da gider.' : '';
    if (r.trigger === 'once') {
      const aud = (AUDIENCES.find((a) => a[0] === r.audience) || AUDIENCES[0])[2].toLocaleLowerCase('tr');
      return `${r.sendAt ? fmt(r.sendAt, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : 'Seçeceğin tarihte'} «${tplName}» ${aud} kitlesine bir kez gönderilir.${night}`;
    }
    if (r.trigger === 'inactive') return `Son siparişinin üzerinden ${delayText(Math.max(10080, r.delayMin)).replace(' sonra', '')} geçen ve o zamandan beri sipariş vermeyen üyeye «${tplName}» bir kez gönderilir.${night}`;
    return `${trig(r.trigger).when} ${delayText(r.delayMin)} «${tplName}» gönderilir.${night}`;
  }
  function checklist(t) {
    const all = JSON.stringify(t.blocks) + t.subject;
    return [
      [!!t.subject.trim(), 'Konu yazıldı'],
      [t.subject.length <= 60, `Konu kısa (${t.subject.length}/60): telefonda kesilmez`],
      [!!t.preheader.trim(), 'Ön izleme metni var (gelen kutusunda konunun yanında görünür)'],
      [all.includes('{ad}'), 'Kişiselleştirme: {ad} kullanıldı'],
      [t.blocks.some((b) => b.type === 'button' || (b.type === 'hero' && b.btnText)), 'En az bir düğme var'],
      [!t.blocks.some((b) => (b.type === 'image' && (!b.url || !b.alt)) || (b.type === 'imagetext' && !b.image)), 'Görsellerin hepsi seçili ve açıklamalı'],
      [!t.blocks.some((b) => b.type === 'products' && !(b.ids || []).length), 'Ürün bölümlerinde ürün seçildi'],
      [!/[A-ZÇĞİÖŞÜ]{6,}/.test(t.subject) && !/!!/.test(t.subject), 'Konuda bağıran BÜYÜK HARF ya da !! yok (spam riski)'],
    ];
  }

  /* ---------------- ana sayfa ---------------- */
  async function loadHome() {
    try { S.home = await api('/api/admin/mail'); } catch (e) { fail(e); return; }
    if (S.view === 'home') render();
  }
  function render() {
    if (!root) return;
    if (S.view === 'edit') return renderEditor();
    const d = S.home;
    if (!d) { root.innerHTML = '<div class="ms-empty"><div>✉️</div>Yükleniyor…</div>'; return; }
    const T = d.totals;
    root.innerHTML = `
      <div class="ms-hero"><div><h2>✉️ E-posta Stüdyosu</h2><p>E-postalarını bloklarla tasarla, sonra görev ver: kime, hangi olayda ya da hangi tarihte gideceğini sen belirle.</p></div>
        <button class="ms-btn gold" data-a="new">＋ Yeni e-posta</button></div>
      ${!d.ready ? `<div class="ms-warn">⚠️ <div><b>E-posta servisi henüz bağlı değil.</b> Tasarlayabilir ve görev verebilirsin; gerçek gönderim için <b>Entegrasyonlar &gt; Resend</b> bölümüne API anahtarını girmen ve <b>brokerscoffee.com.tr</b> alan adını Resend'de doğrulaman gerekiyor. Kampanya e-postaları için ayrıca İYS (İleti Yönetim Sistemi) kaydı yasal zorunluluktur.</div></div>` : ''}
      <div class="ms-kpis">
        <div><small>Son 30 gün gönderilen</small><b>${T.sent.toLocaleString('tr-TR')}</b></div>
        <div><small>Açılma oranı</small><b>%${pct(T.opened, T.sent)}</b><i style="width:${pct(T.opened, T.sent)}%"></i></div>
        <div><small>Tıklama oranı</small><b>%${pct(T.clicked, T.sent)}</b><i style="width:${pct(T.clicked, T.sent)}%"></i></div>
        <div><small>E-postası olan üye</small><b>${T.withEmail.toLocaleString('tr-TR')}<span>/${T.users.toLocaleString('tr-TR')}</span></b><i style="width:${pct(T.withEmail, T.users)}%"></i></div>
        <div><small>Kampanya izni veren</small><b>${T.optin.toLocaleString('tr-TR')}<span>/${T.withEmail.toLocaleString('tr-TR')}</span></b><i style="width:${pct(T.optin, T.withEmail)}%"></i></div>
      </div>
      <div class="ms-tabs">
        <button class="${S.tab === 'flows' ? 'on' : ''}" data-tab="flows">⚡ Otomasyonlar</button>
        <button class="${S.tab === 'templates' ? 'on' : ''}" data-tab="templates">🎨 Şablonlar <small>${d.templates.length}</small></button>
        <button class="${S.tab === 'log' ? 'on' : ''}" data-tab="log">🧾 Gönderim kaydı</button>
      </div>
      <div id="ms-body">${S.tab === 'flows' ? flowsHtml(d) : S.tab === 'templates' ? templatesHtml(d) : '<div class="ms-empty">Yükleniyor…</div>'}</div>`;
    if (S.tab === 'templates') drawThumbs();
    if (S.tab === 'log') renderLog();
  }

  const startersHtml = (d) => `<div class="ms-starters">${d.starters.map((s) => `<button data-a="starter" data-k="${s.key}"><span>${s.icon}</span><b>${esc(s.name)}</b><small>${esc(s.desc)}</small><em>${trig(s.trigger).icon} ${trig(s.trigger).name}</em></button>`).join('')}</div>`;

  function flowsHtml(d) {
    const tname = (id) => (d.templates.find((t) => t.id === id) || {}).name || 'Silinmiş şablon';
    if (!d.templates.length) return `<div class="ms-start"><h3>Hazır şablonlardan başla</h3><p class="ms-help" style="margin-bottom:14px">Birine dokun; düzenleyicide açılır, metinleri ve renkleri istediğin gibi değiştir. Sonra “⚡ Görev ver” ile kime ne zaman gideceğini seç.</p>${startersHtml(d)}</div>`;
    return `<div class="ms-flows">${TRIGGERS.map((t) => {
      const rs = d.rules.filter((r) => r.trigger === t.key).sort((a, b) => (t.key === 'once' ? (b.sendAt || 0) - (a.sendAt || 0) : a.delayMin - b.delayMin));
      return `<section class="ms-flow ${rs.some((r) => r.active) ? 'live' : ''}">
        <header><span class="ms-fi">${t.icon}</span><div class="ms-grow"><b>${t.name}</b><small>${t.desc}</small></div><button class="ms-btn sm" data-a="addrule" data-t="${t.key}">＋ Ekle</button></header>
        ${rs.length ? `<ol class="ms-steps">${rs.map((r) => {
          const s = r.stats;
          const when = t.key === 'once' ? fmt(r.sendAt) : t.key === 'inactive' ? `${delayText(Math.max(10080, r.delayMin)).replace(' sonra', '')} sipariş yoksa` : delayText(r.delayMin);
          const abWin = r.subjectB && s.ab.A.sent && s.ab.B.sent ? (pct(s.ab.B.opened, s.ab.B.sent) > pct(s.ab.A.opened, s.ab.A.sent) ? 'B' : 'A') : null;
          const aud = t.key === 'once' ? ' · ' + (AUDIENCES.find((a) => a[0] === r.audience) || AUDIENCES[0])[2] : '';
          return `<li class="${r.active ? 'on' : ''}"><span class="ms-when">${esc(when)}</span><div class="ms-step">
            <div class="ms-step-h"><div class="ms-grow"><b>${esc(tname(r.templateId))}</b><small>${esc(r.name)}${aud}${r.quietHours ? ' · 🌙' : ''}${r.subjectB ? ' · 🧪 A/B' : ''}</small></div>
              ${t.key === 'once' && r.firedAt ? '<span class="ms-badge ok">Gönderildi</span>' : `<label class="ms-switch" title="${r.active ? 'Durdur' : 'Başlat'}"><input type="checkbox" data-a="toggle" data-id="${r.id}" ${r.active ? 'checked' : ''}/><span></span></label>`}</div>
            <div class="ms-stats"><span title="Gönderilen">📨 ${s.sent}</span><span title="Açılan">👁 %${pct(s.opened, s.sent)}</span><span title="Tıklanan">👆 %${pct(s.clicked, s.sent)}</span>
              ${s.queued ? `<span title="Sırada">⏳ ${s.queued}</span>` : ''}${s.skipped ? `<span title="Atlanan (izin yok, abonelikten çıktı…)">⤼ ${s.skipped}</span>` : ''}${s.failed ? `<span class="bad" title="Gönderilemeyen">⚠ ${s.failed}</span>` : ''}${abWin ? `<span class="win">🏆 ${abWin} konusu önde</span>` : ''}</div>
            <div class="ms-step-a"><button class="ms-btn sm ghost" data-a="edit" data-id="${r.templateId}">🎨 Tasarım</button><button class="ms-btn sm ghost" data-a="editrule" data-id="${r.id}">⚙️ Ayarlar</button>
              <button class="ms-btn sm ghost" data-a="log" data-id="${r.id}">🧾 Kayıt</button><button class="ms-btn sm ghost danger" data-a="delrule" data-id="${r.id}">🗑</button></div>
          </div></li>`;
        }).join('')}</ol>` : `<button class="ms-add" data-a="addrule" data-t="${t.key}">＋ Bu olaya bir e-posta bağla</button>`}
      </section>`;
    }).join('')}</div>`;
  }

  function templatesHtml(d) {
    return `<div class="ms-gal">
      <button class="ms-tpl ms-new" data-a="new"><span>＋</span><b>Boş e-posta</b><small class="ms-help">Sıfırdan tasarla</small></button>
      ${d.templates.map((t) => `<div class="ms-tpl">
        <div class="ms-thumb" data-a="edit" data-id="${t.id}"><iframe title="" tabindex="-1" sandbox="" data-thumb="${t.id}"></iframe></div>
        <div class="ms-tpl-b"><b>${esc(t.name)}</b><div class="ms-ellip">${esc(t.subject || 'Konu yok')}</div>
          <div class="ms-row"><span class="ms-badge ${t.kind === 'marketing' ? 'gold' : ''}">${t.kind === 'marketing' ? '📣 Kampanya' : 'ℹ️ Bilgilendirme'}</span>${t.uses ? `<span class="ms-badge ok">⚡ ${t.uses} görev</span>` : '<span class="ms-badge">Görev yok</span>'}</div>
          <div class="ms-row"><button class="ms-btn sm" data-a="edit" data-id="${t.id}">✏️ Düzenle</button><button class="ms-btn sm" data-a="addrule" data-tpl="${t.id}">⚡ Görev ver</button>
            <button class="ms-btn sm ghost" data-a="copy" data-id="${t.id}" title="Kopyala">⧉</button><button class="ms-btn sm ghost danger" data-a="deltpl" data-id="${t.id}" title="Sil">🗑</button></div>
        </div></div>`).join('')}
    </div><div style="margin-top:18px"><div class="ms-h">Hazır şablonlar</div>${startersHtml(d)}</div>`;
  }
  function drawThumbs() {
    S.home.templates.forEach((t) => {
      api('/api/admin/mail/render', { method: 'POST', body: t }).then((r) => {
        const f = root.querySelector(`iframe[data-thumb="${t.id}"]`); if (f) f.srcdoc = r.html;
      }).catch(() => {});
    });
  }

  const ST = { queued: ['⏳ Sırada', 'info'], sent: ['✓ Gönderildi', 'ok'], failed: ['⚠ Gönderilemedi', 'bad'], skipped: ['⤼ Atlandı', ''], test: ['🧪 Deneme', 'teal'] };
  async function renderLog() {
    const body = root.querySelector('#ms-body'); if (!body) return;
    const r = S.home.rules.find((x) => x.id === S.logRule);
    const params = new URLSearchParams(); if (S.logRule) params.set('rule', S.logRule); if (S.logStatus) params.set('status', S.logStatus);
    const head = `<div class="ms-row" style="margin-bottom:12px">${r ? `<span class="ms-badge gold">⚡ ${esc(r.name)} <button class="ms-btn sm ghost" style="height:20px;padding:0 4px" data-a="logclear">✕</button></span>` : ''}
      <div class="ms-seg">${[['', 'Hepsi'], ['queued', 'Sırada'], ['sent', 'Gönderilen'], ['skipped', 'Atlanan'], ['failed', 'Hatalı'], ['test', 'Deneme']].map(([k, l]) => `<button class="${S.logStatus === k ? 'on' : ''}" data-a="logst" data-k="${k}">${l}</button>`).join('')}</div></div>`;
    body.innerHTML = head + '<div class="ms-empty">Yükleniyor…</div>';
    let d; try { d = await api('/api/admin/mail/sends?' + params); } catch (e) { fail(e); return; }
    if (S.tab !== 'log' || S.view !== 'home') return;
    body.innerHTML = head + (!d.sends.length ? '<div class="ms-empty"><div>🧾</div><b>Kayıt yok</b><p class="ms-help">Görevler çalıştıkça her gönderim burada görünür.</p></div>' : `<div class="ms-tbl-wrap"><table class="ms-tbl">
      <thead><tr><th>Kişi</th><th>E-posta</th><th>Durum</th><th>Zaman</th><th class="r">Açtı · Tıkladı</th><th></th></tr></thead>
      <tbody>${d.sends.map((s) => `<tr><td><b>${esc(s.user || '—')}</b><div class="ms-help">${esc(s.email)}</div></td>
        <td>${esc(s.template)}<div class="ms-ellip" style="max-width:260px">${esc(s.subject || s.rule || '')}${s.variant === 'B' ? ' · B' : ''}</div></td>
        <td><span class="ms-badge ${ST[s.status][1]}">${ST[s.status][0]}</span>${s.note && s.status !== 'test' ? `<div class="ms-help">${esc(s.note)}</div>` : ''}</td>
        <td>${fmt(s.sentAt || s.dueAt)}</td><td class="r">${s.openedAt ? '👁' : '·'} ${s.clickedAt ? '👆' : '·'}</td>
        <td>${s.status === 'queued' ? `<button class="ms-btn sm ghost" data-a="cancel" data-id="${s.id}">İptal</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`);
  }

  async function createTpl(body) {
    try { const r = await api('/api/admin/mail/templates', { method: 'POST', body }); await openEditor(r.id); } catch (e) { fail(e); }
  }

  /* ---------------- düzenleyici ---------------- */
  async function openEditor(id) {
    try {
      const { template } = await api('/api/admin/mail/templates/' + id);
      S.tpl = template; S.saved = JSON.stringify(template); S.sel = null; S.view = 'edit';
      render(); window.scrollTo({ top: 0 });
    } catch (e) { fail(e); }
  }
  const dirty = () => S.tpl && JSON.stringify(S.tpl) !== S.saved;
  const blk = () => S.tpl.blocks.find((b) => b.id === S.sel);

  function renderEditor() {
    const t = S.tpl; const th = t.theme || {};
    root.innerHTML = `
      <div class="ms-ed-top">
        <button class="ms-btn" data-a="back">← Stüdyo</button>
        <input class="ms-name" data-tf="name" value="${esc(t.name)}" maxlength="80"/>
        <span class="ms-dirty" id="ms-dirty"></span>
        <button class="ms-btn" data-a="test">🧪 Deneme gönder</button>
        <button class="ms-btn" data-a="addrule" data-tpl="${t.id}">⚡ Görev ver</button>
        <button class="ms-btn navy" data-a="save">💾 Kaydet</button>
      </div>
      <div class="ms-ed">
        <div>
          <div class="ms-panel"><h3>✉️ Zarf</h3>
            <div class="ms-f"><span>Konu</span><input type="text" data-tf="subject" maxlength="150" value="${esc(t.subject)}" placeholder="ör. {ad}, yeni sezon lezzetleri geldi ☕"/></div>
            <div class="ms-f"><span>Ön izleme metni <small class="ms-help">(gelen kutusunda konunun yanında)</small></span><input type="text" data-tf="preheader" maxlength="150" value="${esc(t.preheader)}"/></div>
            <div class="ms-f"><span>Tür</span><div class="ms-seg">
              <button class="${t.kind === 'info' ? 'on' : ''}" data-a="kind" data-k="info">ℹ️ Bilgilendirme</button><button class="${t.kind === 'marketing' ? 'on' : ''}" data-a="kind" data-k="marketing">📣 Kampanya</button></div>
              <small class="ms-help">Kampanya e-postası yalnızca izin verenlere gider ve abonelikten çıkma bağlantısı taşır.</small></div>
            <div class="ms-2">
              <div class="ms-f"><span>Vurgu rengi (düğme)</span><input type="color" data-th="accent" value="${esc(th.accent || '#f5c542')}"/></div>
              <div class="ms-f"><span>Düğme yazısı</span><input type="color" data-th="accentFg" value="${esc(th.accentFg || '#15171c')}"/></div>
              <div class="ms-f"><span>Arka plan</span><input type="color" data-th="bg" value="${esc(th.bg || '#f1ece0')}"/></div>
              <div class="ms-f"><span>Kart</span><input type="color" data-th="card" value="${esc(th.card || '#ffffff')}"/></div>
            </div>
            <label class="ms-row" style="font-size:13px"><input type="checkbox" data-th="logo" ${th.logo !== false ? 'checked' : ''}/> Üstte Brokers Coffee logosu</label>
            <p class="ms-help" style="margin-top:8px">Değişkenler: <b>{ad}</b>, <b>{adsoyad}</b>, <b>{puan}</b>, <b>{eposta}</b>. Metinde <b>**kalın**</b>, <i>*italik*</i>, [yazı](/adres) kullanılabilir.</p>
          </div>
          <div class="ms-panel"><h3>🧱 Bölümler</h3>
            <div class="ms-blocks" id="ms-blocks">${blocksListHtml()}</div>
            <div class="ms-palette">${BLOCKS.map((b) => `<button data-a="addblock" data-type="${b.type}"><span>${b.icon}</span>${b.name}</button>`).join('')}</div>
          </div>
          <div class="ms-panel" id="ms-props">${propsHtml()}</div>
          <div class="ms-panel"><h3>✅ Kontrol listesi</h3><ul class="ms-check" id="ms-check"></ul></div>
        </div>
        <div class="ms-prev">
          <div class="ms-prev-bar"><div class="ms-seg"><button class="${S.device === 'desk' ? 'on' : ''}" data-a="device" data-k="desk">🖥 Bilgisayar</button><button class="${S.device === 'phone' ? 'on' : ''}" data-a="device" data-k="phone">📱 Telefon</button></div>
            <span class="ms-help">Önizlemede bir bölüme tıklayınca seçilir.</span></div>
          <div class="ms-prev-subj"><b id="ms-psubj"></b><small id="ms-ppre"></small></div>
          <iframe class="ms-frame ${S.device === 'phone' ? 'phone' : ''}" id="ms-frame" title="E-posta önizlemesi"></iframe>
        </div>
      </div>`;
    refresh(true);
  }
  function blocksListHtml() {
    if (!S.tpl.blocks.length) return '<p class="ms-help">Henüz bölüm yok. Aşağıdan bir bölüm ekle.</p>';
    return S.tpl.blocks.map((b, i) => `<div class="ms-blk ${S.sel === b.id ? 'on' : ''}" data-a="sel" data-id="${b.id}"><span class="ic">${meta(b.type).icon}</span>
      <div class="ms-grow"><b>${meta(b.type).name}</b><small>${esc(label(b))}</small></div>
      <div class="acts"><button data-a="up" data-id="${b.id}" title="Yukarı" ${i === 0 ? 'disabled' : ''}>↑</button><button data-a="down" data-id="${b.id}" title="Aşağı" ${i === S.tpl.blocks.length - 1 ? 'disabled' : ''}>↓</button>
      <button data-a="dup" data-id="${b.id}" title="Çoğalt">⧉</button><button data-a="del" data-id="${b.id}" title="Sil">🗑</button></div></div>`).join('');
  }

  // --- özellik alanları ---
  const v = (k, d = '') => { const b = blk(); return b && b[k] != null ? b[k] : d; };
  const F = {
    text: (k, l, o = {}) => `<div class="ms-f"><span>${l}</span><input type="text" data-k="${k}" value="${esc(v(k))}" maxlength="${o.max || 200}" placeholder="${esc(o.ph || '')}"/></div>`,
    area: (k, l, o = {}) => `<div class="ms-f"><span>${l}</span><textarea data-k="${k}" rows="${o.rows || 4}">${esc(v(k))}</textarea></div>`,
    link: (k, l) => `<div class="ms-f"><span>${l}</span><input type="text" data-k="${k}" value="${esc(v(k))}" placeholder="/siparis.html ya da https://…" list="ms-links"/></div>`,
    color: (k, l, d) => `<div class="ms-f"><span>${l}</span><input type="color" data-k="${k}" value="${esc(v(k) || d)}"/></div>`,
    bgColor: () => `<div class="ms-f"><span>Bölüm arka planı</span><div class="ms-row"><input type="color" data-k="bg" value="${esc(v('bg') || '#ffffff')}"/>${v('bg') ? '<button class="ms-btn sm ghost" data-a="clearbg">Kaldır</button>' : '<small class="ms-help">yok (kartın rengi)</small>'}</div></div>`,
    seg: (k, l, opts, d) => `<div class="ms-f"><span>${l}</span><div class="ms-seg">${opts.map(([val, t]) => `<button class="${String(v(k, d)) === String(val) ? 'on' : ''}" data-a="segk" data-k="${k}" data-v="${esc(val)}">${t}</button>`).join('')}</div></div>`,
    range: (k, l, min, max, step, d, unit = '') => `<div class="ms-f"><span>${l}: <b data-rv="${k}">${v(k, d)}${unit}</b></span><input type="range" data-k="${k}" data-num="1" min="${min}" max="${max}" step="${step}" value="${v(k, d)}"/></div>`,
    check: (k, l, d) => `<label class="ms-row" style="font-size:13px;margin-bottom:8px"><input type="checkbox" data-k="${k}" ${v(k, d) ? 'checked' : ''}/> ${l}</label>`,
    img: (k, l) => `<div class="ms-f"><span>${l}</span><div class="ms-img"><div class="th">${v(k) ? `<img src="${esc(v(k))}" alt=""/>` : '🖼'}</div><div class="ms-grow"><input type="text" data-k="${k}" value="${esc(v(k))}" placeholder="https://… ya da yükle"/>
      <div class="ms-row" style="margin-top:6px"><label class="ms-btn sm" style="cursor:pointer">⬆️ Yükle<input type="file" accept=".jpg,.jpeg,.png,.webp" hidden data-upload="${k}"/></label></div></div></div></div>`,
  };
  const ALIGN = (d = 'left') => F.seg('align', 'Hizalama', [['left', '⬅ Sol'], ['center', '↔ Orta'], ['right', 'Sağ ➡']], d);
  const SIZE3 = (d = 'md') => F.seg('size', 'Boyut', [['sm', 'Küçük'], ['md', 'Orta'], ['lg', 'Büyük']], d);
  const SPACE = (d) => F.range('pt', 'Üst boşluk', 0, 64, 4, d, 'px');

  function propsHtml() {
    const b = blk();
    if (!b) return '<h3>⚙️ Bölüm ayarları</h3><p class="ms-help">Düzenlemek için soldaki listeden ya da önizlemeden bir bölüm seç.</p>';
    let h = '';
    switch (b.type) {
      case 'hero': h = F.text('title', 'Başlık', { max: 120 }) + F.area('text', 'Açıklama', { rows: 3 }) + F.img('image', 'Arka plan görseli (isteğe bağlı)')
        + `<div class="ms-2">${F.color('bg', 'Arka plan', '#0d1b3d')}${F.color('fg', 'Yazı rengi', '#ffffff')}</div>`
        + ALIGN('center') + F.seg('size', 'Başlık boyutu', [['md', 'Orta'], ['lg', 'Büyük'], ['xl', 'Çok büyük']], 'lg') + F.seg('pad', 'Yükseklik', [['sm', 'Kısa'], ['md', 'Orta'], ['lg', 'Uzun']], 'md')
        + `<div class="ms-2">${F.text('btnText', 'Düğme yazısı', { max: 60, ph: 'boşsa düğme yok' })}${F.link('btnUrl', 'Düğme bağlantısı')}</div>`; break;
      case 'heading': h = F.text('text', 'Başlık', { max: 160 }) + F.seg('size', 'Boyut', [['sm', 'Küçük'], ['md', 'Orta'], ['lg', 'Büyük'], ['xl', 'Çok büyük']], 'lg') + ALIGN()
        + F.seg('font', 'Yazı tipi', [['serif', 'Playfair (zarif)'], ['sans', 'Sade']], 'serif') + F.color('color', 'Renk', '#0d1b3d')
        + F.check('bold', 'Kalın', true) + F.check('italic', 'İtalik', false) + F.check('upper', 'BÜYÜK HARF', false) + F.bgColor() + SPACE(24); break;
      case 'text': h = F.area('text', 'Metin', { rows: 7 }) + SIZE3() + ALIGN() + F.seg('font', 'Yazı tipi', [['sans', 'Sade'], ['serif', 'Playfair']], 'sans') + F.color('color', 'Renk', '#3b3f4a') + F.bgColor() + SPACE(14); break;
      case 'button': h = F.text('text', 'Yazı', { max: 60 }) + F.link('url', 'Bağlantı') + ALIGN('center') + SIZE3()
        + F.seg('shape', 'Köşe', [['pill', 'Yuvarlak'], ['rounded', 'Hafif'], ['square', 'Köşeli']], 'pill') + F.seg('style', 'Stil', [['solid', 'Dolu'], ['outline', 'Çerçeve']], 'solid')
        + `<div class="ms-2"><div class="ms-f"><span>Renk</span><div class="ms-row"><input type="color" data-k="color" value="${esc(v('color') || S.tpl.theme.accent || '#f5c542')}"/>${v('color') ? '<button class="ms-btn sm ghost" data-a="clearcolor">Tema rengi</button>' : '<small class="ms-help">tema rengi</small>'}</div></div>${F.color('fg', 'Yazı rengi', '#15171c')}</div>`
        + F.check('full', 'Tam genişlik', false) + F.bgColor() + SPACE(24); break;
      case 'image': h = F.img('url', 'Görsel') + F.text('alt', 'Açıklama (görsel açılmazsa görünür)', { max: 140 }) + F.link('link', 'Tıklayınca gideceği adres')
        + F.range('width', 'Genişlik', 20, 100, 5, 100, '%') + ALIGN('center') + F.seg('radius', 'Köşe', [['none', 'Düz'], ['sm', 'Hafif'], ['lg', 'Yuvarlak']], 'lg')
        + F.text('caption', 'Alt yazı', { max: 200 }) + F.check('edge', 'Kenardan kenara', false) + F.bgColor() + SPACE(20); break;
      case 'imagetext': h = F.img('image', 'Görsel') + F.text('alt', 'Görsel açıklaması', { max: 140 }) + F.link('link', 'Görsel bağlantısı')
        + F.seg('side', 'Görsel', [['left', 'Solda'], ['right', 'Sağda']], 'left') + F.seg('ratio', 'Görsel genişliği', [['33', 'Dar'], ['40', 'Orta'], ['50', 'Yarı yarıya']], 40)
        + F.seg('valign', 'Dikey hizalama', [['top', 'Üst'], ['middle', 'Orta']], 'middle') + F.text('title', 'Başlık', { max: 120 }) + F.area('text', 'Metin', { rows: 4 })
        + `<div class="ms-2">${F.text('btnText', 'Düğme yazısı', { max: 60 })}${F.link('btnUrl', 'Düğme bağlantısı')}</div>` + F.bgColor() + SPACE(24); break;
      case 'cards': h = F.seg('cols', 'Sütun', [['2', '2'], ['3', '3']], 2)
        + (b.items || []).map((it, i) => `<div class="ms-card-item"><div class="ms-row" style="justify-content:space-between"><b style="font-size:13px">Kart ${i + 1}</b><button class="ms-btn sm ghost danger" data-a="delcard" data-i="${i}">🗑</button></div>
          <div class="ms-f"><span>Görsel</span><div class="ms-img"><div class="th">${it.image ? `<img src="${esc(it.image)}" alt=""/>` : '🖼'}</div><div class="ms-grow"><input type="text" data-ci="${i}" data-ck="image" value="${esc(it.image)}" placeholder="https://… ya da yükle"/>
            <label class="ms-btn sm" style="cursor:pointer;margin-top:6px">⬆️ Yükle<input type="file" accept=".jpg,.jpeg,.png,.webp" hidden data-upload="card:${i}"/></label></div></div></div>
          <div class="ms-f"><span>Başlık</span><input type="text" data-ci="${i}" data-ck="title" maxlength="80" value="${esc(it.title)}"/></div>
          <div class="ms-f"><span>Metin</span><input type="text" data-ci="${i}" data-ck="text" maxlength="300" value="${esc(it.text)}"/></div>
          <div class="ms-f"><span>Bağlantı</span><input type="text" data-ci="${i}" data-ck="link" value="${esc(it.link)}" list="ms-links"/></div></div>`).join('')
        + ((b.items || []).length < 6 ? '<button class="ms-btn sm" data-a="addcard">＋ Kart ekle</button>' : '') + F.bgColor() + SPACE(20); break;
      case 'products': h = F.text('title', 'Bölüm başlığı', { max: 100 }) + F.seg('cols', 'Sütun', [['2', '2'], ['3', '3']], 2) + productsPickerHtml() + F.bgColor() + SPACE(16); break;
      case 'coupon': h = F.text('code', 'Kod', { max: 30 }) + F.text('note', 'Not', { max: 160 }) + '<p class="ms-help">Kodun Kampanyalar bölümünde gerçekten tanımlı olduğundan emin ol.</p>' + F.bgColor() + SPACE(24); break;
      case 'divider': h = F.color('color', 'Renk', '#e7e3da') + F.range('thick', 'Kalınlık', 1, 4, 1, 1, 'px') + F.range('width', 'Genişlik', 10, 100, 5, 100, '%') + SPACE(24); break;
      case 'spacer': h = F.range('h', 'Yükseklik', 8, 80, 4, 24, 'px'); break;
      case 'social': h = F.link('instagram', 'Instagram') + F.link('tiktok', 'TikTok') + F.link('whatsapp', 'WhatsApp (https://wa.me/90…)') + F.bgColor() + SPACE(24); break;
      default: break;
    }
    return `<h3>${meta(b.type).icon} ${meta(b.type).name}</h3>${h}<datalist id="ms-links">${['/', '/siparis.html', '/menu.html', '/club.html', '/club.html#firsatlar', '/loyalty.html', '/account.html', '/orders.html', '/register.html', '/subeler.html', '/contact.html'].map((u) => `<option value="${u}">`).join('')}</datalist>`;
  }

  function productsPickerHtml() {
    const b = blk(); const ids = b.ids || [];
    const all = S.products || [];
    const byId = (id) => all.find((p) => p.id === id);
    const q = (S.pq || '').toLocaleLowerCase('tr');
    const res = all.filter((p) => !q || (p.name + ' ' + (p.subcategory || p.category || '')).toLocaleLowerCase('tr').includes(q)).slice(0, 30);
    return `<div class="ms-f"><span>Ürünler (${ids.length}/6)</span>
      ${ids.length ? `<div class="ms-picked">${ids.map((i) => { const p = byId(i); return `<div><span class="ms-pi">${p && p.image ? `<img src="${esc(p.image)}" alt=""/>` : ''}</span><span class="ms-grow">${esc(p ? p.name : i)}</span><button class="ms-btn sm ghost" data-a="unpick" data-pid="${esc(i)}">✕</button></div>`; }).join('')}</div>` : ''}
      <input type="text" id="ms-pq" value="${esc(S.pq || '')}" placeholder="🔍 Ürün ara"/>
      <div class="ms-res">${!S.products ? '<span class="ms-help">Ürünler yükleniyor…</span>' : res.map((p) => `<button data-a="pick" data-pid="${esc(p.id)}" ${ids.includes(p.id) || ids.length >= 6 ? 'disabled' : ''}><span class="ms-pi">${p.image ? `<img src="${esc(p.image)}" alt=""/>` : ''}</span><span class="ms-grow"><small class="ms-help">${esc(p.subcategory || p.category || '')}</small><br><b>${esc(p.name)}</b></span></button>`).join('')}</div></div>`;
  }

  // --- yeniden çizimler ---
  function redrawList() { const el = root.querySelector('#ms-blocks'); if (el) el.innerHTML = blocksListHtml(); }
  function redrawProps() { const el = root.querySelector('#ms-props'); if (el) el.innerHTML = propsHtml(); }
  let rTimer = null; let rSeq = 0;
  function refresh(now) {
    const d = root.querySelector('#ms-dirty'); if (d) d.textContent = dirty() ? '● Kaydedilmemiş değişiklik' : '';
    const ck = root.querySelector('#ms-check'); if (ck) ck.innerHTML = checklist(S.tpl).map(([ok, t]) => `<li class="${ok ? 'ok' : 'no'}">${ok ? '✓' : '○'} ${esc(t)}</li>`).join('');
    clearTimeout(rTimer);
    rTimer = setTimeout(drawPreview, now ? 0 : 350);
  }
  async function drawPreview() {
    const seq = ++rSeq;
    let r; try { r = await api('/api/admin/mail/render', { method: 'POST', body: { ...S.tpl, mark: true } }); } catch (e) { return; }
    if (seq !== rSeq || S.view !== 'edit') return;
    const f = root.querySelector('#ms-frame'); if (!f) return;
    const subj = root.querySelector('#ms-psubj'); if (subj) subj.textContent = r.subject || '(konu yok)';
    const pre = root.querySelector('#ms-ppre'); if (pre) pre.textContent = S.tpl.preheader || '';
    const y = f.contentWindow ? f.contentWindow.scrollY : 0;
    const css = '<style>[data-b]{cursor:pointer}[data-b]:hover{outline:2px dashed rgba(13,27,61,.35);outline-offset:-2px}[data-b].sel{outline:2px solid #f5c542;outline-offset:-2px}a{pointer-events:none}</style>';
    f.onload = () => {
      const doc = f.contentDocument; if (!doc) return;
      f.contentWindow.scrollTo(0, y);
      if (S.sel) { const el = doc.querySelector(`[data-b="${S.sel}"]`); if (el) el.classList.add('sel'); }
      doc.addEventListener('click', (e) => {
        const row = e.target.closest('[data-b]'); if (!row) return;
        e.preventDefault(); select(row.getAttribute('data-b'));
      });
    };
    f.srcdoc = r.html.replace('</head>', css + '</head>');
  }
  function markSel() {
    const f = root.querySelector('#ms-frame'); const doc = f && f.contentDocument; if (!doc) return;
    doc.querySelectorAll('[data-b].sel').forEach((e) => e.classList.remove('sel'));
    if (S.sel) { const el = doc.querySelector(`[data-b="${S.sel}"]`); if (el) { el.classList.add('sel'); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } }
  }
  function select(id) {
    S.sel = id; redrawList(); redrawProps(); markSel();
    if (blk() && blk().type === 'products') loadProducts();
  }
  async function loadProducts() {
    if (S.products) return;
    try { S.products = await api('/api/products'); } catch { S.products = []; }
    if (blk() && blk().type === 'products') redrawProps();
  }
  function changed(structural) {
    if (structural) { redrawList(); redrawProps(); } else {
      // yalnızca seçili satırın özetini güncelle (yazarken odağı kaybetmemek için)
      const b = blk(); const row = b && root.querySelector(`.ms-blk[data-id="${b.id}"] small`); if (row) row.textContent = label(b);
    }
    refresh();
  }

  async function save() {
    try {
      const { template } = await api('/api/admin/mail/templates/' + S.tpl.id, { method: 'PUT', body: S.tpl });
      const sel = S.sel; S.tpl = template; S.saved = JSON.stringify(template); S.sel = template.blocks.some((b) => b.id === sel) ? sel : null;
      toast('Kaydedildi ✓'); refresh(true);
      loadHome();
      return true;
    } catch (e) { fail(e); return false; }
  }

  /* ---------------- görev penceresi ---------------- */
  function ruleModal({ rule, trigger, templateId }) {
    const d = S.home; if (!d || !d.templates.length) { toast('Önce bir şablon oluştur', true); return; }
    const tomorrow = new Date(Date.now() + 86400e3); tomorrow.setHours(10, 0, 0, 0);
    const f = rule ? { ...rule } : { name: '', templateId: templateId || d.templates[0].id, trigger: trigger || 'signup', audience: 'all', delayMin: trigger === 'inactive' ? 20160 : 0, sendAt: trigger === 'once' ? tomorrow.getTime() : null, quietHours: true, subjectB: null, active: true };
    let custom = f.trigger !== 'once' && !(f.trigger === 'inactive' ? IDLE : DELAYS).some(([m]) => m === f.delayMin);
    let ab = !!f.subjectB; let aud = null; const fired = !!(rule && rule.firedAt);
    const m = document.createElement('div'); m.className = 'ms-modal';
    document.body.appendChild(m);
    const tplOf = () => d.templates.find((t) => t.id === Number(f.templateId));
    const local = (ms) => { if (!ms) return ''; const x = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`; };
    async function loadAud() {
      aud = null;
      if (f.trigger !== 'once' || !tplOf()) return draw();
      try { aud = await api(`/api/admin/mail/audience?audience=${f.audience}&kind=${tplOf().kind}`); } catch { aud = null; }
      draw();
    }
    function draw() {
      const tpl = tplOf();
      const delays = f.trigger === 'inactive' ? IDLE : DELAYS;
      m.innerHTML = `<div class="ms-modal-in" id="section-mail-modal"><h3>${rule ? '⚡ Görevi düzenle' : '⚡ Görev ver'}</h3>
        <div class="ms-2">
          <div class="ms-f"><span>Hangi e-posta?</span><select class="ms-in" data-r="templateId" ${fired ? 'disabled' : ''}>${d.templates.map((t) => `<option value="${t.id}" ${t.id === Number(f.templateId) ? 'selected' : ''}>${esc(t.name)}${t.kind === 'marketing' ? ' · kampanya' : ''}</option>`).join('')}</select></div>
          <div class="ms-f"><span>Görevin adı <small class="ms-help">(isteğe bağlı)</small></span><input class="ms-in" data-r="name" maxlength="80" value="${esc(f.name)}" placeholder="ör. Hoş geldin serisi · 1. gün"/></div>
        </div>
        <div class="ms-f"><span>Ne zaman gitsin?</span><div class="ms-trig">${TRIGGERS.map((t) => `<button data-rt="${t.key}" class="${f.trigger === t.key ? 'on' : ''}" ${fired ? 'disabled' : ''}><span>${t.icon}</span><b>${t.name}</b><small>${t.desc}</small></button>`).join('')}</div></div>
        ${f.trigger === 'once' ? `<div class="ms-2">
            <div class="ms-f"><span>Kime?</span><div class="ms-seg">${AUDIENCES.map(([k, ic, n]) => `<button data-ra="${k}" class="${f.audience === k ? 'on' : ''}" ${fired ? 'disabled' : ''}>${ic} ${n}</button>`).join('')}</div>
              ${aud ? `<div class="ms-aud"><b>≈ ${aud.count.toLocaleString('tr-TR')} kişi</b>${tpl && tpl.kind === 'marketing' && aud.total > aud.count ? `<small class="ms-help"> · ${aud.total - aud.count} kişi kampanya izni vermediği için alamaz</small>` : ''}</div>` : ''}</div>
            <div class="ms-f"><span>Tarih ve saat</span><input class="ms-in" type="datetime-local" data-r="sendAt" value="${local(f.sendAt)}" ${fired ? 'disabled' : ''}/></div></div>`
          : `<div class="ms-f"><span>${f.trigger === 'inactive' ? 'Son siparişten bu yana ne kadar geçince?' : 'Ne kadar sonra?'}</span><div class="ms-chips">
              ${delays.map(([mm, l]) => `<button data-rd="${mm}" class="${!custom && f.delayMin === mm ? 'on' : ''}">${l}</button>`).join('')}<button data-rd="custom" class="${custom ? 'on' : ''}">Özel…</button></div>
              ${custom ? `<div class="ms-row" style="margin-top:8px"><input class="ms-in" style="width:100px" type="number" min="${f.trigger === 'inactive' ? 7 : 0}" max="90" step="0.5" data-r="days" value="${Math.round((f.delayMin / 1440) * 10) / 10 || ''}"/><span class="ms-help">gün ${f.trigger === 'inactive' ? '' : 'sonra'}</span></div>` : ''}</div>`}
        <div>
          <label class="ms-opt"><span class="ms-switch"><input type="checkbox" data-r="quietHours" ${f.quietHours ? 'checked' : ''}/><span></span></span><div><b>🌙 Gece rahatsız etme</b><small>21:00–09:00 arasına denk gelen e-posta sabah 09:00'da gider.</small></div></label>
          <label class="ms-opt"><span class="ms-switch"><input type="checkbox" data-r="ab" ${ab ? 'checked' : ''}/><span></span></span><div><b>🧪 A/B konu testi</b><small>Alıcıların yarısına ikinci bir konu gider; hangisinin daha çok açıldığını görürsün.</small></div></label>
          ${ab ? `<input class="ms-in" data-r="subjectB" maxlength="150" value="${esc(f.subjectB || '')}" placeholder="B konusu, ör. {ad}, bunu kaçırma 👀"/>` : ''}
          <label class="ms-opt"><span class="ms-switch"><input type="checkbox" data-r="active" ${f.active ? 'checked' : ''}/><span></span></span><div><b>▶️ Görev etkin</b><small>Kapalıysa taslak olarak bekler, hiçbir şey gönderilmez.</small></div></label>
        </div>
        <div class="ms-sentence">💬 ${esc(ruleSentence(f, tpl ? tpl.name : '…'))}
          ${tpl && tpl.kind === 'marketing' ? '<div class="ms-help" style="margin-top:6px">📣 Kampanya e-postası: yalnızca izin verenlere gider ve aynı kişiye günde en fazla bir kampanya e-postası gönderilir.</div>' : ''}
          ${!d.ready ? '<div class="ms-help" style="margin-top:6px">⚠️ E-posta servisi bağlı olmadığı için şu an gönderim yapılamaz; görev kaydedilir ve servis bağlanınca çalışır.</div>' : ''}</div>
        <div class="ms-modal-foot"><button class="ms-btn" data-rx="close">Vazgeç</button><button class="ms-btn navy" data-rx="save">${rule ? 'Kaydet' : f.active ? '⚡ Kaydet ve başlat' : 'Taslak olarak kaydet'}</button></div></div>`;
    }
    m.addEventListener('click', async (e) => {
      if (e.target === m) return m.remove();
      const t = e.target.closest('button'); if (!t) return;
      if (t.dataset.rt) { f.trigger = t.dataset.rt; custom = false; if (f.trigger === 'inactive' && f.delayMin < 10080) f.delayMin = 20160; if (f.trigger === 'once' && !f.sendAt) f.sendAt = tomorrow.getTime(); return loadAud(); }
      if (t.dataset.ra) { f.audience = t.dataset.ra; return loadAud(); }
      if (t.dataset.rd) { if (t.dataset.rd === 'custom') custom = true; else { custom = false; f.delayMin = Number(t.dataset.rd); } return draw(); }
      if (t.dataset.rx === 'close') return m.remove();
      if (t.dataset.rx === 'save') {
        const tpl = tplOf();
        const name = (f.name || '').trim() || `${trig(f.trigger).name} · ${tpl ? tpl.name : ''}`.slice(0, 80);
        if (f.trigger === 'once' && !f.sendAt) return toast('Gönderim tarihini seç', true);
        const body = { name, templateId: Number(f.templateId), trigger: f.trigger, audience: f.audience, delayMin: f.trigger === 'once' ? 0 : f.delayMin, sendAt: f.trigger === 'once' ? new Date(f.sendAt).toISOString() : null, quietHours: f.quietHours, subjectB: ab && f.subjectB && f.subjectB.trim() ? f.subjectB.trim() : null, active: f.active };
        if (f.trigger === 'once' && f.active && !fired && aud && !confirm(`${aud.count} kişiye ${fmt(f.sendAt, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })} tarihinde gönderilecek. Onaylıyor musun?`)) return;
        t.disabled = true;
        try {
          if (rule) await api('/api/admin/mail/rules/' + rule.id, { method: 'PATCH', body }); else await api('/api/admin/mail/rules', { method: 'POST', body });
          m.remove(); toast('Görev kaydedildi ⚡'); await loadHome();
          if (S.view === 'home') { S.tab = 'flows'; render(); }
        } catch (err) { t.disabled = false; fail(err); }
      }
    });
    m.addEventListener('input', (e) => {
      const k = e.target.dataset.r; if (!k) return;
      if (k === 'name' || k === 'subjectB') { f[k] = e.target.value; return; }
      if (k === 'days') { f.delayMin = Math.round(Number(e.target.value) * 1440) || 0; return; }
    });
    m.addEventListener('change', (e) => {
      const k = e.target.dataset.r; if (!k) return;
      if (k === 'templateId') { f.templateId = Number(e.target.value); return loadAud(); }
      if (k === 'sendAt') { f.sendAt = e.target.value ? new Date(e.target.value).getTime() : null; return draw(); }
      if (k === 'quietHours' || k === 'active') { f[k] = e.target.checked; return draw(); }
      if (k === 'ab') { ab = e.target.checked; return draw(); }
      if (k === 'days') return draw();
    });
    loadAud();
  }

  async function testSend() {
    if (dirty() && !(await save())) return;
    const last = (() => { try { return localStorage.getItem('ms-test-to') || ''; } catch { return ''; } })();
    const to = prompt('Deneme e-postası hangi adrese gitsin?', last);
    if (!to) return;
    try { localStorage.setItem('ms-test-to', to); } catch { /* yok */ }
    try { await api(`/api/admin/mail/templates/${S.tpl.id}/test`, { method: 'POST', body: { to } }); toast('Deneme e-postası gönderildi: ' + to); } catch (e) { fail(e); }
  }

  /* ---------------- olaylar ---------------- */
  function onClick(e) {
    const t = e.target.closest('[data-a]'); if (!t || !root.contains(t)) return;
    const a = t.dataset.a; const id = Number(t.dataset.id);
    if (t.tagName === 'INPUT') return; // anahtarlar change ile işlenir
    e.preventDefault();
    const d = S.home;
    switch (a) {
      case 'new': return createTpl({});
      case 'starter': return createTpl({ starter: t.dataset.k });
      case 'copy': return createTpl({ copyOf: id });
      case 'edit': return openEditor(id);
      case 'tab': return;
      case 'addrule': return ruleModal({ trigger: t.dataset.t, templateId: Number(t.dataset.tpl) || (S.view === 'edit' ? S.tpl.id : undefined) });
      case 'editrule': return ruleModal({ rule: d.rules.find((r) => r.id === id) });
      case 'delrule': { const r = d.rules.find((x) => x.id === id); if (!r || !confirm(`“${r.name}” görevi silinsin mi? Sıradaki gönderimleri de iptal olur.`)) return; api('/api/admin/mail/rules/' + id, { method: 'DELETE' }).then(loadHome).catch(fail); return; }
      case 'deltpl': { const x = d.templates.find((y) => y.id === id); if (!x || !confirm(`“${x.name}” şablonu silinsin mi?${x.uses ? ` Bu şablonu kullanan ${x.uses} görev de silinir.` : ''}`)) return; api('/api/admin/mail/templates/' + id, { method: 'DELETE' }).then(loadHome).catch(fail); return; }
      case 'log': S.tab = 'log'; S.logRule = id; S.logStatus = ''; return render();
      case 'logclear': S.logRule = null; return renderLog();
      case 'logst': S.logStatus = t.dataset.k; return renderLog();
      case 'cancel': api('/api/admin/mail/sends/' + id, { method: 'DELETE' }).then(renderLog).catch(fail); return;
      // düzenleyici
      case 'back': if (dirty() && !confirm('Kaydedilmemiş değişiklikler kaybolacak. Çıkılsın mı?')) return; S.view = 'home'; S.tpl = null; render(); return loadHome();
      case 'save': return save();
      case 'test': return testSend();
      case 'device': S.device = t.dataset.k; { const f = root.querySelector('#ms-frame'); if (f) f.classList.toggle('phone', S.device === 'phone'); } root.querySelectorAll('[data-a="device"]').forEach((b) => b.classList.toggle('on', b.dataset.k === S.device)); return;
      case 'kind': S.tpl.kind = t.dataset.k; root.querySelectorAll('[data-a="kind"]').forEach((b) => b.classList.toggle('on', b.dataset.k === S.tpl.kind)); return refresh();
      case 'addblock': {
        const mk = meta(t.dataset.type); const nb = { id: rid(), type: t.dataset.type, ...mk.make() };
        const i = S.sel ? S.tpl.blocks.findIndex((b) => b.id === S.sel) + 1 : S.tpl.blocks.length;
        S.tpl.blocks.splice(i, 0, nb); S.sel = nb.id; changed(true);
        if (nb.type === 'products') loadProducts();
        return;
      }
      case 'sel': return select(t.dataset.id);
      case 'up': case 'down': {
        e.stopPropagation();
        const bs = S.tpl.blocks; const i = bs.findIndex((b) => b.id === t.dataset.id); const j = a === 'up' ? i - 1 : i + 1;
        if (i < 0 || j < 0 || j >= bs.length) return; [bs[i], bs[j]] = [bs[j], bs[i]]; return changed(true);
      }
      case 'dup': {
        e.stopPropagation();
        const i = S.tpl.blocks.findIndex((b) => b.id === t.dataset.id); if (i < 0) return;
        const c = JSON.parse(JSON.stringify(S.tpl.blocks[i])); c.id = rid(); S.tpl.blocks.splice(i + 1, 0, c); S.sel = c.id; return changed(true);
      }
      case 'del': {
        e.stopPropagation();
        S.tpl.blocks = S.tpl.blocks.filter((b) => b.id !== t.dataset.id); if (S.sel === t.dataset.id) S.sel = null; return changed(true);
      }
      case 'segk': { const b = blk(); if (!b) return; const val = t.dataset.v; b[t.dataset.k] = /^\d+$/.test(val) ? Number(val) : val; return changed(true); }
      case 'clearbg': { const b = blk(); if (b) b.bg = ''; return changed(true); }
      case 'clearcolor': { const b = blk(); if (b) b.color = ''; return changed(true); }
      case 'addcard': { const b = blk(); b.items = b.items || []; b.items.push({ image: '', title: 'Yeni kart', text: '', link: '' }); return changed(true); }
      case 'delcard': { const b = blk(); b.items.splice(Number(t.dataset.i), 1); return changed(true); }
      case 'pick': { const b = blk(); b.ids = [...(b.ids || []), t.dataset.pid].slice(0, 6); return changed(true); }
      case 'unpick': { const b = blk(); b.ids = (b.ids || []).filter((x) => x !== t.dataset.pid); return changed(true); }
      default: break;
    }
  }
  function onTabClick(e) {
    const t = e.target.closest('[data-tab]'); if (!t || !root.contains(t)) return;
    S.tab = t.dataset.tab; if (S.tab !== 'log') S.logRule = null; render();
  }
  function onInput(e) {
    const el = e.target;
    if (S.view !== 'edit') return;
    if (el.id === 'ms-pq') {
      S.pq = el.value; const pos = el.selectionStart; redrawProps();
      const n = root.querySelector('#ms-pq'); if (n) { n.focus(); n.setSelectionRange(pos, pos); }
      return;
    }
    if (el.dataset.tf) { S.tpl[el.dataset.tf] = el.value; return refresh(); }
    if (el.dataset.th && el.type === 'color') { S.tpl.theme = { ...S.tpl.theme, [el.dataset.th]: el.value }; return refresh(); }
    const b = blk(); if (!b) return;
    if (el.dataset.ci !== undefined) { b.items[Number(el.dataset.ci)][el.dataset.ck] = el.value; return changed(false); }
    const k = el.dataset.k; if (!k || el.type === 'checkbox') return;
    b[k] = el.dataset.num ? Number(el.value) : el.value;
    if (el.dataset.num) { const rv = root.querySelector(`[data-rv="${k}"]`); if (rv) rv.textContent = el.value + (rv.textContent.replace(/[\d.]/g, '')); }
    changed(false);
  }
  async function onChange(e) {
    const el = e.target;
    if (el.dataset.a === 'toggle') {
      const r = S.home.rules.find((x) => x.id === Number(el.dataset.id));
      try { await api('/api/admin/mail/rules/' + r.id, { method: 'PATCH', body: { active: el.checked } }); toast(el.checked ? 'Görev başladı ▶️' : 'Görev durduruldu'); loadHome(); } catch (err) { el.checked = !el.checked; fail(err); }
      return;
    }
    if (S.view !== 'edit') return;
    if (el.dataset.th && el.type === 'checkbox') { S.tpl.theme = { ...S.tpl.theme, [el.dataset.th]: el.checked }; return refresh(); }
    if (el.dataset.upload && el.files && el.files[0]) {
      const fd = new FormData(); fd.append('image', el.files[0]);
      try {
        const d = await api('/api/app-config/admin/upload', { method: 'POST', body: fd });
        const b = blk(); if (!b) return;
        if (el.dataset.upload.startsWith('card:')) b.items[Number(el.dataset.upload.slice(5))].image = d.url; else b[el.dataset.upload] = d.url;
        changed(true); toast('Görsel yüklendi');
      } catch (err) { fail(err); }
      return;
    }
    const b = blk(); if (!b) return;
    if (el.type === 'checkbox' && el.dataset.k) { b[el.dataset.k] = el.checked; return changed(false); }
    // görsel adresi elle değişince küçük resmi güncelle (yalnızca görsel alanında; diğer alanlarda odak bozulmasın)
    const box = el.closest('.ms-img'); const th = box && box.querySelector('.th');
    if (th) th.innerHTML = el.value ? `<img src="${esc(el.value)}" alt=""/>` : '🖼';
  }

  window.loadMailStudio = function () {
    root = document.getElementById('section-mail');
    if (!root) return;
    if (!root.dataset.bound) {
      root.dataset.bound = '1';
      root.addEventListener('click', onTabClick);
      root.addEventListener('click', onClick);
      root.addEventListener('input', onInput);
      root.addEventListener('change', onChange);
      window.addEventListener('beforeunload', (e) => { if (S.view === 'edit' && dirty()) { e.preventDefault(); e.returnValue = ''; } });
    }
    render();
    loadHome();
  };
})();
