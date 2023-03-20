import { useCallback } from 'react';
import { validateBeforeTransaction } from './Utils';
import {IDBMigration, ObjectStoreMeta, ObjectStoreSchema} from './indexed-hooks';
import { createReadwriteTransaction } from './createReadwriteTransaction';
import { createReadonlyTransaction } from './createReadonlyTransaction';

export type Key = string | number | Date | ArrayBufferView | ArrayBuffer | IDBArrayKey | IDBKeyRange;
export interface IndexDetails {
  indexName: string;
  order: string;
}
const indexedDB: IDBFactory =
  window.indexedDB || (<any>window).mozIndexedDB || (<any>window).webkitIndexedDB || (<any>window).msIndexedDB;

export function openDatabase(dbName: string, version: number, upgradeCallback?: Function) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, version);
    let db: IDBDatabase;
    request.onsuccess = (event: Event) => {
      db = request.result;
      resolve(db);
    };
    request.onerror = (event: Event) => {
      reject(`IndexedDB error: ${request.error}`);
    };
    if (typeof upgradeCallback === 'function') {
      request.onupgradeneeded = (event: Event) => {
        upgradeCallback(event, db);
      };
    }
  });
}

function defaultMigrationBehaviour(database: IDBDatabase, storeSchemas: ObjectStoreMeta[]) {
  storeSchemas.forEach((storeSchema: ObjectStoreMeta) => {
    if (!database.objectStoreNames.contains(storeSchema.store)) {
      const objectStore = database.createObjectStore(storeSchema.store, storeSchema.storeConfig);
      storeSchema.storeSchema.forEach((schema: ObjectStoreSchema) => {
        objectStore.createIndex(schema.name, schema.keypath, schema.options);
      });
    }
  });

  return true;
}

function applyMigrations(event: IDBVersionChangeEvent, database: IDBDatabase, storeSchemas: ObjectStoreMeta[], migrations: IDBMigration[]): void {
  const oldVersion = event.oldVersion;
  const newVersion = event.newVersion;
  if(newVersion === null) {
    throw new Error('New version of indexedDb hasn\'t been set');
  }

  for(let nextVersion = oldVersion+1; nextVersion < newVersion+1; nextVersion++){
    const migration = migrations.find(x => x.toVersion === nextVersion);
    if(!migration) {
      throw new Error(`Db configuration should contain a migration for version ${nextVersion}`);
    }

    if(!migration.up) {
      throw new Error(`Up callback hasn't been implemented for migration with version ${nextVersion}`);
    }

    const succeeded = migration.up(database, storeSchemas, defaultMigrationBehaviour);
    if(!succeeded) {
      throw new Error(`Migration for version ${nextVersion} has failed`);
    }
  }
}

export async function CreateObjectStore(dbName: string, version: number, storeSchemas: ObjectStoreMeta[], migrations: IDBMigration[]|undefined): Promise<void> {
  const request: IDBOpenDBRequest = indexedDB.open(dbName, version);

  return new Promise((resolve, reject) => {
    request.onupgradeneeded = function (event: IDBVersionChangeEvent) {
      console.debug('[ReactIndexedDB] onupgradeneeded', event);
      const database: IDBDatabase = (event.target as any).result;

      try {
        if(migrations)
          applyMigrations(event, database, storeSchemas, migrations);
        else
          defaultMigrationBehaviour(database, storeSchemas);
        resolve();
      }
      catch (e) {
        reject(e);
        request.transaction!.abort();
      }

      database.close();
    };
    request.onsuccess = function (e: any) {
      console.debug('[ReactIndexedDB] onsuccess', e);
      e.target.result.close();
      resolve();
    };
    request.onerror = function (ev: Event) {
      console.debug('[ReactIndexedDB] onerror', ev);
      reject(ev);
    }
    request.onblocked = function (ev: IDBVersionChangeEvent) {
      console.debug('[ReactIndexedDB] onblocked', ev);
      reject(ev);
    }
  });
}

