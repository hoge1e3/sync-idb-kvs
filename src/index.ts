import MutablePromise from "mutable-promise";

export interface IStorage {
    setItem(key: string, value: string): void;
    getItem(key: string): string | null;
    removeItem(key: string): void;
    itemExists(key: string): boolean;
    keys(): IterableIterator<string>; 
    reload(key:string):Promise<string|null>;
}
export class SyncIDBStorage implements IStorage {
    //private db: IDBDatabase | null = null;
    memoryCache: Record<string, string> = {}; // メモリキャッシュ
    //uncommitedCounter=new UncommitCounter();
    static async create(dbName = "SyncStorageDB", storeName = "kvStore"): Promise<SyncIDBStorage> {
        const a=new AsyncIDBStorage(dbName, storeName);
        const s=new SyncIDBStorage(a,dbName);
        await a.initDB(s);
        return s;
    }
    constructor(
        public asyncStorage:AsyncIDBStorage,
        public channelName:string) {}
    getItem(key: string): string | null {
        return this.memoryCache[key] ?? null;
    }
    setItem(key: string, value: string): void {
        this.memoryCache[key] = value;
        //this._saveToIndexedDB(key, value);
        this.asyncStorage.setItem(key,value);
    }
    removeItem(key: string): void {
        delete this.memoryCache[key];
        //this._deleteFromIndexedDB(key);
        this.asyncStorage.removeItem(key);
    }
    itemExists(key: string): boolean {
        return key in this.memoryCache;
    }
    keys(): IterableIterator<string> {
        return Object.keys(this.memoryCache)[Symbol.iterator]();
    }
    async reload(key: string): Promise<string|null> {
        //const value=await this._getFromIndexedDB(key);
        const value=await this.asyncStorage.getItem(key);
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
    async waitForCommit(){
        return await this.asyncStorage.uncommitedCounter.wait();
    }
}
export function idbReqPromise<T>(request:IDBRequest<T>){
  return new Promise<T>((resolve,reject)=>{
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export class AsyncIDBStorage {
    private db: IDBDatabase | null = null;
    uncommitedCounter=new UncommitCounter();
    constructor(
        public dbName = "SyncStorageDB", 
        public storeName = "kvStore") {}
    async initDB(s:SyncIDBStorage): Promise<void> {
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
                this.loadAllData(s).then(resolve).catch(reject);
            };
            request.onerror = (event: Event) => reject((event.target as IDBOpenDBRequest).error);
        });
    }
    async loadAllData(s: SyncIDBStorage): Promise<void> {
        const transaction = this.db!.transaction(this.storeName, "readonly");
        const store = transaction.objectStore(this.storeName);
        // Get all keys and values in the same transaction
        const [keys,values]= await Promise.all([
          idbReqPromise(store.getAllKeys()) as Promise<string[]>,
          idbReqPromise(store.getAll())
        ]);
        // Both arrays have the same order
        keys.forEach((key, i) => {
            if (!(key in s.memoryCache)) {
                s.memoryCache[key] = values[i] ?? "";
            }
        });
      
    }
    async getItem(key: string): Promise<string | null> {
        return new Promise((resolve, reject) => {
            if (!this.db) return resolve(null);
            const transaction = this.db.transaction(this.storeName, "readonly");
            const store = transaction.objectStore(this.storeName);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result ?? null);
            request.onerror = () => reject(request.error);
        });
    }
    async setItem(key: string, value: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.uncommitedCounter.inc();
            if (!this.db) return resolve();
            const transaction = this.db.transaction(this.storeName, "readwrite");
            const store = transaction.objectStore(this.storeName);
            const request = store.put(value, key);
            request.onsuccess = () => resolve();
            request.onerror = (event) => reject((event.target as IDBRequest).error);
        }).finally(()=>{this.uncommitedCounter.dec();});
    }
    async removeItem(key: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (!this.db) return resolve();
            this.uncommitedCounter.inc();
            const transaction = this.db.transaction(this.storeName, "readwrite");
            const store = transaction.objectStore(this.storeName);
            const request = store.delete(key);
            request.onsuccess = () => resolve();
            request.onerror = (event) => reject((event.target as IDBRequest).error);
        }).finally(()=>{this.uncommitedCounter.dec();});
    }
    async waitForCommit(){
        return await this.uncommitedCounter.wait();
    }
}
class UncommitCounter {
    private value=0;
    private promise: MutablePromise<void>|undefined;
    inc() {
        this.value++;
        if (!this.promise) this.promise=new MutablePromise<void>();
    }
    dec() {
        this.value--;
        if (this.value<0) throw new Error("UncommitCounter: Invalid counter state.");
        if (this.value==0) {
            if (!this.promise) throw new Error("UncommitCounter: Invalid promise state.");
            this.promise.resolve();
            delete this.promise;
        }
    }
    async wait(){
        if (!this.promise) return;
        await this.promise;
    }
}