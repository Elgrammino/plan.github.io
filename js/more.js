// Вкладка «Ещё»: обмен с Claude, пакеты, бэкап.
import { getMeta, setMeta } from "./db.js";
import { dayKey, hasTime, relativeDay, timeText, toIso } from "./dates.js";
import {
    applyPlan, batches, exportForClaude, lastImport, makeBackup, prepareBackup, preparePackage,
    readPackage, rollbackImport, saveFile, shiftBatch, trashBatch
} from "./exchange.js";
import { openSettings, settingsRows } from "./settings.js";
import { state } from "./store.js";
import { esc, haptic, openSheet, showToast } from "./ui.js";

const SHIFTS = [-7, -1, 1, 7];

// инструкцию для Claude загружаем заранее: на iPhone копировать можно только сразу по нажатию
let formatDoc = null;
fetch("./docs/claude-format.md").then(response => response.ok ? response.text() : null).then(text => formatDoc = text).catch(() => { });

const plural = (n, one, few, many) =>
    n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many;
const tasksWord = n => `${n} ${plural(n, "задача", "задачи", "задач")}`;

function whenText(value) {
    return value ? relativeDay(value) + (hasTime(value) ? " " + timeText(value) : "") : "";
}

function daysAgo(iso) {
    const days = Math.round((new Date(dayKey(new Date())) - new Date(iso.slice(0, 10))) / 86400000);
    return days <= 0 ? "сегодня" : days === 1 ? "вчера" : `${days} ${plural(days, "день", "дня", "дней")} назад`;
}

export async function renderMore(el) {
    const [last, lastBackupAt] = await Promise.all([lastImport(), getMeta("lastBackupAt")]);
    const groups = batches();
    const backupOld = !lastBackupAt || Date.now() - new Date(lastBackupAt) > 7 * 86400000;

    el.innerHTML = `
        <div class="label">Настройки</div>
        ${settingsRows()}

        <div class="label">Обмен с&nbsp;Claude</div>
        <div class="card stack">
            <button class="btn primary wide" data-more="file">Импорт из&nbsp;файла</button>
            <button class="btn ghost wide" data-more="paste">Вставить текст</button>
            <button class="btn ghost wide" data-more="copy">Скопировать план для&nbsp;Claude</button>
            <button class="btn ghost wide" data-more="format">Скопировать формат для&nbsp;Claude</button>
            <p class="hint">Формат — один раз в&nbsp;начале чата: по&nbsp;нему Claude соберёт файл, который приложение поймёт.</p>
            ${last ? `<button class="btn ghost wide" data-more="rollback">Откатить «${esc(last.label)}» · ${esc(daysAgo(last.at))}</button>` : ""}
        </div>

        ${groups.length ? `
            <div class="label">Пакеты</div>
            <div class="card">${groups.map(group => `
                <button class="batch-row" data-batch="${esc(group.batch)}">
                    <span class="what">${esc(group.batch)}</span>
                    <span class="mono text-2">${group.done}/${group.count}</span>
                </button>`).join("")}
            </div>` : ""}

        <div class="label">Бэкап</div>
        <div class="card stack">
            <div class="check-row ${backupOld ? "bad" : "ok"}">
                <span class="dot"></span>
                <div class="what">
                    <div>${lastBackupAt ? "Последний бэкап " + esc(daysAgo(lastBackupAt)) : "Бэкапа ещё не было"}</div>
                    <div class="why">Все задачи в&nbsp;одном файле. Сохрани в&nbsp;«Файлы» или iCloud Drive раз в&nbsp;неделю.</div>
                </div>
            </div>
            <button class="btn ${backupOld ? "primary" : "ghost"} wide" data-more="backup">Сохранить бэкап</button>
            <button class="btn ghost wide" data-more="file">Восстановить из&nbsp;бэкапа</button>
        </div>`;
}

// данные в meta не вызывают onChange: перерисовываем сами
function refresh() {
    renderMore(document.getElementById("exchange"));
}

// ---- нажатия ----
const fileInput = document.createElement("input");
fileInput.type = "file";
fileInput.accept = ".json,application/json,text/plain";
fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (file) {
        handleText(await file.text());
    }
});

