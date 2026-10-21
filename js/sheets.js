// Шторки: быстрое добавление, редактирование задачи, перенос.
import { addDays, dayKey, dayOf, durationText, hasTime, parseDate, plural, relativeDay, timeText, toIso } from "./dates.js";
import { parseQuick } from "./parse.js";
import { WEEKDAYS, WEEKDAY_SHORT, firstDate, repeatText, weekdayCode } from "./repeat.js";
import { newTask, nextSlot, postponeOptions, postponed, restoreTask, saveTask, setDone, state, trashTask } from "./store.js";
import { editTemplate } from "./settings.js";
import { startFocus } from "./focus.js";
import { applyChain, chainTasks, planChain } from "./chains.js";
import { readShowFields, showFieldsHtml } from "./show.js";
import { bindPostFields, postFieldsHtml, readPostFields } from "./content.js";
import { weekGoals } from "./goals.js";
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
    const ranged = hasTime(fields.plannedAt) && fields.durationMin;
    if (ranged) {
        const end = toIso(new Date(parseDate(fields.plannedAt).getTime() + fields.durationMin * 60000));
        parts.push(`${relativeDay(fields.plannedAt)} ${timeText(fields.plannedAt)}–${timeText(end)}`);
    } else if (fields.plannedAt) {
        parts.push(relativeDay(fields.plannedAt) + (hasTime(fields.plannedAt) ? " в " + timeText(fields.plannedAt) : ""));
    } else {
        parts.push("во Входящие");
    }
    if (fields.durationMin) {
        parts.push(durationText(fields.durationMin));
    }
    if (fields.repeat) {
        parts.push("↻ " + repeatText(fields.repeat));
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
export function quickAdd({ day = null } = {}) {
    const { sheet, close } = openSheet(`
        <div class="sheet-body">
            <h2>Новая задача</h2>
            <input class="input" id="quickText" enterkeyhint="done" autocomplete="off"
                   placeholder="завтра в 19 рилс 1ч #инста">
            <div class="preview" id="quickPreview">Можно сразу писать время, длительность, повтор и #список</div>
            ${navigator.clipboard?.readText ? `<button class="chip-btn" id="quickPaste" style="margin-top: var(--sp-8)">Вставить из&nbsp;буфера</button>` : ""}
            <div class="added" id="quickAdded"></div>
        </div>
        <div class="sheet-foot">
            <button class="btn ghost grow" data-close>Закрыть</button>
            <button class="btn primary grow" id="quickAdd">Добавить</button>
        </div>`);
    const input = sheet.querySelector("#quickText");
    const preview = sheet.querySelector("#quickPreview");
    const added = sheet.querySelector("#quickAdded");
    input.focus();

    const parse = () => {
        const fields = parseQuick(input.value, { lists: state.lists, fallbackDay: day ? parseDate(day) : null });
        // с длительностью, но без времени — следом за последней задачей дня
        const slot = fields.durationMin && fields.plannedAt && !hasTime(fields.plannedAt) && !fields.repeat && nextSlot(fields.plannedAt);
        if (slot) {
            fields.plannedAt = toIso(slot);
        }
        return fields;
    };
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
        added.insertAdjacentHTML("afterbegin", `<div class="added-row">${ICONS.check}<span>${esc(fields.title)} · ${describe(fields)}</span></div>`);
        input.value = "";
        preview.innerHTML = "";
        input.focus();
    };
    sheet.querySelector("#quickAdd").addEventListener("click", add);
    // продиктованное через Siri лежит в буфере
    sheet.querySelector("#quickPaste")?.addEventListener("click", () => {
        navigator.clipboard.readText().then(text => {
            input.value = text.trim().split("\n")[0];
            input.dispatchEvent(new Event("input"));
            input.focus();
        }).catch(() => showToast("iPhone не дал прочитать буфер"));
    });
    input.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            event.preventDefault();
            add();
        }
    });
    sheet.querySelector("[data-close]").addEventListener("click", close);
}

