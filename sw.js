/* Offline without pinning the app to whatever shipped first.
 *
 * The trap this replaces: a worker only reinstalls when its OWN bytes change,
 * so a cache-first handler over index.html and app.js served the first build
 * forever. Reloading could not fix it — the worker was answering the reload —
 * and neither could a new tab.
 *
 * So the split below is deliberate. The shell is small and changes every
 * deploy, so it goes network-first and falls back to cache only when the
 * fetch actually fails. Audio and icons are the bulk of the payload and never
 * change once shipped, so they stay cache-first — they are what "works with
 * no signal" really needs.
 *
 * Bump VERSION when the media list changes; the shell no longer depends on it.
 */
const VERSION = "v2";
const SHELL = `breatheasy-shell-${VERSION}`;
const MEDIA = `breatheasy-media-${VERSION}`;

const SHELL_ASSETS = ["./", "./index.html", "./styles.css", "./app.js", "./manifest.webmanifest"];
const MEDIA_ASSETS = [
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png",
  "./audio/soft/inhale.mp3", "./audio/soft/exhale.mp3", "./audio/soft/hold.mp3",
  "./audio/soft/top.mp3", "./audio/soft/ready.mp3", "./audio/soft/done.mp3",
  "./audio/warm/inhale.mp3", "./audio/warm/exhale.mp3", "./audio/warm/hold.mp3",
  "./audio/warm/top.mp3", "./audio/warm/ready.mp3", "./audio/warm/done.mp3",
];
const IMMUTABLE = /\/(audio|icons)\//;

self.addEventListener("install", (e) => {
  e.waitUntil(Promise.all([
    caches.open(SHELL).then((c) => c.addAll(SHELL_ASSETS)),
    caches.open(MEDIA).then((c) => c.addAll(MEDIA_ASSETS)),
  ]).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) =>
    Promise.all(ks.filter((k) => k !== SHELL && k !== MEDIA).map((k) => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  if (IMMUTABLE.test(url.pathname)) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
    return;
  }

  e.respondWith((async () => {
    try {
      /* Revalidate rather than letting the HTTP cache answer: Pages serves
         the shell with a ten minute max-age, and handing back the very build
         we are replacing is the bug this file exists to avoid. */
      const res = await fetch(e.request, { cache: "no-cache" });
      if (res && res.ok) (await caches.open(SHELL)).put(e.request, res.clone());
      return res;
    } catch (err) {
      return (await caches.match(e.request))
        || (await caches.match("./index.html"))
        || Response.error();
    }
  })());
});