export function onMoreClick(event) {
    const settingsButton = event.target.closest("[data-settings]");
    if (settingsButton) {
        openSettings(settingsButton.dataset.settings);
        return;
    }
    const batchButton = event.target.closest("[data-batch]");
    if (batchButton) {
        batchSheet(batchButton.dataset.batch);
        return;
    }
    const button = event.target.closest("[data-more]");
    if (!button) {
        return;
    }
    switch (button.dataset.more) {
        case "file":
            fileInput.click();
            break;
        case "paste":
            pasteSheet();
            break;
        case "copy": {
            const data = exportForClaude();
            copy(JSON.stringify(data, null, 1), `Скопировано: ${tasksWord(data.items.length)}. Вставь в чат с Claude.`);
            break;
        }
        case "format":
            formatDoc ? copy(formatDoc, "Формат скопирован. Вставь его в чат с Claude.") : showToast("Формат ещё не загрузился, попробуй через секунду");
            break;
        case "rollback":
            rollback();
            break;
        case "backup":
            backup();
            break;
    }
}

function copy(text, message) {
    haptic();
    navigator.clipboard.writeText(text)
        .then(() => showToast(message, null, null, 5000))
        .catch(() => showToast("Не получилось скопировать"));
}

async function rollback() {
    haptic();
    const last = await rollbackImport();
    refresh();
    showToast(last ? `Откатил «${last.label}»` : "Откатывать нечего");
}

async function backup() {
    haptic();
    const name = `plan-backup-${dayKey(new Date())}.json`;
    if (await saveFile(name, JSON.stringify(makeBackup()))) {
        await setMeta("lastBackupAt", toIso(new Date()));
        showToast("Бэкап готов");
        refresh();
    }
}

// ---- вставка текста ----
function pasteSheet() {
    const { sheet, close } = openSheet(`
        <div class="sheet-body">
            <h2>Вставить из&nbsp;чата</h2>
            <textarea class="textarea paste-area" id="pasteText" rows="6" placeholder="Скопируй ответ Claude целиком и вставь сюда"></textarea>
            ${navigator.clipboard?.readText ? `<button class="btn ghost wide" id="fromClipboard" style="margin-top: var(--sp-8)">Вставить из&nbsp;буфера</button>` : ""}
        </div>
        <div class="sheet-foot">
            <button class="btn ghost grow" data-close>Отмена</button>
            <button class="btn primary grow" id="pasteGo">Дальше</button>
        </div>`);
    const area = sheet.querySelector("#pasteText");
    sheet.querySelector("[data-close]").addEventListener("click", close);
    sheet.querySelector("#fromClipboard")?.addEventListener("click", () => {
        navigator.clipboard.readText().then(text => area.value = text).catch(() => area.focus());
    });
    sheet.querySelector("#pasteGo").addEventListener("click", () => {
        if (!area.value.trim()) {
            area.focus();
            return;
        }
        close();
        handleText(area.value);
    });
}

// ---- превью ----
function handleText(text) {
    let pkg;
    try {
        pkg = readPackage(text);
    } catch (error) {
        showToast(error.message, null, null, 7000);
        return;
    }
    previewSheet(pkg.backup ? prepareBackup(pkg.backup) : preparePackage(pkg));
}

const SECTIONS = [
    ["add", "Добавится"],
    ["update", "Обновится"],
    ["conflict", "Конфликты"],
    ["skip", "Пропущено"]
];

function previewRow(row, newLists) {
    const task = row.task;
    const list = task && [...state.lists, ...newLists].find(item => item.id === task.list);
    const parts = task ? [whenText(task.plannedAt), task.due && "до " + relativeDay(task.due), list?.name].filter(Boolean) : [];
    const notes = [row.reason, ...(row.warnings || [])].filter(Boolean);
    return `
        <div class="preview-row">
            <div>${esc(task ? task.title : row.title)}</div>
            ${parts.length ? `<div class="sub">${parts.map(esc).join(" · ")}</div>` : ""}
            ${notes.map(note => `<div class="sub note">${esc(note)}</div>`).join("")}
        </div>`;
}

