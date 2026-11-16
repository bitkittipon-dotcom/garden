/* ทศพร · Service Worker (build 1152)
 * ไฟล์นี้ต้องอยู่โฟลเดอร์เดียวกับ index.html บน GitHub
 *
 * หลักการ
 *  1) หน้าแอป (index.html): ดึงจากเน็ตก่อนเสมอ → ได้เวอร์ชันล่าสุดทุกครั้งที่เน็ตปกติ
 *     - เน็ตช้าเกิน 4 วิ หรือไม่มีเน็ต → เปิดจากสำเนาล่าสุดในเครื่องแทน (แล้วอัปเดตสำเนาเมื่อเน็ตกลับมา)
 *  2) ไลบรารี/ฟอนต์จาก CDN (ชื่อไฟล์มีเลขเวอร์ชันตายตัว) → ใช้จากเครื่องก่อน ไม่ต้องโหลดซ้ำ
 *  3) ข้อมูลคลาวด์ (Supabase) และทุกอย่างที่ไม่ใช่ GET → ไม่แตะเลย วิ่งตรงเหมือนเดิม
 */
const VER = 'v1152';
const PAGE_CACHE = 'tsp-page';          // สำเนาหน้าแอป (ใบเดียว ทับของเก่าเสมอ)
const LIB_CACHE = 'tsp-lib-' + VER;     // ไลบรารี CDN
const PAGE_TIMEOUT_MS = 4000;
const LIB_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];

self.addEventListener('install', () => { self.skipWaiting(); });

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('tsp-lib-') && k !== LIB_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

function pageKey(url) { const u = new URL(url); u.search = ''; u.hash = ''; return u.href; }

async function fromNetworkPage(req) {
  const res = await fetch(req, { cache: 'no-store' });
  if (res && res.ok && res.type === 'basic') {
    const c = await caches.open(PAGE_CACHE);
    await c.put(pageKey(req.url), res.clone());
  }
  return res;
}

async function cachedPage(req) {
  const c = await caches.open(PAGE_CACHE);
  return (await c.match(pageKey(req.url))) || (await c.match(new URL('./', self.registration.scope).href))
      || (await c.match(new URL('./index.html', self.registration.scope).href)) || null;
}

async function handlePage(e) {
  const net = fromNetworkPage(e.request);
  e.waitUntil(net.then(() => {}, () => {}));          // เน็ตตอบช้า → ให้โหลดต่อเบื้องหลังเพื่ออัปเดตสำเนา
  const timeout = new Promise(r => setTimeout(() => r('timeout'), PAGE_TIMEOUT_MS));
  try {
    const first = await Promise.race([net, timeout]);
    if (first !== 'timeout') return first;              // เน็ตตอบทัน (รวมกรณีเซิร์ฟเวอร์ตอบ error) → ใช้ของจากเน็ต
    const c = await cachedPage(e.request);
    return c || await net;                              // ยังไม่มีสำเนา → รอเน็ตต่อ
  } catch (err) {
    const c = await cachedPage(e.request);              // ไม่มีเน็ต
    if (c) return c;
    throw err;
  }
}

async function handleLib(req) {
  const c = await caches.open(LIB_CACHE);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()).catch(() => {});
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate' && url.origin === self.location.origin) { e.respondWith(handlePage(e)); return; }
  if (LIB_HOSTS.includes(url.hostname)) { e.respondWith(handleLib(req)); return; }
  // อย่างอื่น (Supabase, รูป, API) → ปล่อยผ่าน ไม่แคช
});
