// ==UserScript==
// @name         Vesikalık – e-Okul fotoğraf yükleyici
// @namespace    https://karadenizmehmet-debug.github.io/Bgremover/
// @version      0.3.16
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
  // dönem / öğretim yılı ("2026-2027 I. Dönem") ve sınıf/şube ("6. Sınıf / A Şubesi") seçenekleri öğrenci değildir;
  // yoksa yıl ya da sınıf numarası okul no sanılır
  const donemMi = t => /\b(19|20)\d\d\s*[-–\/]\s*(19|20)?\d\d\b|dönem|donem|yılı|yili|ders\s*yılı|s[ıi]n[ıi]f|şube|sube/i.test(t || '');
  // e-Okul "Öğrenci Fotoğrafları" sayfası: her öğrenci bir kart, başlığı "1-ARDA ÇAMLI" (okul no - AD SOYAD), altında düzenle simgesi
  const KART_RE = /^\s*(\d{1,6})\s*[-–]\s*([A-ZÇĞİÖŞÜ]{2,}(?:\s+[A-ZÇĞİÖŞÜ]{2,})+)\s*$/;
  // yazı: <br> ve iç içe etiketler boşlukla ayrılır ("1-ARDA<br>ÇAMLI", "1-<span>ARDA</span> ÇAMLI" → "1-ARDA ÇAMLI")
  const kartYazi = el => { let t = ''; for (const n of el.childNodes) t += n.nodeType === 3 ? n.data : n.nodeType === 1 ? (n.tagName === 'BR' ? ' ' : ' ' + kartYazi(n) + ' ') : ''; return t.replace(/\s+/g, ' ').trim(); };
  function kartlar() {
    const bas = [];
    for (const d of belgeler()) for (const el of d.querySelectorAll('body *')) {
      if (/^(SCRIPT|STYLE|SELECT|OPTION|TEXTAREA)$/.test(el.tagName)) continue;
      const tc = el.textContent || '';
      if (tc.length > 90 || !/\d\s*[-–]\s*[A-ZÇĞİÖŞÜ]/.test(tc) || el.closest('#vf-panel')) continue;
      const m = KART_RE.exec(kartYazi(el));
      if (m) bas.push({ el, m });
    }
    // en içteki eşleşme başlıktır (içinde başka eşleşen öğe olmayan)
    const baslik = bas.filter(x => !bas.some(y => y !== x && x.el.contains(y.el)) && gorunur(x.el));
    const els = baslik.map(x => x.el), out = [];
    for (const { el, m } of baslik) {
      // kart: başlığı içeren, başka öğrenci başlığı içermeyen en geniş ata
      let kart = el;
      for (let k = 0; k < 8 && kart.parentElement && kart.parentElement.tagName !== 'BODY'; k++) {
        const ust = kart.parentElement;
        if (els.some(x => x !== el && ust.contains(x))) break;
        kart = ust;
      }
      const tik = kart.querySelector('a,button,[onclick],[data-toggle],[data-bs-toggle],[role=button]') || kart.querySelector('i,svg');
      out.push({ no: m[1], ad: m[2], el, kart, tik });
    }
    return out;
  }
  // kullanıcının (ya da "Sonraki"nin) en son dokunduğu öğrenci kartı: düzenle penceresi o öğrencinindir
  // düzenle yeni sayfa açarsa kaybolmasın diye saklanır
  let sonKart = (() => { try { return JSON.parse(GM_getValue('sonKart', 'null')); } catch (e) { return null; } })();
  const kartSec = k => { sonKart = { no: k.no, ad: k.ad, zaman: Date.now() }; GM_setValue('sonKart', JSON.stringify(sonKart)); };
  function ogrenciSecimi() {
    let en = null;
    for (const d of belgeler()) for (const s of d.querySelectorAll('select')) {
      const ops = [...s.options].filter(o => secenekNo(o.text) && harfli(o.text) && !donemMi(o.text));
      if (ops.length >= 3 && (!en || ops.length > en.ops.length)) en = { s, ops };
    }
    return en;
  }
  // Sayfada açık öğrencinin okul numarası. Bulunamazsa null (yanlış öğrenciye yüklememek için tahmin yapılmaz).
  function acikOgrenciNo() {
    const sec = ogrenciSecimi();
    if (sec && sec.s.selectedIndex >= 0) { const o = sec.s.options[sec.s.selectedIndex]; const n = secenekNo(o.text); if (n && harfli(o.text) && !donemMi(o.text)) return { no: n, kaynak: 'öğrenci seçimi: ' + o.text.trim() }; }
    // e-Okul "Öğrenci Resim İşlemleri": Öğrenci Bilgileri bölümünde "Okul No" etiketi, yanındaki kutuda numara
    for (const d of belgeler()) for (const el of d.querySelectorAll('td,th,span,label,div')) {
      if (el.children.length > 2 || el.closest('#vf-panel') || !/^\s*(okul|öğrenci)\s*no\s*:?\s*$/i.test(el.textContent)) continue;
      let n = el.nextElementSibling;
      for (let k = 0; k < 3 && n; k++, n = n.nextElementSibling) {
        const i = n.matches('input') ? n : n.querySelector('input');
        const v = ((i ? i.value : n.textContent) || '').trim();
        if (/^\d{1,6}$/.test(v)) return { no: v, kaynak: 'Okul No alanı' };
        if (v && !/^[:：\s]+$/.test(v)) break;   // aradaki ":" hücresi atlanır
      }
    }
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
    // sayfada numara yazmıyorsa: listede son dokunulan öğrenci (sarı simge / kart, 10 dk içinde)
    if (sonKart && Date.now() - sonKart.zaman < 600000) return { no: sonKart.no, kaynak: 'dokunulan: ' + sonKart.no + '-' + sonKart.ad };
    // sayfada tek öğrenci kartı varsa onun numarası
    { const K = kartlar(), farkli = [...new Set(K.map(k => k.no))];
      if (farkli.length === 1) return { no: farkli[0], kaynak: 'başlık: ' + K[0].no + '-' + K[0].ad }; }
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
  // simge düğmeler (araç çubuğundaki disket) için title / alt / id de okunur; sil / iptal asla seçilmez
  const dugmeYazi = b => [b.value, b.textContent, b.title, b.alt, b.id, b.getAttribute && b.getAttribute('aria-label'), b.querySelector && b.querySelector('img') && (b.querySelector('img').title || b.querySelector('img').alt)].filter(Boolean).join(' ').trim();
  // Simge görselin adresi / arka planı (araç çubuğundaki disket: save.png, kaydet.gif gibi)
  const simgeAdres = b => { const im = b.matches && b.matches('img,input[type=image]') ? b : b.querySelector && b.querySelector('img'); let u = im ? (im.getAttribute('src') || '') : ''; try { u += ' ' + getComputedStyle(b).backgroundImage; } catch (e) {} return u; };
  // Öğretmenin bir kez dokunarak tanıttığı Kaydet düğmesi (sayfa yenilense de aynı yol ile bulunur)
  function secici(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    const yol = [];
    for (let e = el; e && e.nodeType === 1 && e !== e.ownerDocument.body; e = e.parentElement) {
      if (e.id) { yol.unshift('#' + CSS.escape(e.id)); break; }
      let i = 1; for (let k = e.previousElementSibling; k; k = k.previousElementSibling) if (k.tagName === e.tagName) i++;
      yol.unshift(e.tagName.toLowerCase() + ':nth-of-type(' + i + ')');
    }
    return yol.join('>');
  }
  function tanitilanKaydet() {
    const sc = GM_getValue('kaydetSecici', '');
    if (!sc) return null;
    for (const d of belgeler()) { try { const el = d.querySelector(sc); if (el && gorunur(el)) return el; } catch (e) { /* geçersiz */ } }
    return null;
  }
  function kaydetDugmeleri() {
    const satirlar = listeSatirlari().map(r => r.tr), listede = b => satirlar.some(tr => tr.contains(b));
    const t = tanitilanKaydet(); if (t && !listede(t)) return [t];
    // araç çubuğundaki disket: src, arka plan resmi, id, title, alt ya da sınıfında kaydet/save/disk geçen öğe
    const adres = belgeler().flatMap(d => [...d.querySelectorAll('a,input[type=image],img,button,[onclick],td[title],span[title],div[title]')])
      .filter(b => gorunur(b) && !b.closest('#vf-panel') && !listede(b) && /save|kaydet|disk/i.test(simgeAdres(b) + ' ' + (b.id || '') + ' ' + (b.title || '') + ' ' + (b.alt || '') + ' ' + (typeof b.className === 'string' ? b.className : '')) && !/_d\.(jpe?g|gif|png)/i.test(simgeAdres(b)) && !/sil|delete|iptal|cancel/i.test((simgeAdres(b) + ' ' + dugmeYazi(b)).toLocaleLowerCase('tr')));
    if (adres.length) return adres.map(b => (b.matches('img') && b.closest('a')) || b);
    return belgeler().flatMap(d => [...d.querySelectorAll('input[type=submit],input[type=button],input[type=image],button,a')])
      .filter(b => gorunur(b) && !b.closest('#vf-panel') && !listede(b) && /kaydet|yükle|yukle|güncelle|guncelle|save/i.test(dugmeYazi(b)) && !/sil|delete|iptal|vazgeç|vazgec/i.test(dugmeYazi(b)));
  }
  // "Sınıf Listesi" tablosu: başlığında "Okul No" olan tablo; her satırın başındaki sarı simgeyle öğrenci açılır
  const hucreYazi = c => { let el = c; if (c.querySelector('table')) { el = c.cloneNode(true); el.querySelectorAll('table').forEach(t => t.remove()); } return el.textContent.trim().replace(/\s+/g, ' '); };
  function listeSatirlari() {
    let en = [];
    for (const d of belgeler()) for (const t of d.querySelectorAll('table')) {
      if (t.closest('#vf-panel')) continue;
      let idx = -1, bas = null;
      for (const r of t.rows) { const i = [...r.cells].findIndex(c => /^okul\s*no$/i.test(hucreYazi(c))); if (i >= 0 && r.cells.length > 2) { idx = i; bas = r; break; } }
      if (idx < 0) continue;
      const satir = [];
      for (const r of t.rows) {
        if (r === bas || r.cells.length <= idx || r.querySelector('table')) continue;
        const no = hucreYazi(r.cells[idx]);
        if (!/^\d{1,6}$/.test(no)) continue;
        // En içteki öğe tıklanır: <a href><img onclick></a> düzeninde <a>'ya basmak img'nin işini yapmıyordu.
        // img'ye basılınca olay <a>'ya da ulaşır. İkinci aday, ilki işe yaramazsa denenir.
        const ic = r.querySelector('img[onclick],input[type=image],img'), dis = r.querySelector('a,[onclick]');
        const tik = ic || dis;
        if (tik) satir.push({ tr: r, no, tik, tik2: dis && dis !== tik ? dis : null });
      }
      if (satir.length > en.length) en = satir;
    }
    return en;
  }

  // satırdaki ad soyad: rakam olmayan, harfli hücreler (T.C. no, okul no, sınıf hariç)
  const satirAd = r => [...r.tr.cells].map(hucreYazi).filter(t => /^[A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜa-zçğıöşü .'-]*$/.test(t) && !donemMi(t)).join(' ');
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
        <label class="vf-s" style="display:flex;gap:6px;align-items:flex-start;color:#1d2430"><input type="checkbox" id="vf-oto" style="margin-top:2px"> <span><b>Tam otomatik:</b> numarası doğrulanan öğrencide Kaydet’e de bas ve sıradakine geç. Durdurmak için işareti kaldır.</span></label>
        <button class="vf-b" id="vf-tanit">📌 Kaydet düğmesini tanıt</button>
        <div class="vf-s">Numara bulunamazsa fotoğrafı elle seç:</div>
        <select id="vf-elle"></select>
        <div class="vf-s" id="vf-tani"></div>
        <button class="vf-b" id="vf-kod">📋 Sayfa bilgisini kopyala (destek için)</button>
        <textarea id="vf-kodt" readonly style="display:none;width:100%;height:90px;font-size:11px"></textarea>
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
      $('#vf-tani').textContent = `Sayfada: ${dosyaKutulari().length} dosya kutusu · liste ${listeSatirlari().length} öğrenci · seçim kutusu ${sec ? sec.ops.length : 'yok'} · Kaydet ${kaydetDugmeleri().length} · kart ${kartlar().length}${sonKart ? ' (son dokunulan ' + sonKart.no + ')' : ''} · numara ${acik ? acik.kaynak : 'bulunamadı'}`;
    }
    function ac() { ciz(); p.classList.add('acik'); }

    // Öğrenci Bilgileri'ndeki "Resim" (dosya kutusunun yakınındaki en büyük resim)
    function onizleme() {
      const kutu = dosyaKutulari()[0]; if (!kutu) return null;
      let el = kutu;
      for (let k = 0; k < 7 && el.parentElement; k++) {
        el = el.parentElement;
        const im = [...el.querySelectorAll('img')].filter(i => !i.closest('#vf-panel') && gorunur(i)).sort((a, b) => b.width * b.height - a.width * a.height)[0];
        if (im && im.width >= 60) return im;
      }
      return null;
    }
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
    // kart listesinde dokunulan kartı hatırla (düzenle simgesine basınca açılan pencere o öğrencinin)
    // Hafif tutulur: e-Okul'un kendi tıklamasını bekletmemek için iş tıklamadan sonra yapılır, yalnız dokunulan satıra/karta bakılır.
    belgeler().forEach(d => d.addEventListener('click', e => {
      const t = e.target;
      if (!e.isTrusted || !t || !t.closest || t.closest('#vf-panel')) return;
      setTimeout(() => {
        try {
          // "Sınıf Listesi" tablosunda dokunulan satır (sarı klasör simgesi): aynı tablonun "Okul No" sütunu
          const tr = t.closest('tr'), tablo = tr && tr.closest('table');
          if (tr && tablo) {
            for (const r of tablo.rows) {
              const i = [...r.cells].findIndex(c => /^okul\s*no$/i.test(hucreYazi(c)));
              if (i < 0) continue;
              const no = tr.cells[i] ? hucreYazi(tr.cells[i]) : '';
              if (/^\d{1,6}$/.test(no)) kartSec({ no, ad: satirAd({ tr }) });
              return;
            }
          }
          // kart düzeni: dokunulan öğenin 8 atası içinde "1-ARDA ÇAMLI" başlığı
          let el = t;
          for (let k = 0; k < 8 && el && el.tagName !== 'BODY'; k++, el = el.parentElement) {
            const tc = el.textContent || '';
            if (tc.length > 400) break;
            const m = /(?:^|\s)(\d{1,6})\s*[-–]\s*([A-ZÇĞİÖŞÜ]{2,}(?:\s+[A-ZÇĞİÖŞÜ]{2,})+)/.exec(kartYazi(el));
            if (m) { kartSec({ no: m[1], ad: m[2] }); return; }
          }
        } catch (er) { /* sayfayı bozmasın */ }
      }, 0);
    }, true));
    belgeler().forEach(d => d.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('input,button,a');
      // Sınıf Listesi tablosundaki sarı klasör "Resim Yükle" diye adlandırılmış olabilir: Kaydet sayılmaz
      // (sayılırsa öğrenci yüklendi sanılıp sıradakine geçiliyor, ekran öğrenciden öğrenciye atlıyordu)
      if (!b || b.closest('#vf-panel') || listeSatirlari().some(r => r.tr.contains(b))) return;
      if (hedef && (kaydetDugmeleri().some(k => k === b || k.contains(b)) || /kaydet|güncelle|guncelle/i.test(dugmeYazi(b)))) {
        yuklendi(hedef.no); GM_setValue('sonYukleme', JSON.stringify({ no: hedef.no, zaman: Date.now() }));
      }
    }, true));
    // Sonraki öğrenci: öğrenci seçim kutusunda fotoğrafı olan ve henüz yüklenmemiş sıradaki öğrenci seçilir
    // e-Okul sayfayı göndermeye başladıysa (önizleme / kayıt yükleniyor) bekleyen adımlar iptal: yarıda kesmesinler
    let ayriliyor = false;
    window.addEventListener('beforeunload', () => { ayriliyor = true; });
    window.addEventListener('pagehide', () => { ayriliyor = true; });
    // Döngü sigortası: 40 sn içinde 4'ten fazla öğrenci açılmaya çalışıldıysa tam otomatik durur
    // (sayfa her yüklenişte yeniden öğrenci açıp ekran gelip gitmesin)
    function otoDurdur(t) { GM_setValue('tamOto', false); GM_setValue('otoSon', ''); GM_setValue('sonrakiLog', '[]'); $('#vf-oto').checked = false; ac(); durum(t); }
    function sonraki() {
      let log = []; try { log = JSON.parse(GM_getValue('sonrakiLog', '[]')).filter(z => Date.now() - z < 40000); } catch (e) { log = []; }
      if (log.length >= 4) { otoDurdur('Öğrenciler art arda açılıyor ama fotoğraf ekranı gelmiyor; otomatik durduruldu. Sarı klasöre elle basın.'); return false; }
      log.push(Date.now()); GM_setValue('sonrakiLog', JSON.stringify(log)); GM_setValue('otoZaman', Date.now());
      const v = kayitli(), sec = ogrenciSecimi();
      const y = yuklenenler(), var_ = new Set(v ? v.fotolar.map(f => f.no) : []);
      const L = sec ? [] : listeSatirlari();
      const K = sec || L.length ? [] : kartlar();
      if (K.length) {
        const bas = sonKart ? K.findIndex(k => k.no === sonKart.no) : -1;
        for (let k = 1; k <= K.length; k++) {
          const r = K[(bas + k + K.length) % K.length];
          if (var_.has(r.no) && !y.has(r.no)) {
            if (!r.tik) { durum(r.no + '-' + r.ad + ': düzenle simgesi bulunamadı, elle dokunun.'); kartSec(r); return false; }
            kartSec(r); r.kart.scrollIntoView({ block: 'center' }); durum('Açılıyor: ' + r.no + '-' + r.ad); r.tik.click(); return true;
          }
        }
        durum('Fotoğrafı olup yüklenmemiş öğrenci kalmadı. ✓'); GM_setValue('tamOto', false); $('#vf-oto').checked = false; return false;
      }
      if (!sec && L.length) {
        // tablo sırasıyla baştan: fotoğrafı olup yüklenmemiş ilk öğrenci (eski dokunuş yüzünden öğrenci atlanmasın)
        const bas = -1;
        for (let k = 1; k <= L.length; k++) {
          const r = L[(bas + k + L.length) % L.length];
          if (var_.has(r.no) && !y.has(r.no)) {
            kartSec({ no: r.no, ad: satirAd(r) }); durum('Açılıyor: ' + r.no + ' ' + satirAd(r));
            r.tik.click();
            // 4 sn içinde sayfa gönderilmediyse diğer öğeye bas; o da olmazsa dur
            setTimeout(() => {
              if (ayriliyor) return;
              if (r.tik2) { r.tik2.click(); setTimeout(() => { if (!ayriliyor) otoDurdur(r.no + ' ' + satirAd(r) + ' açılamadı, otomatik durdu. Sarı klasöre elle dokunun.'); }, 4000); }
              else otoDurdur(r.no + ' ' + satirAd(r) + ' açılamadı, otomatik durdu. Sarı klasöre elle dokunun.');
            }, 4000);
            return true;
          }
        }
        durum('Fotoğrafı olup yüklenmemiş öğrenci kalmadı. ✓'); GM_setValue('tamOto', false); $('#vf-oto').checked = false; return false;
      }
      if (!sec) { durum('Bu sayfada öğrenci listesi bulunamadı. Sınıfı seçip Listele’ye basın.'); return false; }
      const opts = [...sec.s.options];
      for (let k = 1; k <= opts.length; k++) {
        const o = opts[(sec.s.selectedIndex + k) % opts.length], n = secenekNo(o.text);
        if (n && harfli(o.text) && var_.has(n) && !y.has(n)) {
          sec.s.value = o.value;
          sec.s.dispatchEvent(new Event('change', { bubbles: true }));   // e-Okul sayfayı yeniler; fotoğraf yerleşir
          durum('Açılıyor: ' + o.text.trim());
          return true;
        }
      }
      durum('Fotoğrafı olup yüklenmemiş öğrenci kalmadı. ✓'); GM_setValue('tamOto', false); $('#vf-oto').checked = false; return false;
    }
    $('#vf-sonraki').addEventListener('click', sonraki);
    // Kaydet tanıtma: sonraki dokunuş kaydetmez, yalnızca düğmeyi öğrenir
    // Destek: fotoğraf kutusu, Resim, Kaydet ve satır düğmelerinin HTML'i ile onları kullanan betik parçaları.
    // Kişisel bilgi (T.C., ad) gizlenir; kopyalanan metin sohbete yapıştırılır.
    $('#vf-kod').addEventListener('click', async () => {
      const gizle = t => String(t || '').replace(/\b\d{11}\b/g, '###########')
        .replace(/value="([^"]*)"/g, (m, v) => /^\d{0,6}$/.test(v) || v.length > 60 ? m : 'value="…"')
        .replace(/>\s*[A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜ ]{1,40}\s*</g, '>…<');
      const kes = (t, n) => (t = String(t || ''), t.length > n ? t.slice(0, n) + '…' : t);
      const out = ['URL: ' + location.pathname, 'Betik: ' + GM_info.script.version];
      const kutu = dosyaKutulari()[0];
      if (kutu) {
        const form = kutu.form;
        out.push('FORM: ' + (form ? kes(form.outerHTML.split('>')[0] + '>', 300) : 'yok'));
        out.push('DOSYA KUTUSU: ' + kutu.outerHTML);
        let el = kutu; for (let k = 0; k < 3 && el.parentElement; k++) el = el.parentElement;
        out.push('KUTU ÇEVRESİ: ' + kes(gizle(el.outerHTML), 3000));
        const im = onizleme(); out.push('RESİM: ' + (im ? kes(im.outerHTML, 400) : 'yok'));
        const adlar = [kutu.id, kutu.name].filter(Boolean);
        for (const d of belgeler()) for (const sc of d.querySelectorAll('script:not([src])')) {
          const t = sc.textContent || '';
          for (const ad of adlar) { let i = t.indexOf(ad); let say = 0; while (i >= 0 && say++ < 3) { out.push('BETİK (' + ad + '): ' + t.slice(Math.max(0, i - 300), i + 500)); i = t.indexOf(ad, i + 500); } }
        }
        out.push('DIŞ BETİKLER: ' + belgeler().flatMap(d => [...d.querySelectorAll('script[src]')].map(x => x.getAttribute('src'))).join(' | '));
      } else out.push('DOSYA KUTUSU: yok');
      const k = kaydetDugmeleri()[0]; out.push('KAYDET: ' + (k ? kes(k.outerHTML, 600) : 'yok'));
      const bar = k && k.parentElement && k.parentElement.parentElement; if (bar) out.push('ARAÇ ÇUBUĞU: ' + kes(bar.outerHTML, 2500));
      const L = listeSatirlari(); if (L[0]) out.push('İLK SATIR: ' + kes(gizle(L[0].tr.outerHTML), 1500));
      const metin = out.join('\n\n');
      const ta = $('#vf-kodt'); ta.style.display = 'block'; ta.value = metin;
      try { await navigator.clipboard.writeText(metin); durum('Sayfa bilgisi kopyalandı (' + metin.length + ' karakter). Sohbete yapıştırın.'); }
      catch (e) { ta.select(); try { document.execCommand('copy'); durum('Sayfa bilgisi kopyalandı. Sohbete yapıştırın.'); } catch (e2) { durum('Kutudaki metni seçip kopyalayın.'); } }
    });
    $('#vf-tanit').addEventListener('click', () => {
      durum('Şimdi e-Okul’daki Kaydet (disket) simgesine bir kez dokunun. Bu dokunuş kaydetmez, sadece düğmeyi öğrenir.');
      p.classList.remove('acik');
      const yakala = e => {
        const el = e.target.closest('a,input,button,img,span,div');
        if (!el || el.closest('#vf-panel')) return;
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        belgeler().forEach(d => d.removeEventListener('click', yakala, true));
        const hedefEl = (el.matches('img') && el.closest('a')) || el;
        GM_setValue('kaydetSecici', secici(hedefEl));
        hedefEl.style.outline = '4px solid #f59e0b';
        ac(); durum('Kaydet düğmesi öğrenildi ✓ (' + (dugmeYazi(hedefEl) || hedefEl.tagName.toLowerCase()) + ')');
      };
      belgeler().forEach(d => d.addEventListener('click', yakala, true));
    });
    $('#vf-oto').checked = !!GM_getValue('tamOto', false);
    $('#vf-oto').addEventListener('change', e => { GM_setValue('tamOto', e.target.checked); GM_setValue('otoSon', ''); if (e.target.checked) { sonKart = null; GM_setValue('sonKart', 'null'); GM_setValue('sonrakiLog', '[]'); GM_setValue('otoZaman', Date.now()); } if (e.target.checked) otomatik(true); });

    // Sayfa açılınca: açık öğrencinin fotoğrafı varsa ve yüklenmediyse kutuya koy.
    // Tam otomatikte: numara yeniden doğrulanır, Kaydet'e basılır; sayfa yenilenince sıradaki öğrenci açılır.
    // Bir şey yolunda gitmezse (kutu / Kaydet yok, numara değişti, aynı öğrenci tekrar geldi) durur ve yazar.
    function otomatik(elle) {
      const v = kayitli(), acik = acikOgrenciNo(), son = GM_getValue('otoSon', '');
      let oto = !!GM_getValue('tamOto', false);
      // tam otomatik sayfa açılışında kendiliğinden başlamaz: son 2 dakikada çalışmıyorsa kapatılır
      if (oto && !elle && Date.now() - (+GM_getValue('otoZaman', 0) || 0) > 120000) { GM_setValue('tamOto', false); $('#vf-oto').checked = false; oto = false; }
      if (!v) return;
      const f = acik && v.fotolar.find(x => x.no === acik.no);
      if (oto && acik && son === acik.no && yuklenenler().has(acik.no)) {   // az önce kaydedilen öğrenci: sıradakine geç
        GM_setValue('otoSon', ''); ac(); durum(acik.no + ' kaydedildi. Sıradaki açılıyor...'); setTimeout(sonraki, 1500); return;
      }
      // Kaydet adımı: numara yeniden doğrulanır; "Onayla" varsa önce ona, sonra Kaydet'e basılır.
      // Kaydet sayfayı yenileyince yukarıdaki dal sıradaki öğrenciyi açar.
      const kaydetAdim = f => {
        if (ayriliyor || !GM_getValue('tamOto', false)) return;
        const a2 = acikOgrenciNo();
        if (!a2 || a2.no !== f.no) { otoDurdur('Numara doğrulanamadı, otomatik durdu.'); return; }
        // e-Okul IOK05001: araç çubuğundaki Kaydet sayfanın kendi işlevini çağırır; o işlev hiddenKaydet="Kaydet"
        // yazıp formu gönderir. Disket resmi (save_d) pasifken tıklamak bir şey yapmıyordu; aynısı doğrudan yapılır.
        // Önizleme gelince disket etkinleşir (save_d yerine tıklanabilir resim): varsa ona basılır.
        // Yoksa sayfanın Kaydet işlevinin yaptığı yapılır.
        const aktif = kaydetDugmeleri()[0];
        if (aktif && !/_d\.(jpe?g|gif|png)/i.test(simgeAdres(aktif))) {
          yuklendi(f.no); GM_setValue('otoSon', f.no); GM_setValue('otoZaman', Date.now());
          durum(f.no + ' kaydediliyor...'); aktif.click();
          return;
        }
        const frm = (dosyaKutulari()[0] || {}).form || belgeler().map(d => d.querySelector('form')).find(Boolean);
        const gizli = frm && frm.elements && frm.elements.namedItem('hiddenKaydet');
        if (gizli) {
          yuklendi(f.no); GM_setValue('otoSon', f.no); GM_setValue('otoZaman', Date.now());
          durum(f.no + ' kaydediliyor...');
          gizli.value = 'Kaydet'; frm.submit();
          return;
        }
        const k = kaydetDugmeleri()[0];
        if (!k) { otoDurdur('Kaydet düğmesi bulunamadı, otomatik durdu. “Kaydet düğmesini tanıt” ile disket simgesini gösterin.'); return; }
        const onay = belgeler().flatMap(d => [...d.querySelectorAll('input[type=submit],input[type=button],button,a')])
          .find(b => gorunur(b) && !b.closest('#vf-panel') && /onayla/i.test(dugmeYazi(b)) && !/iptal|vazge|sil|delete|cancel/i.test(dugmeYazi(b)));
        const kaydet = () => { const k2 = kaydetDugmeleri()[0] || k; yuklendi(f.no); GM_setValue('otoSon', f.no); GM_setValue('otoZaman', Date.now()); durum(f.no + ' kaydediliyor...'); k2.click();
          // e-Okul kaydedip sayfayı yenilemezse (aynı sayfada kalırsa) sıradaki öğrenci buradan açılır;
          // yenilerse bu sayaç ölür, açılışta "az önce kaydedilen" dalı sıradakini açar
          setTimeout(() => { if (!ayriliyor && GM_getValue('tamOto', false) && GM_getValue('otoSon', '') === f.no) { GM_setValue('otoSon', ''); durum(f.no + ' kaydedildi. Sıradaki açılıyor...'); sonraki(); } }, 5000);
        };
        if (onay) { onay.click(); setTimeout(kaydet, 1200); } else kaydet();
      };
      // Aynı öğrenciye 3 dk içinde ikinci kez kendiliğinden konmaz: e-Okul fotoğraf seçilince sayfayı yeniliyor,
      // her açılışta yeniden konunca sayfa durmadan gelip gidiyordu. Yenilenen sayfada sıra Kaydet'tedir.
      let yer = null; try { yer = JSON.parse(GM_getValue('yerlesen', 'null')); } catch (e) { yer = null; }
      if (f && !yuklenenler().has(f.no) && yer && yer.no === f.no && Date.now() - yer.zaman < 180000) {
        ac();
        // buraya sayfa yenilenerek gelindi: e-Okul önizlemeyi yükledi, sıra Kaydet'te
        if (oto) { durum(f.no + ' önizleme geldi, Kaydet’e basılıyor...'); setTimeout(() => kaydetAdim(f), 1500); }
        else durum(f.no + ' fotoğrafı kondu. Önizlemeyi kontrol edip Kaydet’e basın.');
        return;
      }
      if (f && !yuklenenler().has(f.no) && dosyaKutulari().length) {
        ac();
        GM_setValue('yerlesen', JSON.stringify({ no: f.no, zaman: Date.now() })); GM_setValue('otoZaman', Date.now());
        const img = onizleme(), eski = img ? img.src : '';
        if (!yerlestirFoto(f) || !oto) return;
        // Önizleme beklenir: e-Okul fotoğrafı sunucuya yükleyip sayfayı yeniler (o zaman yukarıdaki dal Kaydet'e basar)
        // ya da aynı sayfada resmi değiştirir. Önceden 1,2 sn sonra Kaydet'e basılıyordu; yükleme yarıda kesilip kayıt olmuyordu.
        // e-Okul dosya seçilince Goster() ile önizlemeyi sunucuya gönderir, sayfa yenilenir, disket etkinleşir;
        // yenilenen sayfada yukarıdaki dal Kaydet'e basar. Sayfa 4 sn içinde gönderilmezse buradan kaydedilir.
        durum(f.no + ' fotoğrafı kondu, önizleme bekleniyor...');
        void eski;
        setTimeout(() => { if (!ayriliyor) kaydetAdim(f); }, 4000);
        return;
      }
      if (oto && (elle || !acik)) { ac(); sonraki(); }
    }
    otomatik(false);
  }

  // Panel yalnızca fotoğraf kutusu olan e-Okul sayfasında kendiliğinden açılır; menüden her zaman açılabilir
  let zaman = null;
  const gozcu = new MutationObserver(() => { clearTimeout(zaman); zaman = setTimeout(dene, 700); });
  function dene() {
    if (document.getElementById('vf-panel')) { gozcu.disconnect(); return; }
    if (dosyaKutulari().length || listeSatirlari().length || ogrenciSecimi()) { paneliKur(); gozcu.disconnect(); }
  }
  dene();
  if (!document.getElementById('vf-panel')) gozcu.observe(document.documentElement, { childList: true, subtree: true });
  try { GM_registerMenuCommand('Vesikalık fotoğraf panelini aç', () => { paneliKur(); document.getElementById('vf-ac').click(); }); } catch (e) { /* menü desteklenmiyor */ }
})();
