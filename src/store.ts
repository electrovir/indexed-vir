import {assertValidShape, type RuntimeTypeOf, type Shape} from 'object-shape-tester';
import {isTransactionAborted} from './util/is-transaction-aborted.js';
import {toError} from './util/to-error.js';

function req<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(toError(request.error));
    });
}

/**
 * A thin, promise-based wrapper around a single IndexedDB object store.
 *
 * @category Main
 */
export class Store {
    /**
     * Name of the IndexedDB object store backing this {@link Store}. Derived from the constructor
     * `storeName` argument.
     */
    public readonly objectStoreName: string;

    /**
     * Cached connection to the underlying IndexedDB database. Lazily created on first access and
     * cleared by {@link Store.destroy}.
     */
    protected connection: Promise<IDBDatabase> | undefined;

    constructor(
        /** Name of the IndexedDB database this store reads from and writes to. */
        public readonly storeName: string,
    ) {
        this.objectStoreName = `${storeName}-object-store`;
    }

    /**
     * Opens (or reuses) the connection to the underlying IndexedDB database, creating the object
     * store if it isn't there yet.
     */
    protected connect(): Promise<IDBDatabase> {
        if (!this.connection) {
            const attempt: Promise<IDBDatabase> = this.openWithObjectStore().then((database) =>
                this.yieldOnConnectionLoss(database, attempt),
            );
            this.connection = attempt;
        }
        return this.connection;
    }

    /**
     * Opening without a version attaches to an existing database at whatever version it already
     * has, so a database created by another connection is never rejected for having the "wrong"
     * version. The object store is then added with the smallest possible version bump, which leaves
     * any object stores belonging to other connections intact.
     */
    protected async openWithObjectStore(): Promise<IDBDatabase> {
        const existing = await this.openDatabase();
        if (existing.objectStoreNames.contains(this.objectStoreName)) {
            return existing;
        }

        const upgradeVersion = existing.version + 1;
        existing.close();
        return await this.openDatabase(upgradeVersion);
    }

