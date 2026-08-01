// cspell:word keyvaluepairs
import {assert} from '@augment-vir/assert';
import {randomString, type PartialWithUndefined} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {defineShape} from 'object-shape-tester';
import {Store} from './store.js';
import {toError} from './util/to-error.js';

/** A subclass that exposes the protected internals needed to test error paths. */
class TestStore extends Store {
    public addOnce(key: string, value: unknown) {
        return this.run('readwrite', (store) => store.add(value, key));
    }

    /** Opens the database at an explicit version, bypassing the version-less attach. */
    public openAtVersion(version: number) {
        return this.openDatabase(version);
    }

    /**
     * Closes the underlying database while leaving the cached connection in place, imitating a
     * connection that was closed by a `versionchange` from elsewhere.
     */
    public async closeWithoutClearingCache(): Promise<void> {
        (await this.connect()).close();
    }

    /** Exposes the cached connection, opening one when there isn't one yet. */
    public open(): Promise<IDBDatabase> {
        return this.connect();
    }

    /** Drops the cached connection without closing it, so the next open replaces it. */
    public dropCache(): void {
        this.connection = undefined;
    }

    public get hasCachedConnection(): boolean {
        return !!this.connection;
    }

    /** How many transactions {@link TestStore.putAbortingFirstAttempt} has started. */
    public putAttempts = 0;

    /**
     * Writes `value` at `key`, aborting the first attempt's transaction to imitate a connection
     * lost while the transaction was in flight.
     */
    public putAbortingFirstAttempt(key: string, value: unknown) {
        return this.run('readwrite', (objectStore) => {
            const request = objectStore.put(value, key);
            this.putAttempts++;
            if (this.putAttempts === 1) {
                objectStore.transaction.abort();
            }
            return request;
        });
    }
}

function createUniqueName(): string {
    return `indexed-vir-test-${randomString()}`;
}

/** Deletes a database by name, bypassing a {@link Store} (whose connection may be poisoned). */
function deleteDatabaseByName(name: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onblocked = () => reject(new Error(`Deleting database '${name}' was blocked.`));
        request.onsuccess = () => resolve();
        request.onerror = () => reject(toError(request.error));
    });
}

/**
 * Opens a database directly, without going through a {@link Store}, to imitate another tab or
 * library using the same database. Rejects rather than hanging when an open {@link Store} connection
 * refuses to yield.
 */
function openRawDatabase({
    name,
    version,
    objectStoreName,
}: Readonly<
    {name: string} & PartialWithUndefined<{version: number; objectStoreName: string}>
>): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = version == undefined ? indexedDB.open(name) : indexedDB.open(name, version);
        request.onupgradeneeded = () => {
            if (objectStoreName) {
                request.result.createObjectStore(objectStoreName);
            }
        };
        request.onblocked = () => reject(new Error(`Opening database '${name}' was blocked.`));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(toError(request.error));
    });
}

/** Creates a uniquely-named store and guarantees its database is deleted afterwards. */
async function withStore(callback: (store: Store) => Promise<void>): Promise<void> {
    const store = new Store(createUniqueName());
    try {
        await callback(store);
    } finally {
        await store.deleteDatabase();
    }
}

