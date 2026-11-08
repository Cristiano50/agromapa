/* AgroMapa — service worker. Guarda a "casca" do app (HTML, manifesto, ícones, bibliotecas e fontes) para abrir sem internet
   e instalar como aplicativo. Os dados ficam no IndexedDB do app; chamadas ao servidor (Supabase/API) e blocos de mapa
   nunca passam por este cache. Cada versão nova substitui a anterior. */
const CACHE = 'agromapa-0.7-persistence-mobile-3';
const SHELL = ['./', './index.html', './backup.js', './manifest.json', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-192.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png'];
const LIBS = ['https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js', 'https://cdn.jsdelivr.net/npm/idb@8.0.0/build/umd.js'];
const LIB_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL);
    // config.js pode não existir (app sem servidor) e as bibliotecas podem estar fora do ar: não impedem a instalação
    await Promise.all(['./config.js', ...LIBS].map(async u => { try { const r = await fetch(u, { cache: 'no-cache' }); if (r.ok || r.type === 'opaque') await c.put(u, r); } catch (_) {} }));
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => { for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k); await self.clients.claim(); })());
});
self.addEventListener('message', e => { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (sameOrigin && url.pathname.endsWith('/sw.js')) return;
  if (!sameOrigin && !LIB_HOSTS.includes(url.hostname)) return;          // servidor, mapas, clima: direto na rede
  if (req.mode === 'navigate' || (sameOrigin && /\/(index\.html)?$/.test(url.pathname))) {
    // casca do app: cache primeiro (abre na hora, com ou sem internet) e atualiza por trás; a versão nova vale no próximo build do sw
    e.respondWith((async () => { const c = await caches.open(CACHE); const hit = await c.match('./index.html'); if (hit) return hit;
      try { return await fetch(req); } catch (_) { return new Response('<!doctype html><meta charset="utf-8"><title>AgroMapa</title><p style="font:16px system-ui;padding:24px">Sem internet e o app ainda não foi guardado neste aparelho. Abra uma vez com internet.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }); } })());
    return;
  }
  e.respondWith((async () => {
    const c = await caches.open(CACHE); const hit = await c.match(req, { ignoreVary: true }); if (hit) return hit;
    try { const r = await fetch(req); if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()); return r; }
    catch (err) { if (hit) return hit; throw err; }
  })());
});
