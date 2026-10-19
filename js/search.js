// Поиск по задачам: название, заметки, шаги, список, метки, выступление.
// Без учёта регистра и разницы е/ё; все слова запроса должны найтись.
import { hasTime, relativeDay, timeText } from "./dates.js";
import { repeatText } from "./repeat.js";
import { editTask } from "./sheets.js";
import { listName, onChange, state } from "./store.js";
import { esc, openSheet } from "./ui.js";

// ё → е не меняет длину строки, поэтому позиции совпадений годятся и для исходного текста
const norm = text => String(text ?? "").toLowerCase().replace(/ё/g, "е");

function fields(task) {
    return [
        task.notes,
        ...task.checklist.map(step => step.text),
        listName(task.list),
        ...task.tags,
        task.show?.client,
        task.show?.address,
        task.show?.format
    ].filter(Boolean);
}

export function search(query) {
    const words = norm(query).split(/\s+/).filter(Boolean);
    if (!words.length) {
        return { words, tasks: [] };
    }
    const tasks = [...state.tasks.values()]
        .filter(task => !task.deletedAt)
        .filter(task => {
            const text = norm([task.title, ...fields(task)].join("\n"));
            return words.every(word => text.includes(word));
        })
        // сначала несделанное, потом по дате; без даты в конце
        .sort((a, b) => a.done - b.done || (a.plannedAt || "9").localeCompare(b.plannedAt || "9"));
    return { words, tasks };
}

// подсветка совпадений; текст экранируется по кусочкам
function mark(text, words) {
    const lower = norm(text);
    const hits = [];
    words.forEach(word => {
        for (let at = lower.indexOf(word); at !== -1; at = lower.indexOf(word, at + word.length)) {
            hits.push([at, at + word.length]);
        }
    });
    hits.sort((a, b) => a[0] - b[0]);
    let html = "";
    let pos = 0;
    hits.forEach(([from, to]) => {
        if (from < pos) {
            return;
        }
        html += esc(text.slice(pos, from)) + "<mark>" + esc(text.slice(from, to)) + "</mark>";
        pos = to;
    });
    return html + esc(text.slice(pos));
}

// кусочек заметки или шага, где нашлось слово, которого нет в названии
function snippet(task, words) {
    const title = norm(task.title);
    const missing = words.filter(word => !title.includes(word));
    if (!missing.length) {
        return "";
    }
    const field = fields(task).find(text => missing.some(word => norm(text).includes(word)));
    if (!field) {
        return "";
    }
    const line = field.split("\n").find(part => missing.some(word => norm(part).includes(word))) || field;
    const at = Math.max(0, norm(line).indexOf(missing.find(word => norm(line).includes(word)) || "") - 30);
    const cut = (at ? "…" : "") + line.slice(at, at + 90) + (line.length > at + 90 ? "…" : "");
    return `<div class="snippet">${mark(cut, words)}</div>`;
}

function result(task, words) {
    const parts = [
        task.plannedAt ? relativeDay(task.plannedAt) + (hasTime(task.plannedAt) ? " " + timeText(task.plannedAt) : "") : "во Входящих",
        listName(task.list),
        task.repeat && "↻ " + repeatText(task.repeat),
        task.done && "сделано"
    ].filter(Boolean);
    return `
        <button class="result ${task.done ? "done" : ""}" data-id="${task.id}">
            <div class="name">${mark(task.title, words)}</div>
            <div class="sub">${parts.map(esc).join(" · ")}</div>
            ${snippet(task, words)}
        </button>`;
}

export function openSearch() {
    let unsubscribe = () => { };
    const { sheet, close } = openSheet(`
        <div class="sheet-body">
            <input class="input" id="query" type="search" enterkeyhint="search" autocomplete="off"
                   placeholder="Задачи, заметки, шаги" aria-label="Поиск">
            <div id="results"></div>
        </div>
        <div class="sheet-foot"><button class="btn ghost grow" data-close>Закрыть</button></div>`,
        { onClose: () => unsubscribe() });
    sheet.classList.add("tall");
    const input = sheet.querySelector("#query");
    const results = sheet.querySelector("#results");

    const render = () => {
        const { words, tasks } = search(input.value);
        if (!words.length) {
            results.innerHTML = `<p class="search-empty">Ищет в&nbsp;названиях, заметках, шагах и&nbsp;списках, включая сделанное.</p>`;
            return;
        }
        results.innerHTML = tasks.length
            ? `<div class="label">Нашлось ${tasks.length}</div>` + tasks.slice(0, 50).map(task => result(task, words)).join("")
            : `<p class="search-empty">Ничего не&nbsp;нашлось.</p>`;
    };
    // правка из найденного сразу видна в результатах
    unsubscribe = onChange(render);
    input.addEventListener("input", render);
    input.addEventListener("keydown", event => event.key === "Enter" && input.blur());
    results.addEventListener("click", event => {
        const task = state.tasks.get(event.target.closest("[data-id]")?.dataset.id);
        if (task) {
            editTask(task);
        }
    });
    sheet.querySelector("[data-close]").addEventListener("click", close);
    render();
    input.focus();
}
