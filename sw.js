const CACHE = "survival-68f1efe94e";
const INDEX_SHA256 = "68f1efe94e5d71b327917539ccc9e4d3c9f87c84731900acba57e4da2dd94828";
const ASSETS = ["manifest.webmanifest", "icon-192.png", "icon-512.png"];
// ตอน deploy เซิร์ฟเวอร์อาจส่ง sw.js รุ่นใหม่ออกมาก่อน index.html รุ่นใหม่ (หรือเบราว์เซอร์ยังมี index.html เก่าในแคช HTTP)
// ถ้าเก็บ index.html ที่ได้มาโดยไม่ตรวจ เครื่องจะค้างหน้าเก่าภายใต้ชื่อรุ่นใหม่ จึงต้องดึงแบบข้ามแคชและเทียบ hash
// ถ้าไม่ตรง ให้การติดตั้งล้มเหลว เบราว์เซอร์จะใช้รุ่นเดิมต่อและลองใหม่ในการเปิดครั้งถัดไป
async function install() {
  const res = await fetch("index.html", {cache: "reload"});
  if (!res.ok) throw new Error("index.html " + res.status);
  const sum = await crypto.subtle.digest("SHA-256", await res.clone().arrayBuffer());
  const hex = [...new Uint8Array(sum)].map(b => b.toString(16).padStart(2, "0")).join("");
  if (hex !== INDEX_SHA256) throw new Error("index.html is not the version this worker was built for");
  const cache = await caches.open(CACHE);
  await cache.put("index.html", res.clone());
  await cache.put("./", res);
  await cache.addAll(ASSETS.map(u => new Request(u, {cache: "reload"})));
  await self.skipWaiting();
}
self.addEventListener("install", e => e.waitUntil(install()));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;  // ไม่ยุ่งกับบริการซิงก์
  e.respondWith(caches.open(CACHE).then(c => c.match(e.request, {ignoreSearch: true})
    .then(r => r || fetch(e.request).catch(() => c.match("index.html")))));
});
