import { getMeta, setMeta } from "./db.js";
import { addDays, dayKey, relativeDay } from "./dates.js";
import { openDump } from "./dump.js";
import { openSearch } from "./search.js";
import { journalSheet } from "./settings.js";
import { onNotifyClick, pasteFromClipboard, resumeAfterShortcut } from "./notify.js";
import { loadReminders, shortcutJustRan } from "./reminders.js";
import { dismissHint, loadHints, maybeStartOnboarding, showHint } from "./onboarding.js";
import { onRitualClick } from "./rituals.js";
import { addOnSelected, onCalendarClick, renderCalendar } from "./calendar.js";
import { newPost, onContentClick, renderContent } from "./content.js";
import { openFocus, startFocus, startWork } from "./focus.js";
import { onHabitClick } from "./habits.js";
import { loadTutorial, resumeTutorial } from "./tutorial.js";
import { swipeRows } from "./swipe.js";
import { onMoreClick, renderMore } from "./more.js";
import { renderInbox, renderToday } from "./screens.js";
import { editTask, postponeTask, quickAdd } from "./sheets.js";
import { loadStore, onChange, overdueTasks, saveTask, setDone, state } from "./store.js";
import { haptic, showToast } from "./ui.js";

const version = self.APP_VERSION;
const isStandalone = navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;

// ---- iOS: окно короче экрана на высоту строки состояния ----
// Ошибка WebKit 236445: у приложения с домашнего экрана с прозрачной строкой состояния всё, что прижато
// к низу, висит над краем. Меряем разницу и опускаем на неё (в CSS --ios-gap); починят — станет 0.
function measureIosGap() {
    if (!isStandalone) {
        return 0;
    }
    const portrait = matchMedia("(orientation: portrait)").matches;
    const screenHeight = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
    const gap = screenHeight - window.innerHeight;
    // больше 120 px — это уже не строка состояния, а что-то другое: не трогаем
    return gap > 0 && gap < 120 ? gap : 0;
}

// env() из JS не прочитать: меряем пробным элементом с такими отступами
function safeAreas() {
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)";
    document.body.append(probe);
    const style = getComputedStyle(probe);
    const result = { top: parseFloat(style.paddingTop) || 0, bottom: parseFloat(style.paddingBottom) || 0 };
    probe.remove();
    return result;
}

function applyIosGap() {
    document.documentElement.style.setProperty("--ios-gap", measureIosGap() + "px");
}

// Без сети приложение встаёт из кэша раньше, чем окно получит свой размер, а resize потом не приходит:
// первый замер даёт лишний зазор и панель уезжает под край. Поэтому перемеряем, когда окно устоится.
applyIosGap();
window.addEventListener("resize", applyIosGap);
window.visualViewport?.addEventListener("resize", applyIosGap);
window.addEventListener("orientationchange", () => setTimeout(applyIosGap, 300));
window.addEventListener("load", applyIosGap);
window.addEventListener("pageshow", applyIosGap);
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && setTimeout(applyIosGap, 100));
[150, 500, 1500].forEach(delay => setTimeout(applyIosGap, delay));

let activeScreen = "today";
let viewDay = new Date();

// ---- навигация по вкладкам ----
const tabs = document.querySelectorAll(".tab");
const screens = document.querySelectorAll(".screen");

// облачко под активной вкладкой: переезжает к нажатой; при первом показе и повороте — без анимации
const pill = document.querySelector(".tab-pill");
function placePill(animate) {
    const tab = [...tabs].find(item => item.dataset.screen === activeScreen);
    if (!tab || !pill || !tab.offsetWidth) {
        return;
    }
    const width = Math.min(tab.offsetWidth - 8, 84);
    pill.classList.toggle("instant", !animate);
    pill.style.width = width + "px";
    pill.style.transform = `translateX(${tab.offsetLeft + (tab.offsetWidth - width) / 2}px)`;
}

