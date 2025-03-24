export interface IStorage {
    setItem(key: string, value: string): void;
    getItem(key: string): string | null;
    removeItem(key: string): void;
    itemExists(key: string): boolean;
    keys(): IterableIterator<string>; 
    reload(key:string):Promise<string|null>;
}
export class SyncIDBStorage implements IStorage {
    private db: IDBDatabase | null = null;
    memoryCache: Record<string, string> = {}; // メモリキャッシュ
    uncommited=0;
    static async create(dbName = "SyncStorageDB", storeName = "kvStore"): Promise<SyncIDBStorage> {
        const s=new SyncIDBStorage(dbName, storeName);
        await s._initDB();
        return s;
    }
    constructor(
        public dbName = "SyncStorageDB", 
        public storeName = "kvStore") {}
    private async _initDB(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);
            request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName);
                }
            };
            request.onsuccess = (event: Event) => {
                this.db = (event.target as IDBOpenDBRequest).result;
                this._loadAllData().then(resolve).catch(reject);
            };
            request.onerror = (event: Event) => reject((event.target as IDBOpenDBRequest).error);
        });
    }
    private async _loadAllData(): Promise<void> {
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(this.storeName, "readonly");
            const store = transaction.objectStore(this.storeName);
            const request = store.getAllKeys();
            request.onsuccess = async () => {
                const keys = request.result as string[];
                const values = await Promise.all(keys.map(key => this._getFromIndexedDB(key)));
                keys.forEach((key, i) => {
                    if (!(key in this.memoryCache)) {
                        this.memoryCache[key] = values[i] ?? "";
                    }
                });
                resolve();
            };
            request.onerror = (event) => reject((event.target as IDBRequest).error);
        });
    }
    getItem(key: string): string | null {
        return this.memoryCache[key] ?? null;
    }
    setItem(key: string, value: string): void {
        this.memoryCache[key] = value;
        this._saveToIndexedDB(key, value);
    }
    removeItem(key: string): void {
        delete this.memoryCache[key];
        this._deleteFromIndexedDB(key);
    }
    itemExists(key: string): boolean {
        return key in this.memoryCache;
    }
    keys(): IterableIterator<string> {
        return Object.keys(this.memoryCache)[Symbol.iterator]();
    }
    async reload(key: string): Promise<string|null> {
        const value=await this._getFromIndexedDB(key);
        if (value){
            if (value!==this.memoryCache[key]){
                this.memoryCache[key]=value;
            }
        } else {
            if (key in this.memoryCache) {
                delete this.memoryCache[key];    
            }
        }
        return value;
    }
    private async _getFromIndexedDB(key: string): Promise<string | null> {
        return new Promise((resolve, reject) => {
            if (!this.db) return resolve(null);
            const transaction = this.db.transaction(this.storeName, "readonly");
            const store = transaction.objectStore(this.storeName);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result ?? null);
            request.onerror = () => reject(request.error);
        });
    }
    private async _saveToIndexedDB(key: string, value: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.uncommited++;
            if (!this.db) return resolve();
            const transaction = this.db.transaction(this.storeName, "readwrite");
            const store = transaction.objectStore(this.storeName);
            const request = store.put(value, key);
            request.onsuccess = () => resolve();
            request.onerror = (event) => reject((event.target as IDBRequest).error);
        }).finally(()=>{this.uncommited--;});
    }
    private async _deleteFromIndexedDB(key: string): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.db) return resolve();
            const transaction = this.db.transaction(this.storeName, "readwrite");
            const store = transaction.objectStore(this.storeName);
            const request = store.delete(key);
            request.onsuccess = () => resolve();
            request.onerror = (event) => reject((event.target as IDBRequest).error);
        });
    }
}
