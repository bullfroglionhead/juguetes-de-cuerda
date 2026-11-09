/*
 * Service worker (solo en build de producción). Al instalarse precachea index.html y todo lo que referencia
 * (bundle, hoja de estilos y las fuentes que esta enlaza, manifiesto, iconos) más el arte del tema activo
 * (themes/<tema>/precache.json, generado por tools/build_catedral.py); después sirve desde caché y actualiza
 * en segundo plano, así el juego arranca sin conexión con todo su arte. Cambiar VERSION invalida la caché.
 */
const VERSION = "defensa-v17";
const THEMES = ["catedral", "juguetes"];

async function precache(c, urls) {
  // En lotes y tolerando fallos sueltos: un fichero ausente no debe impedir la instalación.
  const list = [...new Set(urls)];
  for (let i = 0; i < list.length; i += 12) {
    await Promise.all(list.slice(i, i + 12).map(async (u) => {
      try {
        const res = await fetch(u, { cache: "reload" });
        if (res.ok) await c.put(u, res);
      } catch (e) { /* sin conexión durante la instalación: se reintenta en la siguiente */ }
    }));
  }
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    (async () => {
      const c = await caches.open(VERSION);
      const abs = (u, base) => new URL(u, base ?? self.registration.scope).href;
      const html = await (await fetch("./", { cache: "reload" })).text();
      const refs = [...html.matchAll(/(?:src|href)="([^"#?]+)"/g)].map((m) => m[1]).filter((u) => !/^[a-z]+:/i.test(u)).map((u) => abs(u));
      const core = [abs("./"), abs("./manifest.webmanifest"), abs("./juguetes.webmanifest"), abs("./icons/icon-192.png"), abs("./icons/icon-512.png"), ...refs];
      await c.addAll([...new Set(core)]);
      // Fuentes enlazadas desde las hojas de estilo (url(...)).
      const fonts = [];
      for (const u of refs.filter((r) => r.endsWith(".css"))) {
        try {
          const css = await (await fetch(u)).text();
          for (const m of css.matchAll(/url\(([^)]+)\)/g)) {
            const f = m[1].replace(/["']/g, "");
            if (!/^data:/.test(f) && /\.woff2?$/.test(f)) fonts.push(abs(f, u));
          }
        } catch (e) { /* sin hoja de estilos */ }
      }
      // Arte de los temas (lista escrita por el pipeline).
      const art = [];
      for (const t of THEMES) {
        try {
          const list = await (await fetch(abs(`./themes/${t}/precache.json`), { cache: "reload" })).json();
          for (const f of list) art.push(abs(`./themes/${t}/${f}`));
        } catch (e) { /* tema sin lista */ }
      }
      await precache(c, [...fonts, ...art]);
      await self.skipWaiting();
    })(),
  );
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  // La página, de la red primero: así cada versión publicada (con su bundle nuevo) llega en la primera carga;
  // la caché solo se usa sin conexión.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(VERSION).then((c) => c.put(new URL("./", self.registration.scope).href, res.clone()));
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true, ignoreVary: true }).then((hit) => hit ?? caches.match(new URL("./", self.registration.scope).href))),
    );
    return;
  }
  e.respondWith(
    caches.match(req, { ignoreSearch: true, ignoreVary: true }).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => hit);
      return hit ?? net;
    }),
  );
});
