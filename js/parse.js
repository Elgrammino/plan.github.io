// Разбор быстрой фразы: «завтра в 19 рилс 1ч #инста !» →
// { title: "Рилс", plannedAt, durationMin: 60, list: "insta", priority: "high" }.
// Повторы: «каждый понедельник в 10», «1-го числа каждого месяца», «каждые 3 дня» → repeat.
// Распознанные куски вырезаются из названия. Всё, что не распознано, остаётся текстом.
import { addDays, atTime, dayKey, toIso } from "./dates.js";
import { firstDate, nextDate } from "./repeat.js";

// границы слова: \b в JavaScript не работает с кириллицей
const B = "(?:^|\\s)";
const E = "(?=$|[\\s,.!?;:])";

const WEEKDAYS = [
    ["воскресенье", "вс"],
    ["понедельник", "пн"],
    ["вторник", "вт"],
    ["среда", "среду", "ср"],
    ["четверг", "чт"],
    ["пятница", "пятницу", "пт"],
    ["суббота", "субботу", "сб"]
];

// только родительный падеж: «12 мая», иначе «3 мандарина» стало бы датой
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

const PARTS_OF_DAY = { "утром": 9, "днём": 13, "днем": 13, "вечером": 19, "ночью": 23 };

function cut(state, regex, onMatch) {
    const match = state.text.match(regex);
    if (!match) {
        return false;
    }
    if (onMatch(match) === false) {
        return false;
    }
    state.text = (state.text.slice(0, match.index) + " " + state.text.slice(match.index + match[0].length)).trim();
    return true;
}

function nextWeekday(now, weekday) {
    const diff = (weekday - now.getDay() + 7) % 7 || 7;
    return addDays(now, diff);
}

function findDay(state, now) {
    let day = null;
    cut(state, new RegExp(B + "(сегодня)" + E, "i"), () => day = now)
        || cut(state, new RegExp(B + "(послезавтра)" + E, "i"), () => day = addDays(now, 2))
        || cut(state, new RegExp(B + "(завтра)" + E, "i"), () => day = addDays(now, 1))
        || cut(state, new RegExp(B + "(вчера)" + E, "i"), () => day = addDays(now, -1))
        || cut(state, new RegExp(B + "через\\s+(\\d+)\\s+(день|дня|дней)" + E, "i"), m => day = addDays(now, +m[1]))
        || cut(state, new RegExp(B + "через\\s+неделю" + E, "i"), () => day = addDays(now, 7))
        || cut(state, new RegExp(B + "(?:на\\s+)?выходных" + E, "i"), () => day = now.getDay() === 6 || now.getDay() === 0 ? now : nextWeekday(now, 6))
        || cut(state, new RegExp(B + "(\\d{1,2})\\.(\\d{1,2})(?:\\.(\\d{2,4}))?" + E), m => {
            const month = +m[2] - 1;
            if (month > 11 || +m[1] > 31) {
                return false;
            }
            const year = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : now.getFullYear();
            day = new Date(year, month, +m[1]);
            if (!m[3] && dayKey(day) < dayKey(now)) {
                day.setFullYear(year + 1);
            }
        })
        || cut(state, new RegExp(B + "(\\d{1,2})\\s+(" + MONTHS.join("|") + ")" + E, "i"), m => {
            const month = MONTHS.indexOf(m[2].toLowerCase());
            day = new Date(now.getFullYear(), month, +m[1]);
            if (dayKey(day) < dayKey(now)) {
                day.setFullYear(now.getFullYear() + 1);
            }
        })
        || cut(state, new RegExp(B + "(\\d{1,2})-?го" + E, "i"), m => {
            day = new Date(now.getFullYear(), now.getMonth(), +m[1]);
            if (dayKey(day) < dayKey(now)) {
                day.setMonth(day.getMonth() + 1);
            }
        });
    if (!day) {
        WEEKDAYS.some((names, weekday) =>
            cut(state, new RegExp(B + "(?:в|во)?\\s*(" + names.join("|") + ")" + E, "i"), () => day = nextWeekday(now, weekday)));
    }
    return day;
}

