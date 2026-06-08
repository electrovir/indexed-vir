# indexed-vir

A ridiculously simple wrapper for IndexedDB. Similar to the main interface of localforage, but written in modern syntax and without support for outdated standards.

full reference docs: https://electrovir.github.io/indexed-vir

## Install

```sh
npm i indexed-vir
```

## Usage

<!-- example-link: src/store.example.ts -->

```TypeScript
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
```