function showScreen(id) {
    activeScreen = id;
    screens.forEach(screen => screen.hidden = screen.id !== id);
    tabs.forEach(tab => tab.dataset.screen === id ? tab.setAttribute("aria-current", "page") : tab.removeAttribute("aria-current"));
    placePill(true);
    document.getElementById("fab").hidden = id === "more";
    window.scrollTo(0, 0);
    render();
}

placePill(false);
document.fonts?.ready.then(() => placePill(false)); // ширина вкладок зависит от шрифта
window.addEventListener("resize", () => placePill(false));

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
    } else if (activeScreen === "calendar") {
        renderCalendar(document.getElementById("calendar"));
    } else if (activeScreen === "content") {
        renderContent(document.getElementById("content"));
    } else if (activeScreen === "more") {
        renderMore(document.getElementById("exchange"));
        renderChecks();
    }
    // одна подсказка на вкладке при первом открытии
    showHint(document.getElementById(activeScreen), activeScreen);
    // спокойный счётчик на иконке: только просроченное
    const late = overdueTasks().length;
    navigator.setAppBadge?.(late).catch(() => { });
}

onChange(render);
// раз в минуту: двигается линия «сейчас» и блок «Сейчас»
setInterval(() => activeScreen === "today" && render(), 60000);
// возвращение в приложение: после сверки — вставить её; после долгой отлучки — предложить буфер (Siri)
let hiddenAt = 0;
document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
    }
    render();
    if (await resumeAfterShortcut()) {
        return;
    }
    if (hiddenAt && Date.now() - hiddenAt > 20000 && !shortcutJustRan() && navigator.clipboard?.readText) {
        showToast("Надиктовал через Siri?", "Вставить", pasteFromClipboard, 6000);
    }
});

// ---- действия с задачами (делегирование) ----
document.querySelector(".app").addEventListener("click", event => {
    const dayButton = event.target.closest("[data-day]");
    if (dayButton) {
        const shift = +dayButton.dataset.day;
        viewDay = shift ? addDays(viewDay, shift) : new Date();
        render();
        return;
    }
    if (onNotifyClick(event) || onRitualClick(event) || onHabitClick(event)) {
        return;
    }
    if (event.target.closest("[data-tutorial-open]")) {
        resumeTutorial();
        return;
    }
    if (event.target.closest("[data-focus-open]")) {
        openFocus();
        return;
    }
    if (activeScreen === "calendar" && onCalendarClick(event, render)) {
        return;
    }
    if (activeScreen === "content" && onContentClick(event, render)) {
        return;
    }
    const hint = event.target.closest("[data-hint]");
    if (hint) {
        dismissHint(hint.dataset.hint);
        return;
    }
    if (event.target.closest("[data-journal]")) {
        journalSheet();
        return;
    }
    if (event.target.closest("[data-search]")) {
        openSearch();
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
        case "focus":
            startFocus(task);
            break;
        case "start":
            startWork(task);
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

swipeRows(document.querySelector(".app"), {
    onRight: row => toggle(state.tasks.get(row.dataset.id), row),
    onLeft: row => postponeTask(state.tasks.get(row.dataset.id))
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
        const next = task.nextId && state.tasks.get(task.nextId);
        const text = next ? `Готово. Следующий раз ${relativeDay(next.plannedAt)}` : "Готово";
        showToast(text, "Вернуть", () => setDone(task, false));
    }, 300);
}

document.getElementById("more").addEventListener("click", onMoreClick);
// «+»: на «Календаре» — задача на выбранный день, на «Контенте» — новая идея
document.getElementById("fab").addEventListener("click", () =>
    activeScreen === "calendar" ? addOnSelected() : activeScreen === "content" ? newPost() : quickAdd());

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
            ok: true,
            what: "Размер экрана",
            why: `Окно ${window.innerHeight} из ${Math.max(screen.width, screen.height)} pt, поправка снизу ${measureIosGap()} pt, `
                + `безопасные зоны сверху ${safeAreas().top} и снизу ${safeAreas().bottom} pt.`
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
Promise.all([loadStore(), loadReminders(), loadHints()]).then(async () => {
    await loadTutorial();
    render();
    maybeStartOnboarding(showScreen);
});
