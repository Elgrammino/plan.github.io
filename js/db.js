// IndexedDB: все данные живут только в телефоне.
// Новая структура — новый номер DB_VERSION и новый шаг в upgrade(), старые шаги не трогать.
const DB_NAME = "plan";
const DB_VERSION = 2;

const DEFAULT_LISTS = [
    { id: "insta", name: "Инста", order: 1, shared: false },
    { id: "shows", name: "Выступления", order: 2, shared: false },
    { id: "props", name: "Реквизит", order: 3, shared: false },
    { id: "home", name: "Дом", order: 4, shared: false }
];

let dbPromise = null;

function upgrade(db, oldVersion, transaction) {
    if (oldVersion < 1) {
        db.createObjectStore("meta"); // ключ-значение: настройки, счётчики, служебное
        const tasks = db.createObjectStore("tasks", { keyPath: "id" });
        tasks.createIndex("list", "list");
        tasks.createIndex("batch", "batch");
    }
    if (oldVersion < 2) {
        db.createObjectStore("lists", { keyPath: "id" });
        DEFAULT_LISTS.forEach(list => transaction.objectStore("lists").put(list));
    }
}

function openDb() {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = event => upgrade(request.result, event.oldVersion, request.transaction);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    return dbPromise;
}

function done(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function store(name, mode = "readonly") {
    const db = await openDb();
    return db.transaction(name, mode).objectStore(name);
}

export async function getMeta(key) {
    return done((await store("meta")).get(key));
}

export async function setMeta(key, value) {
    return done((await store("meta", "readwrite")).put(value, key));
}

export async function getAll(name) {
    return done((await store(name)).getAll());
}

export async function put(name, value) {
    return done((await store(name, "readwrite")).put(value));
}

export async function remove(name, key) {
    return done((await store(name, "readwrite")).delete(key));
}
