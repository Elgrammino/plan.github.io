// Офлайн: при первом запуске все файлы сохраняются в телефоне и дальше берутся оттуда.
// При любом изменении файлов поднять версию здесь И в js/version.js.
const CACHE_NAME = "plan-0.1.0";

// пути относительно sw.js
const ASSETS = [
    "./",
    "./index.html",
    "./manifest.webmanifest",
    "./css/fonts.css",
    "./css/tokens.css",
    "./css/base.css",
    "./js/version.js",
    "./js/app.js",
    "./js/db.js",
    "./fonts/literata-cyrillic.woff2",
    "./fonts/literata-latin.woff2",
    "./fonts/onest-cyrillic.woff2",
    "./fonts/onest-latin.woff2",
    "./fonts/jetbrains-mono-cyrillic.woff2",
    "./fonts/jetbrains-mono-latin.woff2",
    "./icons/icon-192.png",
    "./icons/icon-512.png",
    "./icons/maskable-512.png",
    "./icons/apple-touch-icon.png"
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            // "reload" мимо HTTP-кэша браузера, чтобы новая версия взяла свежие файлы
            .then(cache => cache.addAll(ASSETS.map(url => new Request(url, { cache: "reload" }))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        Promise.all([
            caches.keys().then(keys =>
                Promise.all(keys.filter(key => key.startsWith("plan-") && key !== CACHE_NAME).map(key => caches.delete(key)))
            ),
            self.clients.claim()
        ])
    );
});

self.addEventListener("fetch", event => {
    const request = event.request;
    // только свои файлы; всё остальное идёт в сеть как обычно
    if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) {
        return;
    }
    event.respondWith(
        caches.match(request, { ignoreSearch: request.mode === "navigate" })
            .then(cached => cached || fetch(request))
            .catch(() => request.mode === "navigate" ? caches.match("./index.html") : Response.error())
    );
});