export function DBOperations(dbName: string, version: number, currentStore: string) {
  // Readonly operations
  const getAll = useCallback(
    <T>() => new Promise<T[]>((resolve, reject) => {
      openDatabase(dbName, version).then(db => {
        validateBeforeTransaction(db, currentStore, reject);
        const { store } = createReadonlyTransaction(db, currentStore, resolve, reject);
        const request = store.getAll();

        request.onerror = error => reject(error);

        request.onsuccess = function({ target: { result } }: any) {
          resolve(result as T[]);
        };
      });
    }),
    [dbName, version, currentStore]
  );

  const getByID = useCallback(
    <T>(id: string | number) => new Promise<T>((resolve, reject) => {
      openDatabase(dbName, version).then((db: IDBDatabase) => {
        validateBeforeTransaction(db, currentStore, reject);
        const { store } = createReadonlyTransaction(db, currentStore, resolve, reject);
        const request = store.get(id);

        request.onsuccess = function(event: Event) {
          resolve((event.target as any).result as T);
        };
      });
    }),
    [dbName, version, currentStore],
  );

  const openCursor = useCallback(
    (cursorCallback: (event: Event) => void, keyRange?: IDBKeyRange) => {
      return new Promise<void>((resolve, reject) => {
        openDatabase(dbName, version).then(db => {
          validateBeforeTransaction(db, currentStore, reject);
          const { store } = createReadonlyTransaction(db, currentStore, resolve, reject);
          const request = store.openCursor(keyRange);

          request.onsuccess = (event: Event) => {
            cursorCallback(event);
            resolve();
          };
        });
      });
    },
    [dbName, version, currentStore],
  );

  const getByIndex = useCallback(
    (indexName: string, key: any) => new Promise<any>((resolve, reject) => {
      openDatabase(dbName, version).then(db => {
        validateBeforeTransaction(db, currentStore, reject);
        const { store } = createReadonlyTransaction(db, currentStore, resolve, reject);
        const index = store.index(indexName);
        const request = index.get(key);

        request.onsuccess = (event: Event) => {
          resolve((<IDBOpenDBRequest>event.target).result);
        };
      });
    }),
    [dbName, version, currentStore],
  );

  // Readwrite operations
  const add = useCallback(
    <T>(value: T, key?: any) => new Promise<number>((resolve, reject) => {
      openDatabase(dbName, version).then((db: IDBDatabase) => {
        const { store } = createReadwriteTransaction(db, currentStore, resolve, reject);
        const request = store.add(value, key);

        request.onsuccess = (evt: any) => {
          key = evt.target.result;
          resolve(key);
        };

        request.onerror = error => reject(error);
      });
    }),
    [dbName, version, currentStore],
  );

  const update = useCallback(
    <T>(value: T, key?: any) => new Promise<any>((resolve, reject) => {
      openDatabase(dbName, version).then(db => {
        validateBeforeTransaction(db, currentStore, reject);
        const {
          transaction,
          store,
        } = createReadwriteTransaction(db, currentStore, resolve, reject);

        transaction.oncomplete = event => resolve(event);

        store.put(value, key);
      });
    }),
    [dbName, version, currentStore],
  );

  const deleteRecord = useCallback(
    (key: Key) =>  new Promise<any>((resolve, reject) => {
      openDatabase(dbName, version).then(db => {
        validateBeforeTransaction(db, currentStore, reject);
        const { store } = createReadwriteTransaction(db, currentStore, resolve, reject);
        const request = store.delete(key);

        request.onsuccess = event => resolve(event);
      });
    }),
    [dbName, version, currentStore],
  );

  const clear = useCallback(
    () => new Promise<any>((resolve, reject) => {
      openDatabase(dbName, version).then(db => {
        validateBeforeTransaction(db, currentStore, reject);
        const { store, transaction } = createReadwriteTransaction(db, currentStore, resolve, reject);

        transaction.oncomplete = () => resolve();

        store.clear();
      });
    }),
    [dbName, version, currentStore],
  );

  return {
    add,
    getByID,
    getAll,
    update,
    deleteRecord,
    clear,
    openCursor,
    getByIndex,
  };
}

export enum DBMode {
  readonly = 'readonly',
  readwrite = 'readwrite'
}
