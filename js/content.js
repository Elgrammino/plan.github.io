// Контент-конвейер: публикация — задача kind: "post" со стадией status и полем post.
// Три вида: конвейер по стадиям, календарь публикаций, сетка ленты.
import { monthGrid, monthRange, occurrences } from "./calendar.js";
import { dayKey, dayOf, hasTime, parseDate, relativeDay, timeText } from "./dates.js";
import { editTask } from "./sheets.js";
import { newTask, restoreTask, saveTask, setDone, state, trashTask } from "./store.js";
import { esc, escTitle, haptic, onLongPress, openSheet, showToast } from "./ui.js";

const STAGES = ["идея", "сценарий", "снято", "смонтировано", "вышло"];
const FORMATS = [["reels", "Рилс"], ["post", "Пост"], ["stories", "Сторис"]];

const FORMAT_ICON = {
    reels: `<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M10 9l5 3-5 3z"/></svg>`,
    post: `<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 15l5-4 4 3 3-2 4 3"/></svg>`,
    stories: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" stroke-dasharray="4 2.5"/></svg>`
};

const VIEWS = [["flow", "Конвейер"], ["calendar", "Календарь"], ["feed", "Лента"]];
let view = "flow";
let month = new Date();
let selected = dayKey(new Date());
let showAllPublished = false;

const posts = () => [...state.tasks.values()].filter(task => task.kind === "post" && !task.deletedAt);
const stageOf = task => STAGES.includes(task.status) ? task.status : task.done ? "вышло" : "идея";
const when = task => task.plannedAt ? relativeDay(task.plannedAt) + (hasTime(task.plannedAt) ? " " + timeText(task.plannedAt) : "") : "без даты";
const icon = task => FORMAT_ICON[task.post?.format] || FORMAT_ICON.reels;

function card(task) {
    const stage = stageOf(task);
    const next = STAGES[STAGES.indexOf(stage) + 1];
    return `
        <div class="post-card stage-${STAGES.indexOf(stage)}" data-id="${task.id}">
            <span class="format">${icon(task)}</span>
            <button class="body" data-action="edit">
                <div class="name">${escTitle(task.title)}</div>
                <div class="sub">${esc([when(task), task.post?.rubric].filter(Boolean).join(" · "))}</div>
                ${task.post?.hook ? `<div class="hook">${esc(task.post.hook)}</div>` : ""}
            </button>
            ${next ? `<button class="chip-btn" data-advance="${task.id}" aria-label="Дальше: ${next}">→ ${next}</button>` : ""}
        </div>`;
}

// ---- вкладка ----
export function renderContent(el) {
    const all = posts();
    let body = "";
    if (view === "flow") {
        body = STAGES.map(stage => {
            let list = all.filter(task => stageOf(task) === stage)
                .sort((a, b) => (a.plannedAt || "9").localeCompare(b.plannedAt || "9"));
            let more = "";
            if (stage === "вышло") {
                list = list.reverse();
                if (!showAllPublished && list.length > 5) {
                    more = `<button class="chip-btn" data-all-published>Ещё ${list.length - 5}</button>`;
                    list = list.slice(0, 5);
                }
            }
            return `<div class="label stage-label">${stage}<span class="mono">${all.filter(task => stageOf(task) === stage).length}</span></div>` +
                (list.map(card).join("") || `<p class="stage-empty">—</p>`) + more;
        }).join("");
    } else if (view === "calendar") {
        const [from, to] = monthRange(month);
        const items = occurrences(from, to, task => task.kind === "post");
        const marks = new Map();
        items.forEach(({ task, day }) => marks.set(day, (marks.get(day) || "") + `<b class="${stageOf(task) === "вышло" ? "done" : ""}">${icon(task)}</b>`));
        const today = items.filter(item => item.day === selected).map(item => item.task);
        const undated = all.filter(task => !task.plannedAt && !task.done);
        body = monthGrid(month, selected, marks) +
            `<div class="label">${esc(parseDate(selected).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" }))}</div>` +
            (today.map(card).join("") || `<p class="search-empty">В этот день публикаций нет.</p>`) +
            (undated.length ? `<div class="label">Без даты · ${undated.length}</div>` + undated.map(card).join("") : "");
    } else {
        // лента как в профиле: свежие сверху, сторис в сетку не попадают
        const grid = all.filter(task => task.post?.format !== "stories" && task.plannedAt)
            .sort((a, b) => b.plannedAt.localeCompare(a.plannedAt));
        const nowKey = dayKey(new Date());
        body = grid.length ? `<div class="feed">${grid.map(task => `
            <button class="tile ${stageOf(task) === "вышло" ? "out" : dayOf(task.plannedAt) < nowKey ? "late" : "planned"}" data-id="${task.id}" data-action="edit">
                <span class="format">${icon(task)}</span>
                <span class="tile-title">${esc(task.title)}</span>
                <span class="tile-date mono">${esc(parseDate(task.plannedAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }))}</span>
            </button>`).join("")}</div>
            <p class="hint" style="margin-top: var(--sp-12)">Сплошные — вышли, пунктир — запланированы. Сторис в&nbsp;сетке нет, как и&nbsp;в&nbsp;профиле.</p>`
            : `<p class="search-empty">В ленте пусто: у&nbsp;публикаций пока нет дат.</p>`;
    }

    el.innerHTML = `
        <h1 class="title">Контент</h1>
        <div class="segmented">${VIEWS.map(([id, label]) => `<button data-view="${id}" ${id === view ? 'aria-current="true"' : ""}>${label}</button>`).join("")}</div>
        ${all.length || view !== "flow" ? body : `
            <div class="empty">
                <svg class="mark" viewBox="0 0 64 64"><rect x="14" y="10" width="36" height="44" rx="6"/><path d="M28 26l10 6-10 6z"/></svg>
                <p>Публикаций пока нет. «+» добавит идею.</p>
            </div>`}`;
}