describe(Store.name, () => {
    it('derives the object store name from the store name', () => {
        const store = new Store('my-store');
        assert.strictEquals(store.storeName, 'my-store');
        assert.strictEquals(store.objectStoreName, 'my-store-object-store');
    });

    it('stores and reads back a value', async () => {
        await withStore(async (store) => {
            const stored = await store.setItem('key', {
                a: 1,
                b: 'two',
            });
            assert.deepEquals(stored, {
                a: 1,
                b: 'two',
            });
            assert.deepEquals(await store.getItem('key'), {
                a: 1,
                b: 'two',
            });
        });
    });

    it('returns the stored value from setItem', async () => {
        await withStore(async (store) => {
            assert.strictEquals(await store.setItem('key', 42), 42);
        });
    });

    it('returns undefined for a missing key', async () => {
        await withStore(async (store) => {
            assert.isUndefined(await store.getItem('does-not-exist'));
        });
    });

    it('overwrites an existing value', async () => {
        await withStore(async (store) => {
            await store.setItem('key', 'first');
            await store.setItem('key', 'second');
            assert.strictEquals(await store.getItem('key'), 'second');
        });
    });

    it('round-trips falsy-but-defined values', async () => {
        await withStore(async (store) => {
            await store.setItem('zero', 0);
            await store.setItem('empty', '');
            await store.setItem('false', false);
            assert.strictEquals(await store.getItem('zero'), 0);
            assert.strictEquals(await store.getItem('empty'), '');
            assert.strictEquals(await store.getItem('false'), false);
        });
    });

    it('reads back a stored null exactly', async () => {
        await withStore(async (store) => {
            await store.setItem('key', null);
            assert.strictEquals(await store.getItem('key'), null);
        });
    });

    it('reads back a stored undefined exactly', async () => {
        await withStore(async (store) => {
            await store.setItem('key', undefined);
            assert.isUndefined(await store.getItem('key'));
        });
    });

    it('distinguishes a stored null from a missing key', async () => {
        await withStore(async (store) => {
            await store.setItem('present', null);
            assert.strictEquals(await store.getItem('present'), null);
            assert.isUndefined(await store.getItem('absent'));
        });
    });

    it('stores various value types', async () => {
        await withStore(async (store) => {
            const map = new Map([
                [
                    'a',
                    1,
                ],
            ]);
            await store.setItem(
                'array',
                [
                    1,
                    2,
                    3,
                ],
            );
            await store.setItem('nested', {
                deep: {
                    value: [
                        {
                            x: 1,
                        },
                    ],
                },
            });
            await store.setItem('map', map);
            assert.deepEquals(
                await store.getItem('array'),
                [
                    1,
                    2,
                    3,
                ],
            );
            assert.deepEquals(await store.getItem('nested'), {
                deep: {
                    value: [
                        {
                            x: 1,
                        },
                    ],
                },
            });
            assert.deepEquals(await store.getItem('map'), map);
        });
    });

    it('removes a value', async () => {
        await withStore(async (store) => {
            await store.setItem('key', 'value');
            await store.removeItem('key');
            assert.isUndefined(await store.getItem('key'));
        });
    });

    it('does nothing when removing a missing key', async () => {
        await withStore(async (store) => {
            await store.removeItem('does-not-exist');
            assert.strictEquals(await store.size(), 0);
        });
    });

    it('clears all values', async () => {
        await withStore(async (store) => {
            await store.setItem('a', 1);
            await store.setItem('b', 2);
            await store.clear();
            assert.strictEquals(await store.size(), 0);
        });
    });

    it('reports the number of stored values', async () => {
        await withStore(async (store) => {
            assert.strictEquals(await store.size(), 0);
            await store.setItem('a', 1);
            await store.setItem('b', 2);
            assert.strictEquals(await store.size(), 2);
            await store.removeItem('a');
            assert.strictEquals(await store.size(), 1);
        });
    });

    it('lists all keys', async () => {
        await withStore(async (store) => {
            await store.setItem('a', 1);
            await store.setItem('b', 2);
            await store.setItem('c', 3);
            assert.deepEquals((await store.keys()).toSorted(), [
                'a',
                'b',
                'c',
            ]);
        });
    });

    it('returns an empty key list for an empty store', async () => {
        await withStore(async (store) => {
            assert.isLengthExactly(await store.keys(), 0);
        });
    });

    it('handles concurrent writes', async () => {
        await withStore(async (store) => {
            await Promise.all([
                store.setItem('a', 1),
                store.setItem('b', 2),
                store.setItem('c', 3),
            ]);
            assert.strictEquals(await store.size(), 3);
        });
    });

    describe('shape validation', () => {
        const personShape = defineShape({
            name: '',
            age: 0,
        });

        it('validates and types a matching value on getItem', async () => {
            await withStore(async (store) => {
                await store.setItem('person', {
                    name: 'Alice',
                    age: 30,
                });
                const person = await store.getItem('person', personShape);
                assert.deepEquals(person, {
                    name: 'Alice',
                    age: 30,
                });
            });
        });

        it('returns undefined for a missing key even with a shape', async () => {
            await withStore(async (store) => {
                assert.isUndefined(await store.getItem('missing', personShape));
            });
        });

        it('validates a stored null against the shape', async () => {
            await withStore(async (store) => {
                await store.setItem('person', null);
                await assert.throws(() => store.getItem('person', personShape), {
                    matchMessage: 'failed shape assertion',
                });
            });
        });

        it('validates a stored undefined against the shape', async () => {
            await withStore(async (store) => {
                await store.setItem('person', undefined);
                await assert.throws(() => store.getItem('person', personShape), {
                    matchMessage: 'failed shape assertion',
                });
            });
        });

        it('throws on getItem when the stored value does not match the shape', async () => {
            await withStore(async (store) => {
                await store.setItem('person', {
                    name: 'Alice',
                });
                await assert.throws(() => store.getItem('person', personShape), {
                    matchMessage: 'failed shape assertion',
                });
            });
        });

        it('validates a matching value on setItem', async () => {
            await withStore(async (store) => {
                const stored = await store.setItem(
                    'person',
                    {
                        name: 'Bob',
                        age: 40,
                    },
                    personShape,
                );
                assert.deepEquals(stored, {
                    name: 'Bob',
                    age: 40,
                });
            });
        });

        it('throws on setItem when the value does not match the shape', async () => {
            await withStore(async (store) => {
                await assert.throws(
                    () =>
                        store.setItem(
                            'person',
                            {
                                name: 'Bob',
                                age: 'not a number',
                            } as never,
                            personShape,
                        ),
                    {
                        matchMessage: 'failed shape assertion',
                    },
                );
                assert.isUndefined(await store.getItem('person'));
            });
        });
    });

    describe('iterate', () => {
        it('iterates over all entries with incrementing indexes', async () => {
            await withStore(async (store) => {
                await store.setItem('a', 1);
                await store.setItem('b', 2);
                await store.setItem('c', 3);

                const seen: {key: string; value: unknown; index: number}[] = [];
                const result = await store.iterate((value, key, index) => {
                    seen.push({
                        key,
                        value,
                        index,
                    });
                });

                assert.isUndefined(result);
                assert.isLengthExactly(seen, 3);
                assert.deepEquals(
                    seen.map((entry) => entry.index),
                    [
                        0,
                        1,
                        2,
                    ],
                );
                assert.deepEquals(seen.map((entry) => entry.key).toSorted(), [
                    'a',
                    'b',
                    'c',
                ]);
                assert.deepEquals(
                    seen.map((entry) => entry.value).toSorted(),
                    [
                        1,
                        2,
                        3,
                    ],
                );
            });
        });

        it('stops early and resolves with the returned value', async () => {
            await withStore(async (store) => {
                await store.setItem('a', 1);
                await store.setItem('b', 2);
                await store.setItem('c', 3);

                let count = 0;
                const result = await store.iterate((value, key) => {
                    count++;
                    if (key === 'b') {
                        return `found ${key}`;
                    }
                    return undefined;
                });

                assert.strictEquals(result, 'found b');
                assert.isBelow(count, 3);
            });
        });

        it('resolves with undefined for an empty store', async () => {
            await withStore(async (store) => {
                let called = false;
                const result = await store.iterate(() => {
                    called = true;
                });
                assert.isUndefined(result);
                assert.isFalse(called);
            });
        });
    });

    describe('connection lifecycle', () => {
        it('reuses the connection across operations', async () => {
            await withStore(async (store) => {
                await store.setItem('a', 1);
                await store.setItem('b', 2);
                assert.strictEquals(await store.getItem('a'), 1);
                assert.strictEquals(await store.getItem('b'), 2);
            });
        });

        it('keeps data after destroy and reconnects on next use', async () => {
            await withStore(async (store) => {
                await store.setItem('key', 'value');
                await store.destroy();
                assert.strictEquals(await store.getItem('key'), 'value');
            });
        });

        it('can be destroyed before any other use', async () => {
            const store = new Store(createUniqueName());
            await store.destroy();
            try {
                assert.strictEquals(await store.size(), 0);
            } finally {
                await store.deleteDatabase();
            }
        });

        it('deletes the database and all of its data', async () => {
            const name = createUniqueName();
            const store = new Store(name);
            await store.setItem('key', 'value');
            await store.deleteDatabase();

            const freshStore = new Store(name);
            try {
                assert.strictEquals(await freshStore.size(), 0);
                assert.isUndefined(await freshStore.getItem('key'));
            } finally {
                await freshStore.deleteDatabase();
            }
        });

        it('isolates data between differently-named stores', async () => {
            const storeA = new Store(createUniqueName());
            const storeB = new Store(createUniqueName());
            try {
                await storeA.setItem('key', 'a-value');
                await storeB.setItem('key', 'b-value');
                assert.strictEquals(await storeA.getItem('key'), 'a-value');
                assert.strictEquals(await storeB.getItem('key'), 'b-value');
            } finally {
                await storeA.deleteDatabase();
                await storeB.deleteDatabase();
            }
        });
    });

    describe('error handling', () => {
        it('rejects when a request errors', async () => {
            const store = new TestStore(createUniqueName());
            try {
                await store.addOnce('key', 'first');
                await assert.throws(() => store.addOnce('key', 'second'), {
                    matchConstructor: Error,
                });
            } finally {
                await store.deleteDatabase();
            }
        });

        it('rejects when the database cannot be opened at the requested version', async () => {
            const name = createUniqueName();
            const existing = await openRawDatabase({
                name,
                version: 3,
            });
            existing.close();

            const store = new TestStore(name);
            try {
                /** Opening below the current version is a `VersionError`. */
                await assert.throws(() => store.openAtVersion(1), {
                    matchConstructor: Error,
                });
            } finally {
                await deleteDatabaseByName(name);
            }
        });
    });

    describe('sharing a database with other connections', () => {
        it('attaches to a database that is already at a higher version', async () => {
            const name = createUniqueName();
            const existing = await openRawDatabase({
                name,
                version: 5,
            });
            existing.close();

            const store = new Store(name);
            try {
                await store.setItem('key', 'value');
                assert.strictEquals(await store.getItem('key'), 'value');
            } finally {
                await deleteDatabaseByName(name);
            }
        });

        it('adds its object store without disturbing a foreign object store', async () => {
            const name = createUniqueName();
            const foreignObjectStoreName = 'foreign-object-store';
            const foreign = await openRawDatabase({
                name,
                version: 1,
                objectStoreName: foreignObjectStoreName,
            });
            foreign.close();

            const store = new Store(name);
            try {
                await store.setItem('key', 'value');
                assert.strictEquals(await store.getItem('key'), 'value');

                const reopened = await openRawDatabase({
                    name,
                });
                assert.deepEquals(
                    Array.from(reopened.objectStoreNames).toSorted(),
                    [
                        foreignObjectStoreName,
                        store.objectStoreName,
                    ].toSorted(),
                );
                reopened.close();
            } finally {
                await deleteDatabaseByName(name);
            }
        });

        it('yields to another connection upgrading the database', async () => {
            const name = createUniqueName();
            const store = new Store(name);
            try {
                await store.setItem('key', 'value');

                /** Blocks forever if the store's open connection does not close itself. */
                const upgraded = await openRawDatabase({
                    name,
                    version: 100,
                });
                assert.strictEquals(upgraded.version, 100);
                upgraded.close();

                assert.strictEquals(await store.getItem('key'), 'value');
            } finally {
                await deleteDatabaseByName(name);
            }
        });

        it('lets another connection add its own object store while connected', async () => {
            const name = createUniqueName();
            const foreignObjectStoreName = 'keyvaluepairs';
            const store = new Store(name);
            try {
                await store.setItem('key', 'value');

                /**
                 * Adding an object store requires a version bump, which blocks forever if the
                 * store's open connection does not close itself.
                 */
                const foreign = await openRawDatabase({
                    name,
                    version: 2,
                    objectStoreName: foreignObjectStoreName,
                });
                assert.deepEquals(
                    Array.from(foreign.objectStoreNames).toSorted(),
                    [
                        foreignObjectStoreName,
                        store.objectStoreName,
                    ].toSorted(),
                );
                foreign.close();

                assert.strictEquals(await store.getItem('key'), 'value');
            } finally {
                await deleteDatabaseByName(name);
            }
        });

        it('yields to another connection deleting the database', async () => {
            const name = createUniqueName();
            const store = new Store(name);
            try {
                await store.setItem('key', 'value');

                /** Blocks forever if the store's open connection does not close itself. */
                await deleteDatabaseByName(name);

                assert.isUndefined(await store.getItem('key'));
            } finally {
                await deleteDatabaseByName(name);
            }
        });

        it('reconnects when the cached connection has been closed', async () => {
            const store = new TestStore(createUniqueName());
            try {
                await store.setItem('key', 'value');
                await store.closeWithoutClearingCache();
                assert.strictEquals(await store.getItem('key'), 'value');
            } finally {
                await store.deleteDatabase();
            }
        });

        it('reconnects during iterate when the cached connection has been closed', async () => {
            const store = new TestStore(createUniqueName());
            try {
                await store.setItem('key', 'value');
                await store.closeWithoutClearingCache();

                const seen: unknown[] = [];
                await store.iterate((value) => {
                    seen.push(value);
                });
                assert.deepEquals(seen, ['value']);
            } finally {
                await store.deleteDatabase();
            }
        });

        it('reopens after the browser closes the connection', async () => {
            const store = new TestStore(createUniqueName());
            try {
                await store.setItem('key', 'value');

                const connection = await store.open();
                connection.close();
                /** Browsers fire `close` when they tear a connection down on their own. */
                connection.dispatchEvent(new Event('close'));

                assert.isFalse(store.hasCachedConnection);
                assert.strictEquals(await store.getItem('key'), 'value');
            } finally {
                await store.deleteDatabase();
            }
        });

        it('keeps the current connection when a replaced one closes', async () => {
            const store = new TestStore(createUniqueName());
            try {
                const replaced = await store.open();
                store.dropCache();
                const current = await store.open();

                /** The replaced connection is still open and fires its handlers too late to matter. */
                replaced.dispatchEvent(new Event('versionchange'));

                assert.strictEquals(await store.open(), current);
            } finally {
                await store.deleteDatabase();
            }
        });

        it('retries once when the connection is lost mid-transaction', async () => {
            const store = new TestStore(createUniqueName());
            try {
                assert.strictEquals(await store.putAbortingFirstAttempt('key', 'value'), 'key');
                assert.strictEquals(store.putAttempts, 2);
                assert.strictEquals(await store.getItem('key'), 'value');
            } finally {
                await store.deleteDatabase();
            }
        });
    });
});