// ---- редактирование ----
// draft: задача ещё не в плане (карточка выгрузки) — сохранение и удаление решает вызывающий
export function editTask(task, draft = null) {
    const lists = [["", "Без списка"], ...state.lists.map(list => [list.id, esc(list.name)])];
    const plannedDay = dayOf(task.plannedAt) || "";
    const plannedTime = hasTime(task.plannedAt) ? timeText(task.plannedAt) : "";
    const today = dayKey(new Date());
    const tomorrow = dayKey(addDays(new Date(), 1));
    const when = !plannedDay ? "inbox" : plannedDay === today ? "today" : plannedDay === tomorrow ? "tomorrow" : "";

    const { sheet, close } = openSheet(`
        <div class="sheet-body">
            <textarea class="textarea title-input" id="title" rows="1" placeholder="Что сделать">${esc(task.title)}</textarea>
            ${chips("kind", [["task", "Задача"], ["post", "Публикация"], ["show", "Выступление"]], task.kind || "task")}
            <div class="field"><div class="label">Шаги</div>
                <div id="checklist"></div>
                <input class="input" id="newStep" enterkeyhint="done" placeholder="Добавить шаг" style="margin-top: var(--sp-8)">
                <div class="chips" id="templates" style="margin-top: var(--sp-8)">
                    ${state.templates.map(template => `<button class="chip-btn" data-template="${template.id}">+ ${esc(template.name)}</button>`).join("")}
                    <button class="chip-btn quiet" id="saveTemplate">Сохранить как шаблон</button>
                </div>
            </div>
            <div id="showBox"></div>

            <div class="field"><div class="label">Когда</div>
                ${chips("when", [["inbox", "Входящие"], ["today", "Сегодня"], ["tomorrow", "Завтра"]], when)}
                <div class="row" style="margin-top: var(--sp-8)">
                    <input class="input" type="date" id="day" value="${plannedDay}" aria-label="День">
                    <input class="input" type="time" id="time" value="${plannedTime}" aria-label="Время">
                    <button class="icon-btn" id="timeClear" aria-label="Без времени" ${plannedTime ? "" : "hidden"}>${ICONS.close}</button>
                </div>
                <div class="preview" id="slotHint" hidden></div>
            </div>

            <div class="field"><div class="label">Повтор</div>
                ${chips("repeatUnit", [["", "Нет"], ["day", "День"], ["week", "Неделя"], ["month", "Месяц"]], task.repeat?.unit || "")}
                <div id="repeatMore">
                    <div class="row" style="margin-top: var(--sp-8)">
                        <span class="text-2">Раз в</span>
                        <input class="input every" type="number" inputmode="numeric" min="1" max="99" id="every" value="${task.repeat?.every || 1}" aria-label="Как часто">
                        <span class="text-2" id="everyUnit"></span>
                    </div>
                    <div class="chips" id="weekdays" style="margin-top: var(--sp-8)">${WEEKDAYS.map(code => `
                        <label class="chip"><input type="checkbox" value="${code}" ${task.repeat?.weekdays?.includes(code) ? "checked" : ""}><span>${WEEKDAY_SHORT[code]}</span></label>`).join("")}
                    </div>
                    <div class="preview" id="repeatText"></div>
                </div>
            </div>

            <div class="field"><div class="label">Длительность</div>
                ${chips("duration", DURATIONS.map(min => [String(min), durationText(min)]), String(task.durationMin || ""))}
            </div>

            <div class="field"><div class="label">Список</div>
                ${chips("list", lists, task.list || "")}
            </div>

            ${weekGoals().length ? `<div class="field"><div class="label">Цель недели</div>
                ${chips("goal", weekGoals().map(goal => [goal.id, esc(goal.title)]), task.goal)}
            </div>` : ""}

            <div class="field">
                <label class="toggle"><span>Важно</span><input type="checkbox" switch id="priority" ${task.priority === "high" ? "checked" : ""}></label>
            </div>

            <details class="more-params" ${task.energy || task.due || task.start || task.persistent || (!draft && chainTasks(task).length) ? "open" : ""}>
                <summary>Ещё параметры</summary>
            <div class="field"><div class="label">Энергия</div>
                ${chips("energy", ENERGY.map(([value, label, dots]) => [value, `${label}&nbsp;<span class="energy">${dots}</span>`]), task.energy)}
            </div>

            ${draft ? "" : `<div class="field"><div class="label">Цепочка</div><div id="chain"></div></div>`}

            <div class="field"><div class="label">Сроки</div>
                <div class="row"><span class="text-2" style="width: 96px">Дедлайн</span>
                    <input class="input" type="date" id="due" value="${dayOf(task.due) || ""}"></div>
                <div class="row" style="margin-top: var(--sp-8)"><span class="text-2" style="width: 96px">Не раньше</span>
                    <input class="input" type="date" id="start" value="${task.start || ""}"></div>
            </div>

            <div class="field">
                <label class="toggle"><span>Настойчиво<small>Напоминать, пока не отмечу или не перенесу</small></span>
                    <input type="checkbox" switch id="persistent" ${task.persistent ? "checked" : ""}></label>
            </div>
            </details>

            <div class="field"><div class="label">Заметки</div>
                <textarea class="textarea" id="notes" rows="2" placeholder="Подробности, ссылки">${esc(task.notes)}</textarea>
            </div>
        </div>
        <div class="sheet-foot">
            <button class="icon-btn" id="delete" aria-label="Удалить">${ICONS.trash}</button>
            ${draft ? "" : `<button class="icon-btn" id="focus" aria-label="Фокус">${ICONS.timer}</button>
            <button class="btn ghost grow" id="postpone">Перенести</button>`}
            <button class="btn primary grow" data-close>Закрыть</button>
        </div>`, { onClose: save });

    const $ = selector => sheet.querySelector(selector);
    autoGrow($("#title"));
    autoGrow($("#notes"));
    sheet.querySelectorAll('input[name="duration"], input[name="energy"], input[name="goal"]').forEach(input => input.dataset.optional = "");
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
        syncSlot();
    });
    $("#time").addEventListener("blur", () => syncSlot());

    // время подряд: без своего времени задача с длительностью встаёт после последней задачи дня.
    // Пустое поле iOS заполняет текущим временем от одного касания — подставляем свободное заранее.
    let touched = !state.tasks.has(task.id);
    const autoSlot = () => {
        const day = $("#day").value;
        return touched && day && !$("#time").value && +sheet.querySelector('input[name="duration"]:checked')?.value
            ? nextSlot(day, task.id) : null;
    };
    const syncSlot = () => {
        const slot = autoSlot();
        $("#slotHint").hidden = !slot;
        $("#slotHint").textContent = slot ? `Без времени встанет на ${timeText(toIso(slot))} — следом за прошлой задачей дня` : "";
        $("#timeClear").hidden = !$("#time").value;
    };
    $("#time").addEventListener("focus", () => {
        if (!$("#time").value) {
            const slot = nextSlot($("#day").value || today, task.id);
            $("#time").value = slot ? timeText(toIso(slot)) : state.settings.dayStart;
        }
    });
    $("#timeClear").addEventListener("click", () => {
        haptic();
        $("#time").value = "";
        touched = true;
        syncSlot();
    });
    sheet.querySelectorAll('input[name="when"], input[name="duration"]').forEach(input => input.addEventListener("change", () => {
        touched = true;
        syncSlot();
    }));
    $("#day").addEventListener("change", () => {
        touched = true;
        syncSlot();
    });
    syncSlot();

    // повтор: подробности видны, только когда он выбран
    const UNIT_FORMS = { day: ["день", "дня", "дней"], week: ["неделю", "недели", "недель"], month: ["месяц", "месяца", "месяцев"] };
    const syncRepeat = () => {
        const repeat = readRepeat();
        $("#repeatMore").hidden = !repeat;
        if (!repeat) {
            return;
        }
        $("#weekdays").hidden = repeat.unit !== "week";
        $("#everyUnit").textContent = plural(repeat.every || 1, ...UNIT_FORMS[repeat.unit]);
        $("#repeatText").textContent = repeatText(repeat);
    };
    sheet.querySelectorAll('input[name="repeatUnit"]').forEach(input => input.addEventListener("change", () => {
        // неделя без отмеченных дней: отмечаем день задачи
        if (input.value === "week" && !sheet.querySelector("#weekdays input:checked")) {
            const code = weekdayCode($("#day").value ? new Date($("#day").value + "T12:00") : new Date());
            sheet.querySelector(`#weekdays input[value="${code}"]`).checked = true;
        }
        syncRepeat();
    }));
    ["#every", "#weekdays", "#day"].forEach(selector => $(selector).addEventListener("change", syncRepeat));
    $("#every").addEventListener("input", syncRepeat);
    syncRepeat();

    function readRepeat() {
        const unit = sheet.querySelector('input[name="repeatUnit"]:checked')?.value;
        if (!unit) {
            return null;
        }
        const repeat = { unit };
        const every = Math.max(1, Math.min(99, Math.round(+$("#every").value) || 1));
        if (every > 1) {
            repeat.every = every;
        }
        if (unit === "week") {
            const days = [...sheet.querySelectorAll("#weekdays input:checked")].map(input => input.value);
            if (days.length) {
                repeat.weekdays = days;
            }
        }
        if (unit === "month") {
            const day = $("#day").value;
            repeat.monthDay = day ? +day.slice(8) : task.repeat?.monthDay || new Date().getDate();
        }
        return repeat;
    }

    // шаги
    const steps = task.checklist.map(step => ({ ...step }));
    const renderSteps = () => {
        $("#checklist").innerHTML = steps.map((step, i) => `
            <div class="checklist-item">
                <input type="checkbox" data-i="${i}" ${step.done ? "checked" : ""} aria-label="Шаг сделан">
                <textarea class="input" data-i="${i}" rows="1">${esc(step.text)}</textarea>
            </div>`).join("");
        // длинный шаг переносится, а не уезжает за край поля
        $("#checklist").querySelectorAll("textarea").forEach(autoGrow);
    };
    renderSteps();
    // шаг — одна строка: Enter закрывает правку, а не вставляет перенос
    $("#checklist").addEventListener("keydown", event => {
        if (event.key === "Enter" && event.target.tagName === "TEXTAREA") {
            event.preventDefault();
            event.target.blur();
        }
    });
    $("#checklist").addEventListener("change", event => {
        const step = steps[event.target.dataset.i];
        if (event.target.type === "checkbox") {
            step.done = event.target.checked;
        } else {
            step.text = event.target.value;
        }
    });
    // шаблон добавляет свои шаги, кроме уже записанных
    $("#templates").addEventListener("click", event => {
        const template = state.templates.find(item => item.id === event.target.closest("[data-template]")?.dataset.template);
        if (!template) {
            return;
        }
        haptic();
        const have = new Set(steps.map(step => step.text.toLowerCase()));
        template.steps.filter(text => !have.has(text.toLowerCase())).forEach(text => steps.push({ text, done: false }));
        renderSteps();
    });
    $("#saveTemplate").addEventListener("click", () => {
        // шаг, набранный без Enter, тоже идёт в шаблон
        const texts = [...steps.map(step => step.text), $("#newStep").value].map(text => text.trim()).filter(Boolean);
        if (!texts.length) {
            showToast("Сначала добавь шаги");
            $("#newStep").focus();
            return;
        }
        editTemplate(null, () => showToast("Шаблон сохранён"), { name: $("#title").value.trim(), steps: texts });
    });

    $("#newStep").addEventListener("keydown", event => {
        if (event.key === "Enter" && $("#newStep").value.trim()) {
            event.preventDefault();
            steps.push({ text: $("#newStep").value.trim(), done: false });
            $("#newStep").value = "";
            renderSteps();
        }
    });

    // ---- выступление и публикация: свои поля видны, когда выбран этот тип ----
    const syncKind = () => {
        const kind = sheet.querySelector('input[name="kind"]:checked')?.value || "task";
        const box = $("#showBox");
        if (box.dataset.kind === kind) {
            return;
        }
        box.dataset.kind = kind;
        box.innerHTML = kind === "show" ? showFieldsHtml(task) : kind === "post" ? postFieldsHtml(task) : "";
        if (kind === "post") {
            bindPostFields(sheet);
        }
    };
    sheet.querySelectorAll('input[name="kind"]').forEach(input => input.addEventListener("change", syncKind));
    syncKind();

    // ---- цепочка: шаги от этой задачи, едут следом при переносе ----
    // перерисовываем, только если блок правда меняется: поле времени шлёт change при потере фокуса,
    // и перерисовка под пальцем съела бы нажатие на «+ Выступление»
    let chainKey = null;
    const renderChain = (picked = null) => {
        const box = $("#chain");
        if (!box) {
            return;
        }
        const children = chainTasks(task);
        const key = `${children.length}|${hasTime(read().plannedAt)}|${picked?.id || ""}`;
        if (key === chainKey) {
            return;
        }
        chainKey = key;
        if (children.length) {
            box.innerHTML = children.map(child => `
                <div class="chain-step ${child.done ? "done" : ""}">
                    <span class="mono">${child.plannedAt ? esc(relativeDay(child.plannedAt)) + " " + (hasTime(child.plannedAt) ? timeText(child.plannedAt) : "") : "—"}</span>
                    ${esc(child.title)}
                </div>`).join("") + `<p class="hint">Перенесёшь эту задачу — шаги поедут следом.</p>`;
            return;
        }
        if (!hasTime(read().plannedAt)) {
            box.innerHTML = `<p class="hint">Поставь день и время — и от них посчитаются шаги: снять, смонтировать, выезд…</p>`;
            return;
        }
        if (picked) {
            // шаги цепочки до создания + выбор чек-листа для сборов
            const preview = planChain(picked, { ...task, ...read(), show: readShowFields(sheet) || task.show });
            const needsKit = preview.some(step => /^сборы/i.test(step.title));
            box.innerHTML = preview.map(step => `
                <div class="chain-step"><span class="mono">${esc(relativeDay(toIso(step.at)))} ${timeText(toIso(step.at))}</span>${esc(step.title)}</div>`).join("") + `
                ${needsKit ? `<div class="label">Чек-лист для сборов</div>
                    ${chips("kit", [["", "Без чек-листа"], ...state.templates.map(template => [template.id, esc(template.name)])], state.templates.find(t => /^сборы/i.test(t.name))?.id || "")}` : ""}
                <div class="btns" style="margin-top: var(--sp-12)">
                    <button class="btn ghost" id="chainCancel">Отмена</button>
                    <button class="btn primary" id="chainApply">Создать ${preview.length}</button>
                </div>`;
            $("#chainCancel").addEventListener("click", () => renderChain());
            $("#chainApply").addEventListener("click", async () => {
                haptic();
                save(); // цепочка считается от сохранённой задачи
                if (!state.tasks.has(task.id)) {
                    showToast("Сначала дай задаче название");
                    return;
                }
                const kit = state.templates.find(template => template.id === sheet.querySelector('input[name="kit"]:checked')?.value);
                await applyChain(picked, task, kit?.steps || []);
                renderChain();
            });
            return;
        }
        box.innerHTML = `<div class="chips">${state.chains.map(chain => `<button class="chip-btn" data-chain="${chain.id}">+ ${esc(chain.name)}</button>`).join("")}</div>`;
        box.querySelectorAll("[data-chain]").forEach(button => button.addEventListener("click", () =>
            renderChain(state.chains.find(chain => chain.id === button.dataset.chain))));
    };
    ["#day", "#time"].forEach(selector => $(selector).addEventListener("change", () => renderChain()));
    renderChain();

    function read() {
        const repeat = readRepeat();
        // повтор без даты: первый подходящий день
        const day = $("#day").value || (repeat ? dayKey(firstDate(repeat)) : "");
        const slot = autoSlot();
        const time = $("#time").value || (slot ? timeText(toIso(slot)) : "");
        const checked = name => sheet.querySelector(`input[name="${name}"]:checked`)?.value || null;
        const pending = $("#newStep").value.trim();
        return {
            title: $("#title").value.trim(),
            plannedAt: !day ? null : time ? toIso(new Date(`${day}T${time}`)) : day,
            durationMin: +checked("duration") || null,
            repeat,
            energy: checked("energy"),
            list: checked("list") || null,
            // дедлайн со временем (из файла Claude) не теряет время, если день не меняли
            due: $("#due").value ? ($("#due").value === dayOf(task.due) ? task.due : $("#due").value) : null,
            kind: checked("kind") || "task",
            show: checked("kind") === "show" ? readShowFields(sheet) : task.show,
            ...(checked("kind") === "post" ? readPostFields(sheet) : { post: task.post, status: task.status }),
            goal: checked("goal"),
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
            // у публикации стадия «вышло» и «сделано» — одно и то же
            if (!draft && task.kind === "post" && (task.status === "вышло") !== task.done) {
                setDone(task, task.status === "вышло");
            } else {
                (draft ? draft.onSave : saveTask)(task);
            }
        }
    }

    sheet.querySelector("[data-close]").addEventListener("click", close);
    $("#delete").addEventListener("click", () => {
        deleted = true;
        close();
        if (draft) {
            draft.onDelete();
        } else if (state.tasks.has(task.id)) {
            trashTask(task);
            showToast("Задача в корзине", "Вернуть", () => restoreTask(task));
        }
    });
    $("#focus")?.addEventListener("click", () => {
        save();
        deleted = true; // уже сохранено
        close();
        if (state.tasks.has(task.id)) {
            startFocus(task);
        }
    });
    $("#postpone")?.addEventListener("click", () => {
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
                ${postponeOptions().map(option => {
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
