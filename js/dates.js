// Даты хранятся строками в местном времени телефона:
// день — "2026-11-03", момент — "2026-11-03T19:00:00+03:00".

const pad = n => String(n).padStart(2, "0");

export function dayKey(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toIso(date) {
    const offset = -date.getTimezoneOffset();
    const sign = offset >= 0 ? "+" : "-";
    const abs = Math.abs(offset);
    return `${dayKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export function hasTime(value) {
    return typeof value === "string" && value.includes("T");
}

// "2026-11-03" → полночь этого дня по местному времени; момент с поправкой → Date как есть
export function parseDate(value) {
    if (!value) {
        return null;
    }
    if (!hasTime(value)) {
        const [y, m, d] = value.split("-").map(Number);
        return new Date(y, m - 1, d);
    }
    return new Date(value);
}

export function dayOf(value) {
    return value ? dayKey(parseDate(value)) : null;
}

export function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

export function atTime(date, hours, minutes = 0) {
    const result = new Date(date);
    result.setHours(hours, minutes, 0, 0);
    return result;
}

export function timeText(value) {
    const date = parseDate(value);
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function durationText(minutes) {
    if (!minutes) {
        return "";
    }
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (!h) {
        return `${m} мин`;
    }
    return m ? `${h} ч ${m}` : `${h} ч`;
}

// «сегодня», «завтра», «пт, 7 нояб.» — для подписей у задач
export function relativeDay(value, now = new Date()) {
    const key = dayOf(value);
    if (key === dayKey(now)) {
        return "сегодня";
    }
    if (key === dayKey(addDays(now, 1))) {
        return "завтра";
    }
    if (key === dayKey(addDays(now, -1))) {
        return "вчера";
    }
    return parseDate(value).toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short" });
}

// сдвиг дня или момента на N дней с сохранением формата
export function shiftDays(value, days) {
    if (!value) {
        return value;
    }
    const date = addDays(parseDate(value), days);
    return hasTime(value) ? toIso(date) : dayKey(date);
}
