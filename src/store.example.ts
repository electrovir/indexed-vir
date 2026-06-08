import {Store} from './store.js';

const store = new Store('my-store');

/** Get an existing value. */
const existingValue = await store.getItem('my-key');

/** Store a new value. */
await store.setItem('my-key', {
    count: 1,
});

/** Destroy the store when finished (this does not wipe the stored data). */
await store.destroy();
