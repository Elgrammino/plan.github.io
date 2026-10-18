// Шторки: быстрое добавление, редактирование задачи, перенос.
import { addDays, dayKey, dayOf, durationText, hasTime, relativeDay, timeText, toIso } from "./dates.js";
import { parseQuick } from "./parse.js";
import { POSTPONE, newTask, postponed, restoreTask, saveTask, state, trashTask } from "./store.js";
import { ICONS, esc, haptic, openSheet, showToast } from "./ui.js";

const DURATIONS = [15, 30, 45, 60, 90, 120];
const ENERGY = [["low", "Лёгкое", "●"], ["mid", "Среднее", "●●"], ["high", "Тяжёлое", "●●●"]];

function chips(name, options, selected) {
    return `<div class="chips">` + options.map(([value, label]) => `
        <label class="chip"><input type="radio" name="${name}" value="${esc(value)}" ${value === selected ? "checked" : ""}><span>${label}</span></label>`).join("") + `</div>`;
}

// повторное нажатие на выбранный чип снимает выбор
function allowUncheck(root) {
    root.querySelectorAll(".chip input").forEach(input => {
        input.addEventListener("pointerdown", () => input.dataset.was = input.checked);
        input.addEventListener("click", () => {
            if (input.dataset.was === "true" && input.dataset.optional !== undefined) {
                input.checked = false;
                input.dispatchEvent(new Event("change", { bubbles: true }));
            }
        });
    });
}

function autoGrow(textarea) {
    const grow = () => {
        textarea.style.height = "auto";
        textarea.style.height = textarea.scrollHeight + "px";
    };
    textarea.addEventListener("input", grow);
    requestAnimationFrame(grow);
}

function describe(fields) {
    const parts = [];
    if (fields.plannedAt) {
        parts.push(relativeDay(fields.plannedAt) + (hasTime(fields.plannedAt) ? " в " + timeText(fields.plannedAt) : ""));
    } else {
        parts.push("во Входящие");
    }
    if (fields.durationMin) {
        parts.push(durationText(fields.durationMin));
    }
    if (fields.list) {
        parts.push(state.lists.find(list => list.id === fields.list)?.name);
    }
    if (fields.priority === "high") {
        parts.push("важно");
    }
    return parts.map(esc).join(" · ");
}

// ---- быстрое добавление ----
export function quickAdd() {
    const { sheet, close } = openSheet(`
        <div class="sheet-body">
            <h2>Новая задача</h2>
            <input class="input" id="quickText" enterkeyhint="done" autocomplete="off"
                   placeholder="завтра в 19 рилс 1ч #инста">
            <div class="preview" id="quickPreview">Можно сразу писать время, длительность и #список</div>
            <div class="added" id="quickAdded"></div>
        </div>
        <div class="sheet-foot">
            <button class="btn ghost grow" data-close>Готово</button>
            <button class="btn primary grow" id="quickAdd">Добавить</button>
        </div>`);
    const input = sheet.querySelector("#quickText");
    const preview = sheet.querySelector("#quickPreview");
    const added = sheet.querySelector("#quickAdded");
    input.focus();

    const parse = () => parseQuick(input.value, { lists: state.lists });
    input.addEventListener("input", () => {
        const fields = parse();
        preview.innerHTML = input.value.trim() ? `<b>${esc(fields.title || "…")}</b> · ${describe(fields)}` : "";
    });

    const add = () => {
        const fields = parse();
        if (!fields.title) {
            input.focus();
            return;
        }
        haptic();
        saveTask(newTask(fields));
        added.insertAdjacentHTML("afterbegin", `<div>✓ ${esc(fields.title)} · ${describe(fields)}</div>`);
        input.value = "";
        preview.innerHTML = "";
        input.focus();
    };
    sheet.querySelector("#quickAdd").addEventListener("click", add);
    input.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            event.preventDefault();
            add();
        }
    });
    sheet.querySelector("[data-close]").addEventListener("click", close);
}

