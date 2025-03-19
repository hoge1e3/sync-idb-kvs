# sync-idb-kvs
Synchronous IndexedDB Key-Value Store(Requires async Initialization)

# API
```ts
class SyncStorage {
    // Create storage and fetch all data from idb to memory
    static async create(dbName = "SyncStorageDB", storeName = "kvStore"): Promise<SyncStorage>;
    // Provides localStorage-like synchronous interface
    setItem(key: string, value: string): void;
    getItem(key: string): string | null;
    removeItem(key: string): void;
    // These are slightly different from localStorage. `in` operator cannot be used.
    itemExists(key: string): boolean;
    keys(): IterableIterator<string>; 
    // When other instance(e.g. Web worker) changes the idb, this method should be called to obtain the changed data.
    reload(key:string):Promise<string|null>;
    // Number of uncommited data; if this is 0, you can close this instance safely.
    uncommited: number;
}
```