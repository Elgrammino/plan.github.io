import { getMeta, setMeta } from "./db.js";

const version = self.APP_VERSION;
const isStandalone = navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;

// ---- навигация по вкладкам ----
const tabs = document.querySelectorAll(".tab");
const screens = document.querySelectorAll(".screen");

function showScreen(id) {
    screens.forEach(screen => screen.hidden = screen.id !== id);
    tabs.forEach(tab => tab.dataset.screen === id ? tab.setAttribute("aria-current", "page") : tab.removeAttribute("aria-current"));
    window.scrollTo(0, 0);
    if (id === "more") {
        renderChecks();
    }
}

tabs.forEach(tab => tab.addEventListener("click", () => showScreen(tab.dataset.screen)));

// ---- «Сегодня» ----
function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

document.getElementById("todayDate").textContent =
    capitalize(new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" }));

if (!isStandalone) {
    document.getElementById("installHint").innerHTML = `
        <div class="card notice">
            Чтобы план не&nbsp;потерялся, открой его с&nbsp;домашнего экрана:
            <b>Поделиться</b> → <b>На&nbsp;экран «Домой»</b>. В&nbsp;Safari iOS стирает данные сайтов через 7&nbsp;дней без визитов.
        </div>`;
}

// ---- защита данных: просим не стирать хранилище при каждом запуске ----
async function protectStorage() {
    if (!navigator.storage?.persist) {
        return null;
    }
    return (await navigator.storage.persisted()) || navigator.storage.persist();
}

const persistPromise = protectStorage();

// ---- счётчик запусков: проверка, что база переживает перезапуск ----
const launchesPromise = getMeta("launches").then(async (count = 0) => {
    await setMeta("launches", count + 1);
    return count + 1;
});

launchesPromise.then(count => document.getElementById("launches").textContent = count);
document.getElementById("version").textContent = version;

// ---- офлайн ----
async function isOfflineReady() {
    if (!navigator.serviceWorker?.controller) {
        return false;
    }
    return (await caches.keys()).includes("plan-" + version);
}

// ---- экран проверки ----
async function renderChecks() {
    const [persisted, offline] = await Promise.all([persistPromise, isOfflineReady()]);
    const rows = [
        {
            ok: isStandalone,
            what: "Открыто с домашнего экрана",
            why: isStandalone ? "Так iOS не стирает данные." : "Открой «План» иконкой на домашнем экране, а не в Safari."
        },
        {
            ok: persisted === true,
            what: "Данные защищены",
            why: persisted === true ? "Система обещала не удалять хранилище."
                : persisted === null ? "Этот браузер не умеет защищать хранилище."
                : "Система пока не дала защиту. С домашнего экрана обычно даёт."
        },
        {
            ok: offline,
            what: "Работает без интернета",
            why: offline ? "Все файлы сохранены в телефоне." : "Файлы ещё сохраняются. Закрой и открой приложение."
        }
    ];
    document.getElementById("checks").innerHTML = rows.map(row => `
        <div class="check-row ${row.ok ? "ok" : "bad"}">
            <span class="dot"></span>
            <div class="what"><div>${row.what}</div><div class="why">${row.why}</div></div>
        </div>`).join("");
}

// ---- service worker и обновления ----
function showToast(text, actionText, action) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerHTML = `<span>${text}</span><button class="btn primary">${actionText}</button>`;
    toast.querySelector("button").addEventListener("click", action);
    document.body.append(toast);
}

if ("serviceWorker" in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register("./sw.js");
    // первая установка тоже меняет controller, о ней не сообщаем
    navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (hadController) {
            showToast("Вышла новая версия", "Обновить", () => location.reload());
        }
    });
}