    /** Opens the database at the given version, or at its current version when omitted. */
    protected openDatabase(version?: number): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const open =
                version == undefined
                    ? indexedDB.open(this.storeName)
                    : indexedDB.open(this.storeName, version);
            open.onupgradeneeded = () => open.result.createObjectStore(this.objectStoreName);
            open.onsuccess = () => resolve(open.result);
            open.onerror = () => reject(toError(open.error));
        });
    }

    /**
     * Watches for the two ways a cached connection stops being usable, dropping it from the cache
     * so that the next operation transparently reopens:
     *
     * - `versionchange`: another connection wants to upgrade or delete the database and is blocked
     *   until every other connection closes, so close as soon as it asks. An explicit `close()`
     *   does not fire `close`, hence forgetting here too.
     * - `close`: the browser closed the connection on its own, which it does when tearing down the
     *   page or when the storage backing the database goes away.
     */
    protected yieldOnConnectionLoss(
        database: IDBDatabase,
        /** The cache entry this connection belongs to. */
        attempt: Promise<IDBDatabase>,
    ): IDBDatabase {
        database.onversionchange = () => {
            database.close();
            this.forget(attempt);
        };
        database.onclose = () => this.forget(attempt);
        return database;
    }

    /**
     * Drops the given connection from the cache. A connection that has already been replaced fires
     * its close handlers too late to matter, and must not discard its replacement.
     */
    protected forget(attempt: Promise<IDBDatabase>): void {
        if (this.connection === attempt) {
            this.connection = undefined;
        }
    }

    /**
     * Starts a transaction on the object store, reconnecting once if the cached connection has
     * closed since it was opened. Reopening is bounded to a single attempt so that a genuinely
     * unusable IndexedDB, such as one disabled by private browsing, cannot loop here.
     */
    protected async openObjectStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
        const database = await this.connect();
        try {
            return database
                .transaction(this.objectStoreName, mode)
                .objectStore(this.objectStoreName);
        } catch {
            this.connection = undefined;
            return (await this.connect())
                .transaction(this.objectStoreName, mode)
                .objectStore(this.objectStoreName);
        }
    }

    /**
     * Runs the given request factory inside a transaction on the object store and resolves with its
     * result.
     *
     * A connection that closes after the transaction has already started aborts it, which
     * {@link Store.openObjectStore} cannot see coming, so retry that once on a fresh connection. An
     * aborted transaction rolls back, so the retry cannot apply a write twice.
     */
    protected async run<T>(
        mode: IDBTransactionMode,
        buildRequest: (store: IDBObjectStore) => IDBRequest<T>,
    ): Promise<T> {
        try {
            return await req(buildRequest(await this.openObjectStore(mode)));
        } catch (error) {
            if (!isTransactionAborted(error)) {
                throw error;
            }
            this.connection = undefined;
            return await req(buildRequest(await this.openObjectStore(mode)));
        }
    }

    /** Reads the value stored at `key`, or `undefined` if nothing is stored there. */
    public getItem(
        /** Key to read. */
        key: string,
    ): Promise<unknown>;
    /** Reads the value stored at `key`, or `undefined` if nothing is stored there. */
    public getItem<SpecificShape extends Shape>(
        /** Key to read. */
        key: string,
        /**
         * Optional shape definition. When provided, the returned value is validated against it and
         * the return type is narrowed to the shape's runtime type.
         */
        shape: SpecificShape,
    ): Promise<RuntimeTypeOf<SpecificShape> | undefined>;
    /** Reads the value stored at `key`, or `undefined` if nothing is stored there. */
    public async getItem(
        /** Key to read. */
        key: string,
        /**
         * Optional shape definition. When provided, the returned value is validated against it and
         * the return type is narrowed to the shape's runtime type.
         */
        shape?: Shape,
    ): Promise<unknown> {
        /**
         * A cursor distinguishes a missing key (no record, `null` cursor) from a stored `undefined`
         * (a record whose value is `undefined`), which a plain `get` cannot.
         */
        const cursor = await this.run('readonly', (store) => store.openCursor(key));
        if (!cursor) {
            return undefined;
        }
        const value = cursor.value;
        if (shape) {
            assertValidShape(
                value,
                shape,
                undefined,
                `Value stored at key '${key}' failed shape assertion.`,
            );
        }
        return value;
    }

    /** Stores `value` at `key` and resolves with the stored value. */
    public setItem(
        /** Key to write to. */
        key: string,
        /** Value to store. */
        value: unknown,
    ): Promise<unknown>;
    /** Stores `value` at `key` and resolves with the stored value. */
    public setItem<SpecificShape extends Shape>(
        /** Key to write to. */
        key: string,
        /** Value to store. */
        value: RuntimeTypeOf<SpecificShape>,
        /**
         * Optional shape definition. When provided, `value` is validated against it and the
         * required input type is narrowed to the shape's runtime type.
         */
        shape: SpecificShape,
    ): Promise<RuntimeTypeOf<SpecificShape>>;
    /** Stores `value` at `key` and resolves with the stored value. */
    public async setItem(
        /** Key to write to. */
        key: string,
        /** Value to store. */
        value: unknown,
        /**
         * Optional shape definition. When provided, `value` is validated against it and the
         * required input type is narrowed to the shape's runtime type.
         */
        shape?: Shape,
    ): Promise<unknown> {
        if (shape) {
            assertValidShape(
                value,
                shape,
                undefined,
                `Value to be stored at key '${key}' failed shape assertion.`,
            );
        }
        await this.run('readwrite', (store) => store.put(value, key));
        return value;
    }

    /** Removes the value stored at `key`. Does nothing if no value is stored there. */
    public async removeItem(
        /** Key to remove. */
        key: string,
    ): Promise<void> {
        await this.run('readwrite', (store) => store.delete(key));
    }

    /** Removes all values from the store. */
    public async clear(): Promise<void> {
        await this.run('readwrite', (store) => store.clear());
    }

    /** Resolves with the number of values currently stored. */
    public size(): Promise<number> {
        return this.run('readonly', (store) => store.count());
    }

    /** Resolves with all keys currently stored. */
    public keys(): Promise<string[]> {
        return this.run('readonly', (store) => store.getAllKeys()) as Promise<string[]>;
    }

    /** Iterates over all entries in the store. */
    public async iterate<U = void>(
        /**
         * Called for each entry. Return a non-`undefined` value to stop early and resolve the
         * returned promise with that value.
         */
        fn: (value: unknown, key: string, index: number) => U,
    ): Promise<U | undefined> {
        const cursorRequest = (await this.openObjectStore('readonly')).openCursor();
        return new Promise((resolve, reject) => {
            let index = 0;
            cursorRequest.onsuccess = () => {
                const cursor = cursorRequest.result;
                if (!cursor) {
                    return resolve(undefined);
                }
                const result = fn(cursor.value, cursor.key as string, index++);
                if (result !== undefined) {
                    return resolve(result);
                }
                cursor.continue();
            };
            /**
             * Unlike {@link Store.run}, an aborted cursor is not retried: reopening would replay
             * entries that `fn` has already been called with.
             */
            /* v8 ignore next 2: a cursor request only errors on transaction abort, which is not reproducible from this API. */
            cursorRequest.onerror = () => reject(toError(cursorRequest.error));
        });
    }

    /** Closes the connection to the underlying database without deleting any data. */
    public async destroy(): Promise<void> {
        (await this.connect()).close();
        this.connection = undefined;
    }

    /**
     * Closes the connection and permanently deletes the underlying database along with all of its
     * data.
     */
    public async deleteDatabase(): Promise<void> {
        await this.destroy();
        await req(indexedDB.deleteDatabase(this.storeName));
    }
}
