// ==UserScript==
// @name         Vesikalık – e-Okul fotoğraf yükleyici
// @namespace    https://karadenizmehmet-debug.github.io/Bgremover/
// @version      0.1.0
// @description  Vesikalık uygulamasında hazırlanan öğrenci fotoğraflarını e-Okul'da açık öğrencinin fotoğraf kutusuna okul numarasına göre yerleştirir. Kaydet / Yükle düğmesine öğretmen basar.
// @author       Mehmet Karadeniz, 2026-2027
// @match        https://e-okul.meb.gov.tr/*
// @match        https://*.e-okul.meb.gov.tr/*
// @match        https://karadenizmehmet-debug.github.io/Bgremover/*
// @match        https://karadenizmehmet-debug.github.io/bgremover/*
// @updateURL    https://karadenizmehmet-debug.github.io/Bgremover/eokul-foto.user.js
// @downloadURL  https://karadenizmehmet-debug.github.io/Bgremover/eokul-foto.user.js
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // ---------- Vesikalık uygulaması sayfası: fotoğrafları al (sayfa içinde kalır, sunucuya gitmez) ----------
  function uygulamaKoprusu() {
    const yolla = o => window.postMessage(JSON.stringify(Object.assign({ vfY: o.tur }, o)), location.origin);
    const durumYolla = () => {
      const v = kayitli();
      yolla({ tur: 'durum', surum: GM_info.script.version, adet: v ? v.fotolar.length : 0, yuklenen: yuklenenler().size });
    };
    window.addEventListener('message', e => {
      if (e.origin !== location.origin || typeof e.data !== 'string' || !e.data.startsWith('{"vfU"')) return;
      let m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.vfU === 'sor') durumYolla();
      if (m.vfU === 'gonder' && Array.isArray(m.fotolar)) {
        GM_setValue('fotolar', JSON.stringify({ zaman: Date.now(), fotolar: m.fotolar }));
        GM_setValue('yuklenen', '[]');   // yeni gönderim: yüklenenler listesi sıfırlanır
        yolla({ tur: 'gonderildi', adet: m.fotolar.length });
      }
    });
    durumYolla();
  }

  function kayitli() {
    try { const v = JSON.parse(GM_getValue('fotolar', 'null')); return v && Array.isArray(v.fotolar) ? v : null; } catch (e) { return null; }
  }
  const yuklenenler = () => { try { return new Set(JSON.parse(GM_getValue('yuklenen', '[]'))); } catch (e) { return new Set(); } };
  const yuklendi = no => { const s = yuklenenler(); s.add(String(no)); GM_setValue('yuklenen', JSON.stringify([...s])); };

  if (/^https:\/\/karadenizmehmet-debug\.github\.io\/bgremover\//i.test(location.href)) { uygulamaKoprusu(); return; }

  // ---------- e-Okul sayfası ----------
  // Sayfa ve aynı kökenli iç çerçeveler
  function belgeler(d = document, out = []) {
    out.push(d);
    for (const f of d.querySelectorAll('iframe,frame')) { try { if (f.contentDocument) belgeler(f.contentDocument, out); } catch (e) { /* farklı köken */ } }
    return out;
  }
  const gorunur = el => !!(el.offsetParent || el.getClientRects().length);
  const dosyaKutulari = () => belgeler().flatMap(d => [...d.querySelectorAll('input[type=file]')]).filter(i => !i.disabled && !i.closest('#vf-panel'));

  // Öğrenci seçim kutusu: seçeneklerinin çoğu "1234 AD SOYAD" ya da "AD SOYAD (1234)" biçiminde olan <select>
  // Addan önceki son sayı okul numarasıdır ("3 - 1234 AHMET" → 1234; sıra no alınırsa yanlış öğrenciye yüklenir).
  // Ad numaradan önce geliyorsa ("AHMET YILMAZ (1234)") addan sonraki ilk sayı alınır.
  const secenekNo = t => {
    t = t || ''; const h = t.search(/[A-Za-zÇĞİÖŞÜçğıöşü]{2,}/);
    const once = (h < 0 ? t : t.slice(0, h)).match(/\d{1,6}/g);
    if (once) return once[once.length - 1];
    const sonra = h >= 0 && /\d{1,6}/.exec(t.slice(h));
    return sonra ? sonra[0] : null;
  };
  const harfli = t => /[A-Za-zÇĞİÖŞÜçğıöşü]{2,}/.test(t || '');
  function ogrenciSecimi() {
    let en = null;
    for (const d of belgeler()) for (const s of d.querySelectorAll('select')) {
      const ops = [...s.options].filter(o => secenekNo(o.text) && harfli(o.text));
      if (ops.length >= 3 && (!en || ops.length > en.ops.length)) en = { s, ops };
    }
    return en;
  }
  // Sayfada açık öğrencinin okul numarası. Bulunamazsa null (yanlış öğrenciye yüklememek için tahmin yapılmaz).
  function acikOgrenciNo() {
    const sec = ogrenciSecimi();
    if (sec && sec.s.selectedIndex >= 0) { const o = sec.s.options[sec.s.selectedIndex]; const n = secenekNo(o.text); if (n && harfli(o.text)) return { no: n, kaynak: 'öğrenci seçimi: ' + o.text.trim() }; }
    for (const d of belgeler()) {
      // "Okul No: 1234" / "Öğrenci No 1234" yazısı
      const t = (d.body ? d.body.innerText : '') || '';
      // yalnız aynı satırda ve iki noktalı ("Okul No: 1234"); farklı numaralar varsa (liste sayfası) belirsiz sayılır
      const ms = [...t.matchAll(/(okul|öğrenci|ogrenci)[ \t]*(no|numarası|numarasi)[ \t]*[:：][ \t]*(\d{1,6})/gi)];
      const farkli = [...new Set(ms.map(m => m[3]))];
      if (farkli.length === 1) return { no: farkli[0], kaynak: 'sayfa yazısı: ' + ms[0][0].replace(/\s+/g, ' ') };
      // adı/kimliği numara olan kutu
      for (const i of d.querySelectorAll('input')) {
        if (/okulno|ogrno|ogrencino|ogrenci_no|okul_no/i.test((i.id || '') + (i.name || '')) && /^\d{1,6}$/.test((i.value || '').trim())) return { no: i.value.trim(), kaynak: 'kutu: ' + (i.id || i.name) };
      }
    }
    return null;
  }

  function b64Dosya(f) {
    const ikili = atob(f.b64), u = new Uint8Array(ikili.length);
    for (let i = 0; i < ikili.length; i++) u[i] = ikili.charCodeAt(i);
    return new File([u], f.dosya || (f.no + '.jpg'), { type: 'image/jpeg' });
  }
  function yerlestir(kutu, f) {
    const dt = new DataTransfer();
    dt.items.add(b64Dosya(f));
    kutu.files = dt.files;
    kutu.dispatchEvent(new Event('input', { bubbles: true }));
    kutu.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function zipOku(u) {
    const dv = new DataView(u.buffer, u.byteOffset, u.byteLength), td = new TextDecoder('utf-8'), out = [];
    let i = 0;
    while (i + 30 <= u.length && dv.getUint32(i, true) === 0x04034b50) {
      const yontem = dv.getUint16(i + 8, true), boy = dv.getUint32(i + 18, true), nl = dv.getUint16(i + 26, true), el = dv.getUint16(i + 28, true);
      const ad = td.decode(u.subarray(i + 30, i + 30 + nl)), bas = i + 30 + nl + el;
      if (yontem === 0 && /\.jpe?g$/i.test(ad) && !/(^|\/)orijinal\//i.test(ad)) {
        const dosya = ad.split('/').pop(), m = /^(\d{1,6})[ _-]*(.*?)\.jpe?g$/i.exec(dosya);
        if (m) {
          const veri = u.subarray(bas, bas + boy); let b = '';
          for (let k = 0; k < veri.length; k += 0x8000) b += String.fromCharCode.apply(null, veri.subarray(k, k + 0x8000));
          out.push({ no: m[1], ad: m[2].replace(/_/g, ' ').trim(), cls: ad.includes('/') ? ad.split('/')[0] : '', dosya, b64: btoa(b) });
        }
      }
      i = bas + boy;
    }
    return out;
  }
  // e-Okul'daki Kaydet / Yükle düğmeleri (öğretmen basar; vurgulanır)
  function kaydetDugmeleri() {
    return belgeler().flatMap(d => [...d.querySelectorAll('input[type=submit],input[type=button],button,a')])
      .filter(b => gorunur(b) && /kaydet|yükle|yukle|güncelle|guncelle/i.test((b.value || b.textContent || '').trim()));
  }

  // e-Okul masaüstü düzeni telefonda küçük görünür: panel yakınlaştırmadan bağımsız normal boyutta dursun
  function yerlestirKur(p) {
    const v = window.visualViewport; if (!v) return;
    p.style.position = 'absolute'; p.style.right = 'auto'; p.style.bottom = 'auto'; p.style.transformOrigin = '0 0';
    let bekliyor = false;
    const yer = () => {
      bekliyor = false;
      const k = 1 / v.scale, ekranGen = v.width * v.scale, acik = p.classList.contains('acik');
      p.style.width = (acik ? Math.min(420, ekranGen - 20) : 150) + 'px';
      p.style.transform = `scale(${k})`;
      const kutu = p.querySelector('.vf-kutu'); if (kutu) kutu.style.maxHeight = Math.max(200, v.height * v.scale - 110) + 'px';
      const r = p.getBoundingClientRect();
      p.style.left = (v.pageLeft + v.width - r.width - 10 * k) + 'px';
      p.style.top = (acik ? v.pageTop + 10 * k : v.pageTop + v.height - r.height - 130 * k) + 'px';
    };
    const iste = () => { if (!bekliyor) { bekliyor = true; requestAnimationFrame(yer); } };
    v.addEventListener('resize', iste); v.addEventListener('scroll', iste); window.addEventListener('scroll', iste);
    new MutationObserver(iste).observe(p, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true, characterData: true });
    yer();
  }

  function paneliKur() {
    if (document.getElementById('vf-panel')) return;
    const p = document.createElement('div');
    p.id = 'vf-panel';
    p.innerHTML = `
      <style>
        #vf-panel{position:fixed;right:10px;bottom:70px;text-align:right;pointer-events:none;z-index:2147483647;font:14px system-ui,sans-serif}
        #vf-panel>*{pointer-events:auto}
        #vf-panel .vf-ac{background:#0c4a6e;color:#fff;border:0;border-radius:22px;padding:10px 16px;font-weight:600;box-shadow:0 2px 8px #0004}
        #vf-panel .vf-kutu{text-align:left;display:none;overflow:auto;box-sizing:border-box;background:#fff;color:#1d2430;width:100%;padding:12px;border-radius:12px;box-shadow:0 4px 16px #0005;margin-bottom:8px}
        #vf-panel.acik .vf-kutu{display:block}
        #vf-panel button.vf-b{width:100%;margin-top:6px;padding:10px;border-radius:8px;border:1px solid #ccd;background:#f4f6f9;color:#1d2430;font-weight:600}
        #vf-panel button.vf-b.ana{background:#0c4a6e;color:#fff;border-color:#0c4a6e;font-size:15px}
        #vf-panel select{width:100%;padding:8px;margin-top:6px}
        #vf-panel .vf-s{font-size:12px;color:#555;margin-top:6px;white-space:pre-line}
        #vf-panel .vf-hazir{background:#e0f2fe;border-radius:8px;padding:8px;margin-top:8px;font-size:13px;white-space:pre-line}
        #vf-panel .vf-x{float:right;border:0;background:none;font-size:18px;line-height:1;color:#555}
        #vf-panel img{display:block;width:66px;height:85px;object-fit:cover;border-radius:4px;float:right;margin:0 0 6px 8px;border:1px solid #ccd}
      </style>
      <div class="vf-kutu">
        <button class="vf-x" id="vf-kapat" aria-label="Kapat">✕</button>
        <b>Vesikalık → e-Okul</b>
        <div class="vf-hazir" id="vf-hazir"></div>
        <button class="vf-b" id="vf-zipb">📦 ZIP'ten fotoğrafları al</button>
        <input type="file" id="vf-zip" accept=".zip,application/zip" style="display:none">
        <button class="vf-b ana" id="vf-yerlestir">Fotoğrafı yerleştir</button>
        <div class="vf-s" id="vf-durum" style="color:#0c4a6e;font-weight:600"></div>
        <button class="vf-b" id="vf-sonraki">Sonraki öğrenciye geç ▶</button>
        <div class="vf-s">Numara bulunamazsa fotoğrafı elle seç:</div>
        <select id="vf-elle"></select>
        <div class="vf-s" id="vf-tani"></div>
      </div>
      <button class="vf-ac" id="vf-ac">📷 Fotoğraf</button>`;
    document.documentElement.appendChild(p);
    yerlestirKur(p);
    const $ = s => p.querySelector(s);
    const durum = t => { $('#vf-durum').textContent = t; };
    let hedef = null;   // bu sayfada yerleştirilen fotoğraf

    function ciz() {
      const v = kayitli(), y = yuklenenler();
      const h = $('#vf-hazir'); h.innerHTML = '';
      if (!v) { h.textContent = 'Uygulamadan gönderilmiş fotoğraf yok. Vesikalık uygulamasında “🏫 e-Okul’a gönder”e basın.'; }
      else {
        const acik = acikOgrenciNo(), f = acik && v.fotolar.find(x => x.no === acik.no);
        if (f) { const im = document.createElement('img'); im.src = 'data:image/jpeg;base64,' + f.b64; h.appendChild(im); }
        h.append(`${v.fotolar.length} fotoğraf · ${y.size} yüklendi\n` +
          (acik ? `Açık öğrenci: ${acik.no}${f ? ' · ' + f.ad : ' (fotoğrafı yok)'}${y.has(acik.no) ? ' ✓ yüklendi' : ''}` : 'Açık öğrencinin numarası bulunamadı.'));
      }
      const sel = $('#vf-elle'), eski = sel.value;
      sel.innerHTML = '<option value="">— seç —</option>' + (v ? v.fotolar.map((f, i) => `<option value="${i}">${y.has(f.no) ? '✓ ' : ''}${f.no} ${String(f.ad || '').replace(/[<>&"]/g, '')}</option>`).join('') : '');
      sel.value = eski;
      const sec = ogrenciSecimi(), acik = acikOgrenciNo();
      $('#vf-tani').textContent = `Sayfada: ${dosyaKutulari().length} dosya kutusu · öğrenci seçimi ${sec ? 'var (' + sec.ops.length + ')' : 'yok'} · numara ${acik ? acik.kaynak : 'bulunamadı'}`;
    }
    function ac() { ciz(); p.classList.add('acik'); }

    function yerlestirFoto(f) {
      const kutu = dosyaKutulari()[0];
      if (!kutu) { durum('Bu sayfada fotoğraf seçme kutusu yok. e-Okul’da öğrencinin fotoğraf ekranını açın.'); return false; }
      try { yerlestir(kutu, f); } catch (e) { durum('Kutuya yerleştirilemedi: ' + (e.message || e)); return false; }
      hedef = f;
      kaydetDugmeleri().forEach(b => { b.style.outline = '4px solid #f59e0b'; b.style.outlineOffset = '2px'; });
      kutu.style.outline = '3px solid #22c55e';
      durum(`${f.no} ${f.ad || ''} fotoğrafı yerleştirildi.\nKontrol edip e-Okul’daki Kaydet / Yükle düğmesine basın (turuncu).`);
      return true;
    }
    // Uygulamanın indirdiği ZIP (sıkıştırmasız): "1234 AD SOYAD.jpg" dosyaları; orijinal klasörü atlanır
    $('#vf-zipb').addEventListener('click', () => $('#vf-zip').click());
    $('#vf-zip').addEventListener('change', async e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try {
        const fotolar = zipOku(new Uint8Array(await f.arrayBuffer()));
        if (!fotolar.length) { durum('ZIP’te okul numarasıyla başlayan fotoğraf bulunamadı (ör. “1234 AHMET YILMAZ.jpg”).'); return; }
        GM_setValue('fotolar', JSON.stringify({ zaman: Date.now(), fotolar }));
        GM_setValue('yuklenen', '[]');
        durum(fotolar.length + ' fotoğraf alındı.'); ciz();
      } catch (er) { durum('ZIP okunamadı: ' + (er.message || er)); }
    });
    $('#vf-ac').addEventListener('click', () => { if (p.classList.contains('acik')) p.classList.remove('acik'); else ac(); });
    $('#vf-kapat').addEventListener('click', () => p.classList.remove('acik'));
    $('#vf-yerlestir').addEventListener('click', () => {
      const v = kayitli(); if (!v) { durum('Önce uygulamada “🏫 e-Okul’a gönder”e basın.'); return; }
      const acik = acikOgrenciNo();
      if (!acik) { durum('Açık öğrencinin numarası bulunamadı. Aşağıdan fotoğrafı elle seçin.'); return; }
      const f = v.fotolar.find(x => x.no === acik.no);
      if (!f) { durum(`${acik.no} numaralı öğrencinin fotoğrafı uygulamadan gelmedi.`); return; }
      yerlestirFoto(f);
    });
    $('#vf-elle').addEventListener('change', e => {
      const v = kayitli(), f = v && v.fotolar[+e.target.value]; if (!f) return;
      const acik = acikOgrenciNo();
      if (acik && acik.no !== f.no && !confirm(`Sayfadaki öğrenci ${acik.no}, seçtiğiniz fotoğraf ${f.no}. Yine de yerleştirilsin mi?`)) { e.target.value = ''; return; }
      yerlestirFoto(f);
    });
    // Kaydet / Yükle'ye basılınca o öğrenci yüklendi sayılır
    belgeler().forEach(d => d.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('input,button,a');
      if (b && hedef && /kaydet|yükle|yukle|güncelle|guncelle/i.test((b.value || b.textContent || '').trim())) {
        yuklendi(hedef.no); GM_setValue('sonYukleme', JSON.stringify({ no: hedef.no, zaman: Date.now() }));
      }
    }, true));
    // Sonraki öğrenci: öğrenci seçim kutusunda fotoğrafı olan ve henüz yüklenmemiş sıradaki öğrenci seçilir
    $('#vf-sonraki').addEventListener('click', () => {
      const v = kayitli(), sec = ogrenciSecimi();
      if (!sec) { durum('Bu sayfada öğrenci seçim kutusu bulunamadı. Sıradaki öğrenciyi e-Okul’dan açın; fotoğraf kendiliğinden yerleşir.'); return; }
      const y = yuklenenler(), var_ = new Set(v ? v.fotolar.map(f => f.no) : []);
      const opts = [...sec.s.options];
      for (let k = 1; k <= opts.length; k++) {
        const o = opts[(sec.s.selectedIndex + k) % opts.length], n = secenekNo(o.text);
        if (n && harfli(o.text) && var_.has(n) && !y.has(n)) {
          sec.s.value = o.value;
          sec.s.dispatchEvent(new Event('change', { bubbles: true }));   // e-Okul sayfayı yeniler; fotoğraf yerleşir
          durum('Açılıyor: ' + o.text.trim());
          return;
        }
      }
      durum('Fotoğrafı olup yüklenmemiş öğrenci kalmadı. ✓');
    });

    // Sayfa açılınca: açık öğrencinin fotoğrafı varsa ve yüklenmediyse kendiliğinden kutuya koy (Kaydet'e öğretmen basar)
    const v = kayitli(), acik = acikOgrenciNo();
    if (v && acik && dosyaKutulari().length) {
      ac();
      const f = v.fotolar.find(x => x.no === acik.no);
      if (f && !yuklenenler().has(f.no)) yerlestirFoto(f);
    }
  }

  // Panel yalnızca fotoğraf kutusu olan e-Okul sayfasında kendiliğinden açılır; menüden her zaman açılabilir
  let zaman = null;
  const gozcu = new MutationObserver(() => { clearTimeout(zaman); zaman = setTimeout(dene, 700); });
  function dene() {
    if (document.getElementById('vf-panel')) { gozcu.disconnect(); return; }
    if (dosyaKutulari().length) { paneliKur(); gozcu.disconnect(); }
  }
  dene();
  if (!document.getElementById('vf-panel')) gozcu.observe(document.documentElement, { childList: true, subtree: true });
  try { GM_registerMenuCommand('Vesikalık fotoğraf panelini aç', () => { paneliKur(); document.getElementById('vf-ac').click(); }); } catch (e) { /* menü desteklenmiyor */ }
})();