function previewSheet(plan) {
    let body;
    let count;
    if (plan.kind === "backup") {
        const backup = plan.backup;
        count = backup.tasks.filter(task => !task.deletedAt).length;
        body = `
            <h2>Восстановить бэкап</h2>
            <p>От&nbsp;<b>${esc(whenText(backup.exportedAt) || "неизвестной даты")}</b>: ${tasksWord(count)}, списков ${backup.lists.length}.</p>
            <div class="card notice">Всё, что сейчас в&nbsp;плане (${tasksWord(plan.current)}), заменится бэкапом. Передумаешь — «Откатить» во&nbsp;вкладке «Ещё».</div>`;
    } else {
        const by = type => plan.rows.filter(row => row.type === type);
        const unchanged = by("same").length;
        count = by("add").length + by("update").length + by("conflict").length;
        body = `
            <h2>Импорт${plan.batch ? ` «${esc(plan.batch)}»` : ""}</h2>
            <div class="preview-sum mono">
                ${SECTIONS.map(([type, label]) => by(type).length ? `<span class="${type}">${label}: ${by(type).length}</span>` : "").join("")}
                ${unchanged ? `<span>Без изменений: ${unchanged}</span>` : ""}
            </div>
            ${plan.newLists.length ? `<p class="text-2">Новые списки: ${plan.newLists.map(list => "«" + esc(list.name) + "»").join(", ")}</p>` : ""}
            ${SECTIONS.map(([type, label]) => by(type).length ? `
                <div class="label">${label}</div>${by(type).map(row => previewRow(row, plan.newLists)).join("")}` : "").join("")}
            ${!count ? `<p class="text-2">Нечего импортировать: всё уже в&nbsp;плане.</p>` : ""}`;
    }

    const { sheet, close } = openSheet(`
        <div class="sheet-body">${body}</div>
        <div class="sheet-foot">
            <button class="btn ghost grow" data-close>Отмена</button>
            ${count ? `<button class="btn primary grow" id="apply">${plan.kind === "backup" ? "Восстановить" : "Импортировать " + count}</button>` : ""}
        </div>`);
    sheet.querySelector("[data-close]").addEventListener("click", close);
    sheet.querySelector("#apply")?.addEventListener("click", async () => {
        haptic();
        close();
        await applyPlan(plan);
        showToast(plan.kind === "backup" ? "Бэкап восстановлен" : `Готово: ${tasksWord(count)}`, "Откатить", rollback);
    });
}

// ---- пакет: сдвинуть или удалить ----
function batchSheet(batch) {
    const group = batches().find(item => item.batch === batch);
    if (!group) {
        return;
    }
    const { sheet, close } = openSheet(`
        <div class="sheet-body">
            <h2>Пакет «${esc(batch)}»</h2>
            <p class="text-2">${tasksWord(group.count)}, сделано ${group.done}${group.first ? ", первая " + esc(whenText(group.first)) : ""}.</p>
            <div class="label">Сдвинуть все даты</div>
            <div class="chips">${SHIFTS.map(days => `
                <button class="chip-btn mono" data-shift="${days}">${days > 0 ? "+" : "−"}${Math.abs(days)}&nbsp;${Math.abs(days) === 1 ? "день" : "дней"}</button>`).join("")}
            </div>
        </div>
        <div class="sheet-foot">
            <button class="btn ghost grow" id="trashBatch">Удалить пакет</button>
            <button class="btn primary grow" data-close>Готово</button>
        </div>`);
    sheet.querySelector("[data-close]").addEventListener("click", close);
    sheet.querySelectorAll("[data-shift]").forEach(button => button.addEventListener("click", async () => {
        haptic();
        const days = +button.dataset.shift;
        close();
        await shiftBatch(batch, days);
        showToast(`Сдвинул на ${days > 0 ? "+" : "−"}${Math.abs(days)} дн.`, "Отменить", () => shiftBatch(batch, -days));
    }));
    sheet.querySelector("#trashBatch").addEventListener("click", async () => {
        haptic();
        close();
        const undo = await trashBatch(batch);
        showToast(`Пакет в корзине: ${tasksWord(group.count)}`, "Вернуть", undo);
    });
}
