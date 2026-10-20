// Офлайн: при первом запуске все файлы сохраняются в телефоне и дальше берутся оттуда.
// При любом изменении файлов поднять версию здесь И в js/version.js.
const CACHE_NAME = "plan-0.16.2";

// пути относительно sw.js
const ASSETS = [
    "./",
    "./index.html",
    "./manifest.webmanifest",
    "./css/fonts.css",
    "./css/tokens.css",
    "./css/base.css",
    "./css/tasks.css",
    "./css/dump.css",
    "./css/more.css",
    "./css/rituals.css",
    "./css/content.css",
    "./css/tools.css",
    "./js/version.js",
    "./js/app.js",
    "./js/db.js",
    "./js/dates.js",
    "./js/parse.js",
    "./js/store.js",
    "./js/ui.js",
    "./js/sheets.js",
    "./js/screens.js",
    "./js/sort.js",
    "./js/dump.js",
    "./js/repeat.js",
    "./js/swipe.js",
    "./js/search.js",
    "./js/settings.js",
    "./js/reminders.js",
    "./js/notify.js",
    "./js/onboarding.js",
    "./js/chains.js",
    "./js/show.js",
    "./js/goals.js",
    "./js/rituals.js",
    "./js/calendar.js",
    "./js/content.js",
    "./js/focus.js",
    "./js/habits.js",
    "./js/matrix.js",
    "./js/stats.js",
    "./js/tutorial.js",
    "./js/exchange.js",
    "./js/more.js",
    "./docs/claude-format.md",
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
            // если файла нет в кэше (кэш вытеснили), берём из сети и сразу кладём обратно
            .then(cached => cached || fetch(request).then(response => {
                if (response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
                }
                return response;
            }))
            .catch(() => request.mode === "navigate" ? caches.match("./index.html") : Response.error())
    );
});
