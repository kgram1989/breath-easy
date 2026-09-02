/* Cache-first: once loaded, Breath Easy runs with no signal at all. */
const CACHE = "breatheasy-v1";
const ASSETS = [
  "./", "./index.html", "./styles.css", "./app.js", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png",
  "./audio/soft/inhale.mp3", "./audio/soft/exhale.mp3", "./audio/soft/hold.mp3",
  "./audio/soft/top.mp3", "./audio/soft/ready.mp3", "./audio/soft/done.mp3",
  "./audio/warm/inhale.mp3", "./audio/warm/exhale.mp3", "./audio/warm/hold.mp3",
  "./audio/warm/top.mp3", "./audio/warm/ready.mp3", "./audio/warm/done.mp3",
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) =>
    Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