// ---- редактирование ----
export function editTask(task) {
    const lists = [["", "Без списка"], ...state.lists.map(list => [list.id, esc(list.name)])];
    const plannedDay = dayOf(task.plannedAt) || "";
    const plannedTime = hasTime(task.plannedAt) ? timeText(task.plannedAt) : "";
    const today = dayKey(new Date());
    const tomorrow = dayKey(addDays(new Date(), 1));
    const when = !plannedDay ? "inbox" : plannedDay === today ? "today" : plannedDay === tomorrow ? "tomorrow" : "";

    const { sheet, close } = openSheet(`
        <div class="sheet-body">
            <textarea class="textarea title-input" id="title" rows="1" placeholder="Что сделать">${esc(task.title)}</textarea>

            <div class="field"><div class="label">Когда</div>
                ${chips("when", [["inbox", "Входящие"], ["today", "Сегодня"], ["tomorrow", "Завтра"]], when)}
                <div class="row" style="margin-top: var(--sp-8)">
                    <input class="input" type="date" id="day" value="${plannedDay}" aria-label="День">
                    <input class="input" type="time" id="time" value="${plannedTime}" aria-label="Время">
                </div>
            </div>

            <div class="field"><div class="label">Длительность</div>
                ${chips("duration", DURATIONS.map(min => [String(min), durationText(min)]), String(task.durationMin || ""))}
            </div>

            <div class="field"><div class="label">Энергия</div>
                ${chips("energy", ENERGY.map(([value, label, dots]) => [value, `${label}&nbsp;<span class="energy">${dots}</span>`]), task.energy)}
            </div>

            <div class="field"><div class="label">Список</div>
                ${chips("list", lists, task.list || "")}
            </div>

            <div class="field"><div class="label">Сроки</div>
                <div class="row"><span class="text-2" style="width: 96px">Дедлайн</span>
                    <input class="input" type="date" id="due" value="${dayOf(task.due) || ""}"></div>
                <div class="row" style="margin-top: var(--sp-8)"><span class="text-2" style="width: 96px">Не раньше</span>
                    <input class="input" type="date" id="start" value="${task.start || ""}"></div>
            </div>

            <div class="field">
                <label class="toggle"><span>Важно</span><input type="checkbox" switch id="priority" ${task.priority === "high" ? "checked" : ""}></label>
                <label class="toggle"><span>Настойчиво<small>Напоминать, пока не отмечу или не перенесу</small></span>
                    <input type="checkbox" switch id="persistent" ${task.persistent ? "checked" : ""}></label>
            </div>

            <div class="field"><div class="label">Шаги</div>
                <div id="checklist"></div>
                <input class="input" id="newStep" enterkeyhint="done" placeholder="Добавить шаг" style="margin-top: var(--sp-8)">
            </div>

            <div class="field"><div class="label">Заметки</div>
                <textarea class="textarea" id="notes" rows="2" placeholder="Подробности, ссылки">${esc(task.notes)}</textarea>
            </div>
        </div>
        <div class="sheet-foot">
            <button class="icon-btn" id="delete" aria-label="Удалить">${ICONS.trash}</button>
            <button class="btn ghost grow" id="postpone">Перенести</button>
            <button class="btn primary grow" data-close>Готово</button>
        </div>`, { onClose: save });

    const $ = selector => sheet.querySelector(selector);
    autoGrow($("#title"));
    autoGrow($("#notes"));
    sheet.querySelectorAll('input[name="duration"], input[name="energy"]').forEach(input => input.dataset.optional = "");
    allowUncheck(sheet);
    if (!task.title) {
        $("#title").focus();
    }

    // чипы «Когда» и поле даты управляют друг другом
    sheet.querySelectorAll('input[name="when"]').forEach(input => input.addEventListener("change", () => {
        $("#day").value = { inbox: "", today, tomorrow }[input.value];
        if (input.value === "inbox") {
            $("#time").value = "";
        }
    }));
    const syncWhen = () => {
        const day = $("#day").value;
        const value = !day ? "inbox" : day === today ? "today" : day === tomorrow ? "tomorrow" : "";
        sheet.querySelectorAll('input[name="when"]').forEach(input => input.checked = input.value === value);
    };
    $("#day").addEventListener("change", syncWhen);
    $("#time").addEventListener("change", () => {
        if ($("#time").value && !$("#day").value) {
            $("#day").value = today;
            syncWhen();
        }
    });

    // шаги
    const steps = task.checklist.map(step => ({ ...step }));
    const renderSteps = () => {
        $("#checklist").innerHTML = steps.map((step, i) => `
            <div class="checklist-item">
                <input type="checkbox" data-i="${i}" ${step.done ? "checked" : ""} aria-label="Шаг сделан">
                <input class="input" data-i="${i}" value="${esc(step.text)}">
            </div>`).join("");
    };
    renderSteps();
    $("#checklist").addEventListener("change", event => {
        const step = steps[event.target.dataset.i];
        if (event.target.type === "checkbox") {
            step.done = event.target.checked;
        } else {
            step.text = event.target.value;
        }
    });
    $("#newStep").addEventListener("keydown", event => {
        if (event.key === "Enter" && $("#newStep").value.trim()) {
            event.preventDefault();
            steps.push({ text: $("#newStep").value.trim(), done: false });
            $("#newStep").value = "";
            renderSteps();
        }
    });

    function read() {
        const day = $("#day").value;
        const time = $("#time").value;
        const checked = name => sheet.querySelector(`input[name="${name}"]:checked`)?.value || null;
        const pending = $("#newStep").value.trim();
        return {
            title: $("#title").value.trim(),
            plannedAt: !day ? null : time ? toIso(new Date(`${day}T${time}`)) : day,
            durationMin: +checked("duration") || null,
            energy: checked("energy"),
            list: checked("list") || null,
            due: $("#due").value || null,
            start: $("#start").value || null,
            priority: $("#priority").checked ? "high" : "normal",
            persistent: $("#persistent").checked,
            notes: $("#notes").value.trim(),
            checklist: [...steps, ...(pending ? [{ text: pending, done: false }] : [])].filter(step => step.text.trim())
        };
    }

    let deleted = false;
    function save() {
        if (deleted) {
            return;
        }
        const fields = read();
        if (!fields.title) {
            return; // пустую задачу не сохраняем
        }
        const changed = Object.keys(fields).some(key => JSON.stringify(fields[key]) !== JSON.stringify(task[key] ?? null));
        if (changed || !state.tasks.has(task.id)) {
            Object.assign(task, fields);
            saveTask(task);
        }
    }

    sheet.querySelector("[data-close]").addEventListener("click", close);
    $("#delete").addEventListener("click", () => {
        deleted = true;
        close();
        if (state.tasks.has(task.id)) {
            trashTask(task);
            showToast("Задача в корзине", "Вернуть", () => restoreTask(task));
        }
    });
    $("#postpone").addEventListener("click", () => {
        save();
        deleted = true; // уже сохранено, повторно не сохранять при закрытии
        close();
        postponeTask(task);
    });
}

