import {assert} from '@augment-vir/assert';
import {randomString} from '@augment-vir/common';
import {describe, it} from '@augment-vir/test';
import {defineShape} from 'object-shape-tester';
import {Store} from './store.js';
import {toError} from './util/to-error.js';

/** A subclass that exposes the protected internals needed to test error paths. */
class TestStore extends Store {
    public addOnce(key: string, value: unknown) {
        return this.run('readwrite', (store) => store.add(value, key));
    }
}

function createUniqueName(): string {
    return `indexed-vir-test-${randomString()}`;
}

/** Deletes a database by name, bypassing a {@link Store} (whose connection may be poisoned). */
function deleteDatabaseByName(name: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
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

        it('rejects when the database cannot be opened', async () => {
            const name = createUniqueName();
            const higherVersion = await new Promise<IDBDatabase>((resolve, reject) => {
                const open = indexedDB.open(name, 2);
                open.onsuccess = () => resolve(open.result);
                open.onerror = () => reject(toError(open.error));
            });
            higherVersion.close();

            const store = new Store(name);
            try {
                await assert.throws(() => store.size(), {
                    matchConstructor: Error,
                });
            } finally {
                await deleteDatabaseByName(name);
            }
        });
    });
});
