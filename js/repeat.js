// Повторы: { unit: "day" | "week" | "month", every: 1, weekdays: ["mo", "th"], monthDay: 1 }.
// Схема та же, что в docs/claude-format.md. Здесь только даты, без задач и базы.
import { addDays, dayKey } from "./dates.js";

export const WEEKDAYS = ["mo", "tu", "we", "th", "fr", "sa", "su"];
export const WEEKDAY_SHORT = { mo: "пн", tu: "вт", we: "ср", th: "чт", fr: "пт", sa: "сб", su: "вс" };

const DAY_MS = 86400000;

export const weekdayCode = date => WEEKDAYS[(date.getDay() + 6) % 7];

function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function mondayOf(date) {
    return addDays(startOfDay(date), -((date.getDay() + 6) % 7));
}

// следующий день повтора строго после from (время суток не трогаем, это забота задачи)
export function nextDate(repeat, from) {
    const every = repeat.every || 1;
    const base = startOfDay(from);

    if (repeat.unit === "day") {
        return addDays(base, every);
    }

    if (repeat.unit === "week") {
        const days = repeat.weekdays?.length ? repeat.weekdays : [weekdayCode(base)];
        const anchor = mondayOf(base);
        // недели считаются от недели, где стоит задача: «раз в две недели» пропускает каждую вторую
        for (let i = 1; i <= 7 * every + 7; i++) {
            const day = addDays(base, i);
            const weeks = Math.round((mondayOf(day) - anchor) / (7 * DAY_MS));
            if (weeks % every === 0 && days.includes(weekdayCode(day))) {
                return day;
            }
        }
        return addDays(base, 7 * every);
    }

    // месяц: 31-е в коротком месяце становится последним днём
    const wanted = repeat.monthDay || base.getDate();
    const inMonth = (year, month) => new Date(year, month, Math.min(wanted, new Date(year, month + 1, 0).getDate()));
    const same = inMonth(base.getFullYear(), base.getMonth());
    if (same > base) {
        return same;
    }
    return inMonth(base.getFullYear(), base.getMonth() + every);
}

// первый раз для новой задачи без даты: сегодня, если сегодня подходит, иначе ближайший
export function firstDate(repeat, now = new Date()) {
    const today = startOfDay(now);
    if (repeat.unit === "day"
        || (repeat.unit === "week" && !repeat.weekdays?.length)
        || (repeat.unit === "month" && !repeat.monthDay)) {
        return today;
    }
    return nextDate({ ...repeat, every: 1 }, addDays(today, -1));
}

// следующий раз после выполнения: пропущенные разы не копятся, ближайший — не раньше сегодня
export function nextAfterDone(repeat, planned, now = new Date()) {
    let day = nextDate(repeat, planned || now);
    while (dayKey(day) < dayKey(now)) {
        day = nextDate(repeat, day);
    }
    return day;
}

export function daysBetween(a, b) {
    return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS);
}

const plural = (n, one, few, many) =>
    n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many;

// «каждый день», «каждые 3 дня», «по пн, чт», «по будням», «1-го числа»
export function repeatText(repeat) {
    if (!repeat) {
        return "";
    }
    const every = repeat.every || 1;
    if (repeat.unit === "day") {
        return every === 1 ? "каждый день" : `каждые ${every} ${plural(every, "день", "дня", "дней")}`;
    }
    if (repeat.unit === "week") {
        const days = repeat.weekdays || [];
        const joined = days.join(",");
        const which = joined === "mo,tu,we,th,fr" ? "по будням"
            : joined === "sa,su" ? "по выходным"
            : days.length ? "по " + days.map(day => WEEKDAY_SHORT[day]).join(", ") : "";
        if (every === 1) {
            return which || "каждую неделю";
        }
        return `раз в ${every} ${plural(every, "неделю", "недели", "недель")}` + (which ? ", " + which.replace(/^по /, "") : "");
    }
    const day = repeat.monthDay ? `${repeat.monthDay}-го числа` : "";
    if (every === 1) {
        return day ? day + " каждого месяца" : "каждый месяц";
    }
    return `раз в ${every} ${plural(every, "месяц", "месяца", "месяцев")}` + (day ? ", " + day : "");
}