// ---- перенос в одно касание ----
export function postponeTask(task) {
    const now = new Date();
    const { sheet, close } = openSheet(`
        <div class="sheet-body">
            <h2>Перенести «${esc(task.title)}»</h2>
            <div class="actions">
                ${POSTPONE.map(option => {
                    const at = postponed(task, option.id, now);
                    return `<button class="btn ghost wide" data-option="${option.id}">${option.label}
                        <span class="mono">${esc(relativeDay(at, now))} ${timeText(at)}</span></button>`;
                }).join("")}
                <button class="btn ghost wide" data-option="inbox">Во Входящие <span class="mono">без даты</span></button>
            </div>
        </div>
        <div class="sheet-foot"><button class="btn ghost grow" data-close>Отмена</button></div>`);
    sheet.querySelector("[data-close]").addEventListener("click", close);
    sheet.querySelectorAll("[data-option]").forEach(button => button.addEventListener("click", () => {
        haptic();
        const before = task.plannedAt;
        task.plannedAt = button.dataset.option === "inbox" ? null : postponed(task, button.dataset.option, now);
        saveTask(task);
        close();
        const text = task.plannedAt ? `Перенесено на ${relativeDay(task.plannedAt)} ${timeText(task.plannedAt)}` : "Во Входящих";
        showToast(text, "Отменить", () => {
            task.plannedAt = before;
            saveTask(task);
        });
    }));
}
