// Выступление: задача kind: "show" с полем show = { client, phone, address, fee, format, travelMin }.
// Карточка в редакторе задачи, кнопки «Позвонить» и «Маршрут», блок «День выступления» на «Сегодня».
import { dayKey, dayOf, hasTime, parseDate, timeText, toIso } from "./dates.js";
import { chainTasks } from "./chains.js";
import { state } from "./store.js";
import { esc } from "./ui.js";

const ICON_PHONE = `<svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>`;
const ICON_ROUTE = `<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>`;

const FIELDS = [
    ["client", "Заказчик", "text", "Анна, свадьба"],
    ["phone", "Телефон", "tel", "+7 900 123-45-67"],
    ["address", "Адрес", "text", "Город, улица, дом, площадка"],
    ["fee", "Гонорар", "text", "30 000"],
    ["format", "Формат номера", "text", "close-up 40 мин + сцена 20"],
    ["travelMin", "Дорога, мин", "number", "60"]
];

function telLink(phone) {
    return "tel:" + String(phone).replace(/[^\d+]/g, "");
}

// веб-ссылка: если Яндекс Карты стоят, iOS откроет их, иначе — сайт
function routeLink(address) {
    return "https://yandex.ru/maps/?rtext=~" + encodeURIComponent(address) + "&rtt=auto";
}

export function departure(task) {
    if (!hasTime(task.plannedAt) || !task.show?.travelMin) {
        return null;
    }
    return new Date(parseDate(task.plannedAt).getTime() - task.show.travelMin * 60000);
}

function feeText(fee) {
    return typeof fee === "number" ? fee.toLocaleString("ru-RU") + " ₽" : String(fee);
}

// кнопки звонка и маршрута; пусто, если нечего показать
export function actions(show) {
    if (!show) {
        return "";
    }
    return [
        show.phone ? `<a class="btn ghost" href="${esc(telLink(show.phone))}">${ICON_PHONE}Позвонить</a>` : "",
        show.address ? `<a class="btn ghost" href="${esc(routeLink(show.address))}" target="_blank" rel="noopener">${ICON_ROUTE}Маршрут</a>` : ""
    ].join("");
}

// блок полей в редакторе задачи
export function showFieldsHtml(task) {
    const show = task.show || {};
    const leave = departure(task);
    return `
        <div class="field show-fields" id="showFields">
            <div class="label">Выступление</div>
            <div class="show-actions">${actions(show)}</div>
            ${leave ? `<p class="hint">Выезд в&nbsp;<b class="mono">${timeText(toIso(leave))}</b> — начало минус дорога.</p>` : ""}
            ${FIELDS.map(([key, label, type, placeholder]) => `
                <div class="row" style="margin-top: var(--sp-8)">
                    <span class="text-2 row-label">${label}</span>
                    <input class="input" data-show="${key}" type="${type}" ${type === "number" ? `inputmode="numeric" min="0"` : ""}
                           placeholder="${esc(placeholder)}" value="${esc(show[key] ?? "")}" autocomplete="off">
                </div>`).join("")}
        </div>`;
}

export function readShowFields(sheet) {
    const show = {};
    sheet.querySelectorAll("[data-show]").forEach(input => {
        const value = input.value.trim();
        if (!value) {
            return;
        }
        const key = input.dataset.show;
        if (key === "travelMin") {
            show.travelMin = Math.max(0, Math.round(+value)) || undefined;
        } else if (key === "fee") {
            const number = +value.replace(/[\s₽]/g, "").replace(",", ".");
            show.fee = isNaN(number) ? value : number;
        } else {
            show[key] = value;
        }
    });
    Object.keys(show).forEach(key => show[key] === undefined && delete show[key]);
    return Object.keys(show).length ? show : null;
}

// ---- «Сегодня»: блок дня выступления ----
export function showDayBlock(now = new Date()) {
    const key = dayKey(now);
    const shows = [...state.tasks.values()]
        .filter(task => task.kind === "show" && !task.done && !task.deletedAt && dayOf(task.plannedAt) === key)
        .sort((a, b) => (a.plannedAt || "").localeCompare(b.plannedAt || ""));
    return shows.map(task => {
        const show = task.show || {};
        const leave = departure(task);
        // ключевые моменты дня: шаги цепочки и само начало
        const moments = [
            ...chainTasks(task).filter(step => hasTime(step.plannedAt)).map(step => ({
                at: parseDate(step.plannedAt), label: step.title.split(":")[0], done: step.done
            })),
            ...(leave && !chainTasks(task).some(step => /^выезд/i.test(step.title)) ? [{ at: leave, label: "Выезд" }] : []),
            ...(hasTime(task.plannedAt) ? [{ at: parseDate(task.plannedAt), label: "Начало", main: true }] : [])
        ].sort((a, b) => a.at - b.at);
        return `
            <div class="show-day" data-id="${task.id}">
                <div class="label" style="margin: 0">День выступления</div>
                <button class="show-title" data-action="edit">${esc(task.title)}</button>
                <div class="meta">${[show.client, show.format, show.fee !== undefined && feeText(show.fee)].filter(Boolean).map(esc).join(" · ")}</div>
                ${moments.length ? `<div class="moments">${moments.map(moment => `
                    <div class="${moment.main ? "main" : ""} ${moment.done ? "done" : ""} ${moment.at < now ? "past" : ""}">
                        <span class="mono">${timeText(toIso(moment.at))}</span>${esc(moment.label)}
                    </div>`).join("")}</div>` : ""}
                ${show.address ? `<div class="meta">${esc(show.address)}</div>` : ""}
                <div class="btns show-actions">${actions(show)}</div>
            </div>`;
    }).join("");
}
