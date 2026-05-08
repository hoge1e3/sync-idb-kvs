import MutablePromise from "mutable-promise";

export interface IStorage<T> {
    storageType: string;
    setItem(key: string, value: T): void;
    getItem(key: string): T | null;
    removeItem(key: string): void;
    itemExists(key: string): boolean;
    keys(): IterableIterator<string>; 
    reload(key:string):Promise<T|null>;
    waitForCommit():Promise<void>;
}
export type LazyLevel=0|1|2|3;
export type SyncIDBStorageOptions={
  // 0 wait for loadall on mount
  // 1 start loadall but not wait on mount
  // 2 postpone loadall until first access
  // 3 load only accessed item (never loadall)
  lazy?:LazyLevel,
};
const storeName="kvStore";
export class SyncIDBStorage<T> implements IStorage<T> {
    storageType="idb";
    //private db: IDBDatabase | null = null;
    memoryCache: Record<string, T|null> = {}; // null for level 3 and not-existent.
    //uncommitedCounter=new UncommitCounter();
    loadedAll=false;
    dbInited=false;
    _readyPromise?:Promise<void>;
    passiveReadyPromise=new MutablePromise();
    /**@deprecated Use getReadyPromise or loadingPromise*/
    getLoadingPromise(passive=false){
        return this.readyPromise(passive);
    }
    readyPromise(passive=false){// was getLoadingPromise
      if(this.loadedAll)return Promise.resolve();
      if(passive)return this.passiveReadyPromise;
      this._readyPromise=this._readyPromise||
        this.asyncStorage.initDB(this).then(
          (loadedAll)=>{
            this.loadedAll=loadedAll;
            this.dbInited=true;
            this.passiveReadyPromise.resolve(void 0);
          }
        );
      return this._readyPromise;
    }
    static async create<T>(dbName:string, 
      initialData:Record<string,T>,
      opt={} as SyncIDBStorageOptions): Promise<SyncIDBStorage<T>> {
      opt.lazy=opt.lazy||0;
      const a=new AsyncIDBStorage<T>(dbName, initialData,opt.lazy===3);
      const s=new SyncIDBStorage<T>(a,dbName,opt.lazy);
      switch(opt.lazy) {
        case 0:
            await s.readyPromise(false);
            break;        
        case 1:
            s.readyPromise(false);
            break;        
        case 2:
        case 3:
            break;
      }
      return s;
    }
    ensureLoaded(key:string|null){//null for all
      if(this.loadedAll)return ;
      if(key && key in this.memoryCache) return;
      throw Object.assign(
        new Error(`${this.channelName}: Now loading ${key?"'"+key+"'":""}. Try again later.`),
        {retryPromise:this.loadingPromise(key),}
      );
    }
    ensureReady(){
      if(this.dbInited)return ;
      throw Object.assign(
        new Error(`${this.channelName}: Now initializing DB. Try again later.`),
        {retryPromise:this.readyPromise(),}
      );
    }
    
    private loadingPromise(key:string|null) {//null for all
        if (this.lazyLevel<3) {
            return this.readyPromise(false);
        } else {
            if (!key) throw new Error("key must be specified on lazy level 3");
            const p=this.asyncStorage.getItem(key).then((value)=>this.memoryCache[key]=value);
            return p;
        }
    }
    constructor(
        public asyncStorage:AsyncIDBStorage<T>,
        public channelName:string,
        public lazyLevel: LazyLevel,
    ) {}
    getItem(key: string): T | null {
        // should call itemExists in advance
        return this.memoryCache[key] ?? null;
    }
    setItem(key: string, value: T): void {
        this.ensureReady();
        this.memoryCache[key] = value;
        //this._saveToIndexedDB(key, value);
        this.asyncStorage.setItem(key,value);
    }
    removeItem(key: string): void {
        this.ensureReady();
        this.memoryCache[key]=null;
        //this._deleteFromIndexedDB(key);
        this.asyncStorage.removeItem(key);
    }
    itemExists(key: string): boolean {
        this.ensureLoaded(key);
        return this.memoryCache[key]!=null;
    }
    keys(): IterableIterator<string> {
        this.ensureLoaded(null);
        return Object.keys(this.memoryCache)[Symbol.iterator]();
    }
    async reload(key: string): Promise<T|null> {
        await this.readyPromise(false);
        //const value=await this._getFromIndexedDB(key);
        const value=await this.asyncStorage.getItem(key);
        if (value){
            if (value!==this.memoryCache[key]){
                this.memoryCache[key]=value;
            }
        } else {
            if (key in this.memoryCache) {
                this.memoryCache[key]=null;    
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
export class AsyncIDBStorage<T> {
    private db: IDBDatabase | null = null;
    uncommitedCounter=new UncommitCounter();
    constructor(
        public dbName = "SyncStorageDB", 
        public initialData:Record<string,T>,
        public doNotLoadAll:boolean,
    ) {}
    async initDB(s:SyncIDBStorage<T>): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);
            request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(storeName)) {
                    db.createObjectStore(storeName);
                }
            };
            request.onsuccess = (event: Event) => {
                this.db = (event.target as IDBOpenDBRequest).result;
                if (this.doNotLoadAll) return this.loadInitialData(s).then(()=>resolve(false)).catch(reject);
                this.loadAllData(s).then(()=>resolve(true)).catch(reject);
            };
            request.onerror = (event: Event) => reject((event.target as IDBOpenDBRequest).error);
        });
    }
    async loadInitialData(s: SyncIDBStorage<T>):Promise<void> {
        // for lv3
        //const transaction = this.db!.transaction(storeName, "readonly");
        //const store = transaction.objectStore(storeName);
        // Get all keys and values in the same transaction
        for (let key in this.initialData) {
            s.memoryCache[key]=await this.getItem(key);
            if (!s.memoryCache[key]){
                s.memoryCache[key] = this.initialData[key];
            }
        }
    }
    async loadAllData(s: SyncIDBStorage<T>): Promise<void> {
        const transaction = this.db!.transaction(storeName, "readonly");
        const store = transaction.objectStore(storeName);
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
        for (let key in this.initialData) {
            if (!(key in s.memoryCache)){
                s.memoryCache[key] = this.initialData[key];
            }
        }
    }
    async getItem(key: string): Promise<T | null> {
        return new Promise((resolve, reject) => {
            if (!this.db) throw new Error("db is not init.");
            const transaction = this.db.transaction(storeName, "readonly");
            const store = transaction.objectStore(storeName);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result ?? null);
            request.onerror = () => reject(request.error);
        });
    }
    async setItem(key: string, value: T): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (!this.db) throw new Error("db is not init.");
            this.uncommitedCounter.inc();
            const transaction = this.db.transaction(storeName, "readwrite");
            const store = transaction.objectStore(storeName);
            const request = store.put(value, key);
            request.onsuccess = () => resolve();
            request.onerror = (event) => reject((event.target as IDBRequest).error);
        }).finally(()=>{this.uncommitedCounter.dec();});
    }
    async removeItem(key: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (!this.db) throw new Error("db is not init.");
            this.uncommitedCounter.inc();
            const transaction = this.db.transaction(storeName, "readwrite");
            const store = transaction.objectStore(storeName);
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