// формы дней недели для повторов: «каждый понедельник», «по средам», «по пн и чт»
const REPEAT_DAYS = {
    mo: ["понедельникам", "понедельник", "пн"],
    tu: ["вторникам", "вторник", "вт"],
    we: ["средам", "среду", "среда", "ср"],
    th: ["четвергам", "четверг", "чт"],
    fr: ["пятницам", "пятницу", "пятница", "пт"],
    sa: ["субботам", "субботу", "суббота", "сб"],
    su: ["воскресеньям", "воскресенье", "вс"]
};
const DAY_FORM = Object.values(REPEAT_DAYS).flat().sort((a, b) => b.length - a.length).join("|");
const NUMBERS = { "два": 2, "две": 2, "три": 3, "четыре": 4, "пять": 5, "шесть": 6 };
const N = "(\\d+|" + Object.keys(NUMBERS).join("|") + ")";
const num = word => NUMBERS[word.toLowerCase()] || +word;

function findRepeat(state) {
    let repeat = null;
    // дни недели: «каждый понедельник и четверг», «по вторникам, пятницам»
    const addWeekdays = text => {
        const found = Object.entries(REPEAT_DAYS)
            .filter(([, forms]) => forms.some(form => new RegExp("(?:^|[\\s,])" + form + "(?=$|[\\s,])", "i").test(text)))
            .map(([code]) => code);
        return found.length ? found : null;
    };
    const DAYS_LIST = "((?:" + DAY_FORM + ")(?:\\s*(?:,|и)\\s*(?:" + DAY_FORM + "))*)";

    cut(state, new RegExp(B + "(?:каждый\\s+день|ежедневно)" + E, "i"), () => repeat = { unit: "day" })
        || cut(state, new RegExp(B + "каждые\\s+" + N + "\\s+(?:дня|дней|день)" + E, "i"), m => repeat = { unit: "day", every: num(m[1]) })
        || cut(state, new RegExp(B + "(?:каждые|раз\\s+в)\\s+" + N + "\\s+(?:недели|недель|неделю)" + E, "i"), m => repeat = { unit: "week", every: num(m[1]) })
        || cut(state, new RegExp(B + "(?:каждую\\s+неделю|еженедельно|раз\\s+в\\s+неделю)" + E, "i"), () => repeat = { unit: "week" })
        || cut(state, new RegExp(B + "по\\s+будням" + E, "i"), () => repeat = { unit: "week", weekdays: ["mo", "tu", "we", "th", "fr"] })
        || cut(state, new RegExp(B + "по\\s+выходным" + E, "i"), () => repeat = { unit: "week", weekdays: ["sa", "su"] })
        || cut(state, new RegExp(B + "(\\d{1,2})-?(?:го|е)?\\s+(?:числа\\s+)?каждого\\s+месяца" + E, "i"), m => {
            if (+m[1] < 1 || +m[1] > 31) {
                return false;
            }
            repeat = { unit: "month", monthDay: +m[1] };
        })
        || cut(state, new RegExp(B + "каждое\\s+(\\d{1,2})-?(?:е)?\\s+число" + E, "i"), m => repeat = { unit: "month", monthDay: Math.min(31, Math.max(1, +m[1])) })
        || cut(state, new RegExp(B + "(?:каждые|раз\\s+в)\\s+" + N + "\\s+(?:месяца|месяцев)" + E, "i"), m => repeat = { unit: "month", every: num(m[1]) })
        || cut(state, new RegExp(B + "(?:каждый\\s+месяц|ежемесячно|раз\\s+в\\s+месяц)" + E, "i"), () => repeat = { unit: "month" });

    // «каждый понедельник», «по средам» — сами по себе или после «раз в две недели»
    if (!repeat || (repeat.unit === "week" && !repeat.weekdays)) {
        cut(state, new RegExp(B + "(?:каждый|каждую|каждое|по)\\s+" + DAYS_LIST + E, "i"), m => {
            repeat = { unit: "week", ...repeat, weekdays: addWeekdays(m[1]) };
        });
    }
    if (repeat && repeat.every === 1) {
        delete repeat.every;
    }
    return repeat;
}

