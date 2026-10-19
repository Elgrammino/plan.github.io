import { getMeta, setMeta } from "./db.js";
import { addDays, dayKey } from "./dates.js";
import { openDump } from "./dump.js";
import { renderInbox, renderToday } from "./screens.js";
import { editTask, postponeTask, quickAdd } from "./sheets.js";
import { loadStore, onChange, overdueTasks, saveTask, setDone, state } from "./store.js";
import { haptic, showToast } from "./ui.js";

const version = self.APP_VERSION;
const isStandalone = navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;

let activeScreen = "today";
let viewDay = new Date();

// ---- навигация по вкладкам ----
const tabs = document.querySelectorAll(".tab");
const screens = document.querySelectorAll(".screen");

function showScreen(id) {
    activeScreen = id;
    screens.forEach(screen => screen.hidden = screen.id !== id);
    tabs.forEach(tab => tab.dataset.screen === id ? tab.setAttribute("aria-current", "page") : tab.removeAttribute("aria-current"));
    document.getElementById("fab").hidden = !["today", "inbox"].includes(id);
    window.scrollTo(0, 0);
    render();
}

tabs.forEach(tab => tab.addEventListener("click", () => {
    if (tab.dataset.screen === "today" && activeScreen === "today") {
        viewDay = new Date(); // повторное нажатие возвращает к сегодня
    }
    showScreen(tab.dataset.screen);
}));

// ---- отрисовка ----
const INSTALL_HINT = `
    <div class="card notice" style="margin-top: var(--sp-16)">
        Чтобы план не&nbsp;потерялся, открой его с&nbsp;домашнего экрана:
        <b>Поделиться</b> → <b>На&nbsp;экран «Домой»</b>. В&nbsp;Safari iOS стирает данные сайтов через 7&nbsp;дней без визитов.
    </div>`;

function render() {
    if (activeScreen === "today") {
        renderToday(document.getElementById("today"), viewDay);
        if (!isStandalone) {
            document.getElementById("installHint").innerHTML = INSTALL_HINT;
        }
    } else if (activeScreen === "inbox") {
        renderInbox(document.getElementById("inbox"));
    } else if (activeScreen === "more") {
        renderChecks();
    }
    // спокойный счётчик на иконке: только просроченное
    const late = overdueTasks().length;
    navigator.setAppBadge?.(late).catch(() => { });
}

onChange(render);
// раз в минуту: двигается линия «сейчас» и блок «Сейчас»
setInterval(() => activeScreen === "today" && render(), 60000);
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && render());

// ---- действия с задачами (делегирование) ----
document.querySelector(".app").addEventListener("click", event => {
    const dayButton = event.target.closest("[data-day]");
    if (dayButton) {
        const shift = +dayButton.dataset.day;
        viewDay = shift ? addDays(viewDay, shift) : new Date();
        render();
        return;
    }
    if (event.target.closest("[data-dump]")) {
        haptic();
        openDump(showScreen);
        return;
    }
    const button = event.target.closest("[data-action]");
    const holder = button?.closest("[data-id]");
    if (!holder) {
        return;
    }
    const task = state.tasks.get(holder.dataset.id);
    switch (button.dataset.action) {
        case "toggle":
            toggle(task, holder);
            break;
        case "edit":
            editTask(task);
            break;
        case "postpone":
            postponeTask(task);
            break;
        case "today":
            haptic();
            task.plannedAt = dayKey(new Date());
            saveTask(task);
            showToast("На сегодня", "Отменить", () => {
                task.plannedAt = null;
                saveTask(task);
            });
            break;
    }
});

function toggle(task, holder) {
    haptic();
    if (task.done) {
        setDone(task, false);
        return;
    }
    // выполненная задача мягко растворяется, потом сохраняется
    holder.classList.add("leaving");
    setTimeout(() => {
        setDone(task, true);
        showToast("Готово", "Вернуть", () => setDone(task, false));
    }, 300);
}

document.getElementById("fab").addEventListener("click", quickAdd);

// ---- защита данных: просим не стирать хранилище при каждом запуске ----
async function protectStorage() {
    if (!navigator.storage?.persist) {
        return null;
    }
    return (await navigator.storage.persisted()) || navigator.storage.persist();
}

const persistPromise = protectStorage();

// ---- счётчик запусков: проверка, что база переживает перезапуск ----
getMeta("launches").then(async (count = 0) => {
    await setMeta("launches", count + 1);
    document.getElementById("launches").textContent = count + 1;
});
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
if ("serviceWorker" in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register("./sw.js");
    // первая установка тоже меняет controller, о ней не сообщаем
    navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (hadController) {
            showToast("Вышла новая версия", "Обновить", () => location.reload(), 0);
        }
    });
}

// ---- старт ----
loadStore().then(render);