export function onContentClick(event, rerender) {
    const viewButton = event.target.closest("[data-view]");
    const advance = event.target.closest("[data-advance]");
    if (viewButton) {
        view = viewButton.dataset.view;
    } else if (advance) {
        haptic();
        const task = state.tasks.get(advance.dataset.advance);
        const next = STAGES[STAGES.indexOf(stageOf(task)) + 1];
        if (next === "вышло") {
            setDone(task, true);
        } else {
            task.status = next;
            saveTask(task);
        }
        showToast(`«${task.title}» — ${next}`);
        return true;
    } else if (event.target.closest("[data-all-published]")) {
        showAllPublished = true;
    } else if (event.target.closest("[data-month]")) {
        month = new Date(month.getFullYear(), month.getMonth() + +event.target.closest("[data-month]").dataset.month, 1);
    } else if (event.target.closest("[data-pick]")) {
        selected = event.target.closest("[data-pick]").dataset.pick;
    } else {
        return false;
    }
    rerender();
    return true;
}

// долгое нажатие на публикацию: «Изменить» или «Удалить» — создал не ту, убери в корзину
export function bindPostMenu(container) {
    onLongPress(container, "#content .post-card[data-id], #content .tile[data-id]", target => {
        const task = state.tasks.get(target.dataset.id);
        if (!task) {
            return;
        }
        const { sheet, close } = openSheet(`
            <div class="sheet-body">
                <h2>${escTitle(task.title)}</h2>
                <div class="actions">
                    <button class="btn ghost wide" data-menu="edit">Изменить</button>
                    <button class="btn ghost wide" data-menu="delete">Удалить в корзину</button>
                </div>
            </div>
            <div class="sheet-foot"><button class="btn ghost grow" data-close>Отмена</button></div>`);
        sheet.querySelector("[data-close]").addEventListener("click", close);
        sheet.querySelector('[data-menu="edit"]').addEventListener("click", () => {
            close();
            editTask(task);
        });
        sheet.querySelector('[data-menu="delete"]').addEventListener("click", () => {
            haptic();
            close();
            trashTask(task);
            showToast(`«${task.title}» в корзине`, "Вернуть", () => restoreTask(task));
        });
    });
}

// «+» на вкладке: новая идея; в календаре — на выбранный день
export function newPost() {
    const insta = state.lists.find(list => /инст/i.test(list.name));
    editTask(newTask({
        kind: "post",
        status: "идея",
        list: insta?.id || null,
        plannedAt: view === "calendar" ? selected : null,
        post: { format: "reels" }
    }));
}

// ---- поля публикации в карточке задачи ----
export function postFieldsHtml(task) {
    const post = task.post || {};
    const rubrics = [...new Set(posts().map(item => item.post?.rubric).filter(Boolean))];
    const radios = (name, options, value) => `<div class="chips">${options.map(([id, label]) => `
        <label class="chip"><input type="radio" name="${name}" value="${esc(id)}" ${id === value ? "checked" : ""}><span>${label}</span></label>`).join("")}</div>`;
    return `
        <div class="field" id="postFields">
            <div class="label">Формат</div>
            ${radios("postFormat", FORMATS, post.format || "reels")}
            <div class="label">Стадия</div>
            ${radios("postStage", STAGES.map(stage => [stage, stage]), stageOf(task))}
            <div class="row" style="margin-top: var(--sp-12)">
                <span class="text-2 row-label">Рубрика</span>
                <input class="input" data-post="rubric" list="rubrics" value="${esc(post.rubric || "")}" placeholder="Фокусы на улице" autocomplete="off">
                <datalist id="rubrics">${rubrics.map(rubric => `<option value="${esc(rubric)}">`).join("")}</datalist>
            </div>
            <div class="label">Крючок</div>
            <textarea class="textarea" data-post="hook" rows="2" placeholder="Первые 2 секунды: чем зацепить">${esc(post.hook || "")}</textarea>
            <div class="label">Подпись</div>
            <textarea class="textarea" data-post="caption" rows="4" placeholder="Текст под публикацией">${esc(post.caption || "")}</textarea>
            <input class="input" data-post="hashtags" value="${esc(post.hashtags || "")}" placeholder="#фокус #магия" style="margin-top: var(--sp-8)" autocomplete="off">
            <button class="chip-btn" id="copyCaption" style="margin-top: var(--sp-8)">Скопировать подпись с&nbsp;хэштегами</button>
        </div>`;
}

export function bindPostFields(sheet) {
    sheet.querySelector("#copyCaption")?.addEventListener("click", () => {
        const { caption = "", hashtags = "" } = readPostFields(sheet).post || {};
        const text = [caption, hashtags].filter(Boolean).join("\n\n");
        if (!text) {
            showToast("Подпись пустая");
            return;
        }
        haptic();
        navigator.clipboard.writeText(text).then(() => showToast("Подпись скопирована")).catch(() => showToast("Не получилось скопировать"));
    });
}

export function readPostFields(sheet) {
    const post = { format: sheet.querySelector('input[name="postFormat"]:checked')?.value || "reels" };
    sheet.querySelectorAll("[data-post]").forEach(input => {
        const value = input.value.trim();
        if (value) {
            post[input.dataset.post] = value;
        }
    });
    return { post, status: sheet.querySelector('input[name="postStage"]:checked')?.value || "идея" };
}
