// Цепочки: от главной задачи (публикация, выступление) считаются задачи-шаги.
// Строка шаблона: «сдвиг [время] название [длительность]»
//   -2д 12:00 Снять: {title} 1ч     — за два дня, в 12:00
//   -3ч Подпись: {title} 15м        — за три часа до начала
//   -дорога Выезд: {title} дорога   — за время в пути из карточки выступления, длится столько же
//   +2ч После: {title} 30м          — через два часа после начала
// {title} заменяется названием главной задачи.
import { addDays, atTime, toIso } from "./dates.js";
import { newTask, saveTask, state } from "./store.js";

const DEFAULT_TRAVEL = 90; // минут, если дорога в карточке не указана

const UNIT = { "д": 24 * 60, "ч": 60, "м": 1 };

function minutesOf(token, travel) {
    if (/^дорога$/i.test(token)) {
        return travel;
    }
    const match = token.match(/^(\d+(?:[.,]\d+)?)(д|ч|м|мин)$/i);
    return match ? Math.round(parseFloat(match[1].replace(",", ".")) * UNIT[match[2][0].toLowerCase()]) : null;
}

// строка → { days, minutes, time, title, duration } или null, если не разобралась
export function parseLine(line, travel = DEFAULT_TRAVEL) {
    const words = line.trim().split(/\s+/);
    const shift = words.shift() || "";
    const sign = shift[0] === "-" ? -1 : shift[0] === "+" ? 1 : 0;
    if (!sign) {
        return null;
    }
    const amount = minutesOf(shift.slice(1), travel);
    if (amount === null) {
        return null;
    }
    const step = { title: "", duration: null };
    // «-2д 12:00» — день со сдвигом и точное время; «-3ч» — сдвиг от начала
    if (/д$/i.test(shift) && /^\d{1,2}:\d{2}$/.test(words[0] || "")) {
        step.days = sign * Math.round(amount / UNIT["д"]);
        step.time = words.shift();
    } else {
        step.minutes = sign * amount;
    }
    // длительность в конце: «1ч», «дорога» или «5 мин» через пробел
    const last = words[words.length - 1] || "";
    const spaced = words.length > 2 && /^\d+$/.test(words[words.length - 2]) ? minutesOf(words[words.length - 2] + last, travel) : null;
    const duration = spaced ?? (words.length > 1 ? minutesOf(last, travel) : null);
    if (duration !== null) {
        words.splice(spaced !== null ? -2 : -1);
        step.duration = duration;
    }
    step.title = words.join(" ");
    return step.title ? step : null;
}

function stepTime(step, anchorDate) {
    if (step.time) {
        const [hours, minutes] = step.time.split(":").map(Number);
        return atTime(addDays(anchorDate, step.days), hours, minutes);
    }
    return new Date(anchorDate.getTime() + step.minutes * 60000);
}

// превью цепочки без записи: [{ title, at, duration }]
export function planChain(chain, anchor) {
    const anchorDate = new Date(anchor.plannedAt);
    const travel = anchor.show?.travelMin || DEFAULT_TRAVEL;
    return chain.lines.map(line => parseLine(line, travel)).filter(Boolean).map(step => ({
        title: step.title.replace(/\{title\}/g, anchor.title),
        at: stepTime(step, anchorDate),
        duration: step.duration
    })).sort((a, b) => a.at - b.at);
}

// создать задачи цепочки; checklist — шаги для «Сборов»
export async function applyChain(chain, anchor, checklist = []) {
    const tasks = planChain(chain, anchor).map(step => newTask({
        title: step.title,
        plannedAt: toIso(step.at),
        durationMin: step.duration,
        list: anchor.list,
        batch: anchor.batch,
        chainOf: anchor.id,
        anchorAt: anchor.plannedAt,
        checklist: /^сборы/i.test(step.title) ? checklist.map(text => ({ text, done: false })) : []
    }));
    for (const task of tasks) {
        await saveTask(task);
    }
    return tasks;
}

export function chainTasks(anchor) {
    return [...state.tasks.values()].filter(task => task.chainOf === anchor.id && !task.deletedAt)
        .sort((a, b) => (a.plannedAt || "").localeCompare(b.plannedAt || ""));
}