function findTime(state) {
    let time = null;
    // «в 19», «в 19:30», «в 9.30», «в 7 вечера», «к 18»
    cut(state, new RegExp(B + "(?:в|к)\\s+(\\d{1,2})(?:[:.](\\d{2}))?(?:\\s+(утра|дня|вечера|ночи))?" + E, "i"), m => {
        let h = +m[1];
        if (h > 23 || (m[2] && +m[2] > 59)) {
            return false;
        }
        if ((m[3] === "вечера" || m[3] === "дня") && h < 12) {
            h += 12;
        }
        time = [h, m[2] ? +m[2] : 0];
    })
        // «19:30» без предлога
        || cut(state, new RegExp(B + "(\\d{1,2}):(\\d{2})" + E), m => {
            if (+m[1] > 23 || +m[2] > 59) {
                return false;
            }
            time = [+m[1], +m[2]];
        });
    if (!time) {
        cut(state, new RegExp(B + "(" + Object.keys(PARTS_OF_DAY).join("|") + ")" + E, "i"), m => time = [PARTS_OF_DAY[m[1].toLowerCase()], 0]);
    }
    return time;
}

function findDuration(state) {
    let minutes = null;
    cut(state, new RegExp(B + "полчаса" + E, "i"), () => minutes = 30)
        || cut(state, new RegExp(B + "(\\d+(?:[.,]\\d+)?)\\s*(?:ч|час|часа|часов)\\s*(\\d+)\\s*(?:м|мин|минут[ау]?)?" + E, "i"), m => minutes = Math.round(parseFloat(m[1].replace(",", ".")) * 60) + +m[2])
        || cut(state, new RegExp(B + "(\\d+(?:[.,]\\d+)?)\\s*(?:ч|час|часа|часов)" + E, "i"), m => minutes = Math.round(parseFloat(m[1].replace(",", ".")) * 60))
        || cut(state, new RegExp(B + "(\\d+)\\s*(?:м|мин|минут[ау]?)" + E, "i"), m => minutes = +m[1]);
    return minutes;
}

function findList(state, lists) {
    let list = null;
    cut(state, /(?:^|\s)#([\p{L}\d_-]+)/u, m => {
        const tag = m[1].toLowerCase();
        const found = lists.find(l => l.name.toLowerCase().startsWith(tag));
        if (!found) {
            return false;
        }
        list = found.id;
    });
    return list;
}

export function parseQuick(input, { lists = [], now = new Date() } = {}) {
    const state = { text: " " + input.trim() + " " };
    const result = {};

    if (cut(state, /(?:^|\s)!(?=\s|$)/, () => true)) {
        result.priority = "high";
    }
    result.list = findList(state, lists);
    result.repeat = findRepeat(state);
    result.durationMin = findDuration(state);
    const time = findTime(state);
    let day = findDay(state, now);

    if (result.repeat && !day) {
        // повтор без даты: первый подходящий день; если время сегодня уже прошло — следующий
        day = firstDate(result.repeat, now);
        if (time && dayKey(day) === dayKey(now) && atTime(now, ...time) <= now) {
            day = nextDate(result.repeat, day);
        }
    }

    if (time) {
        if (!day) {
            // время без дня: сегодня, а если уже прошло — завтра
            day = atTime(now, ...time) > now ? now : addDays(now, 1);
        }
        result.plannedAt = toIso(atTime(day, ...time));
    } else if (day) {
        result.plannedAt = dayKey(day);
    }

    const title = state.text.replace(/\s+/g, " ").replace(/^[\s,.;:—-]+|[\s,;:—-]+$/g, "").trim();
    result.title = title ? title.charAt(0).toUpperCase() + title.slice(1) : "";
    Object.keys(result).forEach(key => result[key] == null && delete result[key]);
    return result;
}
