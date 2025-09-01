class LocalStorage {
    constructor() {
        if (!LocalStorage.instance) {
            this.dbName = "MemeStudioDB";
            this.dbVersion = 1;
            this.db = null;
            this.initPromise = this._init();
            LocalStorage.instance = this;
        }
        return LocalStorage.instance;
    }

    async _init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('KeyValueStore')) {
                    db.createObjectStore('KeyValueStore', { keyPath: 'key' });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve();
            };

            request.onerror = (event) => {
                console.error("IndexedDB error:", event.target.errorCode);
                reject(event.target.errorCode);
            };
        });
    }

    async set(key, value) {
        await this.initPromise;
        return new Promise((resolve, reject) => {
            if (!this.db) {
                return reject("DB not initialized");
            }
            const transaction = this.db.transaction(['KeyValueStore'], "readwrite");
            const store = transaction.objectStore('KeyValueStore');
            const request = store.put({ key, value });

            request.onsuccess = () => resolve();
            request.onerror = (event) => reject(event.target.error);
        });
    }

    async get(key) {
        await this.initPromise;
        return new Promise((resolve, reject) => {
            if (!this.db) {
                return reject("DB not initialized");
            }
            const transaction = this.db.transaction(['KeyValueStore'], "readonly");
            const store = transaction.objectStore('KeyValueStore');
            const request = store.get(key);

            request.onsuccess = (event) => {
                resolve(event.target.result ? event.target.result.value : undefined);
            };
            request.onerror = (event) => reject(event.target.error);
        });
    }

    // Specification-compliant methods
    async save(key, value) {
        return this.set(key, value);
    }

    async load(key, fallback = undefined) {
        const result = await this.get(key);
        return result !== undefined ? result : fallback;
    }

    async remove(key) {
        await this.initPromise;
        return new Promise((resolve, reject) => {
            if (!this.db) {
                return reject("DB not initialized");
            }
            const transaction = this.db.transaction(['KeyValueStore'], "readwrite");
            const store = transaction.objectStore('KeyValueStore');
            const request = store.delete(key);

            request.onsuccess = () => resolve();
            request.onerror = (event) => reject(event.target.error);
        });
    }
}

window.LocalStorage = new LocalStorage();
