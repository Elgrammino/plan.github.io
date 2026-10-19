// Разбор мыслей из выгрузки правилами, без ИИ: сначала быстрая фраза (дата, время, длительность, #список),
// потом ключевые слова → список, энергия и примерная длительность.
import { dayOf } from "./dates.js";
import { parseQuick } from "./parse.js";

// начала слов: «сня» ловит «снять» и «снять сторис», корни подобраны вручную
const LIST_WORDS = {
    insta: ["рилс", "reels", "пост", "сторис", "инст", "монтаж", "смонтир", "сня", "съёмк", "съемк", "подпис", "хэштег", "хештег", "контент", "сценари", "блог", "директ", "подписчик", "ролик", "видео"],
    shows: ["выступ", "концерт", "заказ", "корпоратив", "свадьб", "юбиле", "клиент", "гастрол", "площадк", "шоу", "репетиц", "предоплат", "договор", "афиш", "банкет"],
    props: ["реквизит", "костюм", "декорац", "фокус", "колод", "батарейк", "микрофон", "колонк", "проектор", "кабел", "штатив"],
    home: ["дом", "квартир", "уборк", "убрат", "помыт", "стирк", "постира", "продукт", "мам", "пап", "семь", "семей", "ребён", "ребен", "сын", "доч", "врач", "аптек", "ремонт", "аренд", "коммуналк", "собак", "посуд", "холодильник"]
};

const HEAVY = ["сня", "съёмк", "съемк", "монтаж", "смонтир", "сценари", "выступ", "репетиц", "ремонт", "разобрат", "переезд", "придумат", "написать сценарий", "отчёт", "отчет", "налог", "генеральн"];
const LIGHT = ["позвонит", "набрат", "написать", "ответит", "оплатит", "заплатит", "купит", "заказат", "отправит", "переслат", "проверит", "записат", "напомнит", "скинут", "спросит", "уточнит"];

// короткие дела по умолчанию занимают 15 минут
const QUICK = ["позвонит", "набрат", "ответит", "оплатит", "заплатит", "отправит", "переслат", "скинут", "спросит", "уточнит", "напомнит"];

// корень ищется в начале любого слова мысли
function has(words, roots) {
    return roots.some(root => root.includes(" ")
        ? words.join(" ").includes(root)
        : words.some(word => word.startsWith(root)));
}

// «до пятницы», «до 14 ноября», «до завтра» → дедлайн; день разбирает parseQuick
const UNTIL_WEEKDAYS = {
    "понедельника": "понедельник", "вторника": "вторник", "среды": "среду", "четверга": "четверг",
    "пятницы": "пятницу", "субботы": "субботу", "воскресенья": "воскресенье"
};

function cutDue(text, now) {
    const match = text.match(/(?:^|\s)до\s+(понедельника|вторника|среды|четверга|пятницы|субботы|воскресенья|завтра|послезавтра|\d{1,2}\.\d{1,2}(?:\.\d{2,4})?|\d{1,2}\s+\p{L}+)(?=$|[\s,.!?;:])/iu);
    if (!match) {
        return { text, due: null };
    }
    const word = match[1].toLowerCase();
    const day = dayOf(parseQuick(UNTIL_WEEKDAYS[word] || word, { now }).plannedAt);
    if (!day) {
        return { text, due: null };
    }
    return { text: text.slice(0, match.index) + text.slice(match.index + match[0].length), due: day };
}

export function splitThoughts(text) {
    // диктовка ставит точки между фразами: «Позвонить маме. Купить батарейки»
    return text.split(/\n+|(?<=[.?;])\s+/)
        .map(part => part.replace(/[.;]+$/, "").trim())
        .filter(Boolean);
}

export function sortThought(text, lists, now = new Date()) {
    const until = cutDue(text, now);
    const fields = parseQuick(until.text, { lists, now });
    if (until.due) {
        fields.due = until.due;
    }
    // «оплатить аренду!» — восклицание в конце тоже значит «важно»
    if (/!+$/.test(fields.title)) {
        fields.title = fields.title.replace(/!+$/, "").trim();
        fields.priority = "high";
    }
    const words = text.toLowerCase().replace(/ё/g, "е").split(/[^\p{L}\d]+/u).filter(Boolean);
    const plain = roots => roots.map(root => root.replace(/ё/g, "е"));

    if (!fields.list) {
        const found = Object.entries(LIST_WORDS).find(([, roots]) => has(words, plain(roots)));
        // список подставляем, только если такой список ещё есть у человека
        if (found && lists.some(list => list.id === found[0])) {
            fields.list = found[0];
        }
    }
    if (has(words, plain(HEAVY))) {
        fields.energy = "high";
    } else if (has(words, plain(LIGHT))) {
        fields.energy = "low";
    }
    if (!fields.durationMin && has(words, plain(QUICK))) {
        fields.durationMin = 15;
    }
    return fields;
}
