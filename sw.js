// e-Okul Fotoğraf Düzenleme Otomasyonu — internetsiz kullanım için önbellek. Mehmet Karadeniz, 2026-2027
// Uygulama dosyaları: önce ağ (güncel sürüm gelsin), ağ yoksa önbellek.
// Modeller ve kütüphaneler (CDN): önce önbellek; sürüm numaralı adreslerden geldikleri için değişmezler.
const V = "bgr-v1";
const APP = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];
const CDN = /(^|\.)(cdn\.jsdelivr\.net|storage\.googleapis\.com|huggingface\.co|hf\.co|xethub\.hf\.co)$/;

self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(V).then(c => c.addAll(APP)).catch(() => {}));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("bgr-") && k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(req, cp)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || (req.mode === "navigate" ? caches.match("./index.html") : Response.error()))));
    return;
  }
  if (CDN.test(url.hostname)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok || res.type === "opaque") { const cp = res.clone(); caches.open(V).then(c => c.put(req, cp)).catch(() => {}); }
      return res;
    })));
  }
});
