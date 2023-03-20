import { DBOperations, openDatabase, Key, CreateObjectStore } from './indexed-db';

export interface IndexedDBProps {
  name: string;
  version: number;
  objectStoresMeta: ObjectStoreMeta[];    /**
   * Use this to add migrations possibility.
   * Each migration applies sequentially, one by one.
   * You should implement all migrations without gaps in versions.
   * For example, if you set version to 3, then there should be three migrations with versions 1, 2 and 3.
   * If something goes wrong during migration process the transaction will be aborted and initDB throw an Exception.
   * If you aren't going to do something special in a subsequent migration you can just
   * call 'defaultMigrationBehaviour' callback like this:
   * {
   *      toVersion: 2,
   *      up: (db: IDBDatabase, storeSchemas: ObjectStoreMeta[], defaultMigrationBehaviour: ((database: IDBDatabase, storeSchemas: ObjectStoreMeta[]) => boolean)) => {
   *          return defaultMigrationBehaviour(db, storeSchemas);
   *      }
   * }
   *
   * 'defaultMigrationBehaviour' will just run through objectStoresMeta you specified in configuration and
   * create missing stores.
   */
  migrations?: IDBMigration[] | undefined;
}

export interface IDBMigration {
  toVersion: number;
  up: (db: IDBDatabase, storeSchemas: ObjectStoreMeta[], defaultMigrationBehaviour: ((database: IDBDatabase, storeSchemas: ObjectStoreMeta[]) => boolean)) => boolean;
}

export interface ObjectStoreMeta {
  store: string;
  storeConfig: { keyPath: string; autoIncrement: boolean; [key: string]: any };
  storeSchema: ObjectStoreSchema[];
}

export interface ObjectStoreSchema {
  name: string;
  keypath: string;
  options: { unique: boolean; [key: string]: any };
}

export interface useIndexedDB {
  dbName: string;
  version: number;
  objectStore: string;
}

let indexeddbConfiguration: { version: number; name: string } = { version: null, name: null };

export async function initDB({name, version, objectStoresMeta, migrations}: IndexedDBProps): Promise<void> {
  indexeddbConfiguration.name = name;
  indexeddbConfiguration.version = version;
  Object.freeze(indexeddbConfiguration);
  return await CreateObjectStore(name, version, objectStoresMeta, migrations);
}

export function useIndexedDB(
  objectStore: string
): {
  add: <T = any>(value: T, key?: any) => Promise<number>;
  getByID: <T = any>(id: number | string) => Promise<T>;
  getAll: <T = any>() => Promise<T[]>;
  update: <T = any>(value: T, key?: any) => Promise<any>;
  deleteRecord: (key: Key) => Promise<any>;
  openCursor: (cursorCallback: (event: Event) => void, keyRange?: IDBKeyRange) => Promise<void>;
  getByIndex: (indexName: string, key: any) => Promise<any>;
  clear: () => Promise<any>;
} {
  if (!indexeddbConfiguration.name || !indexeddbConfiguration.version) {
    throw new Error('Please, initialize the DB before the use.');
  }
  return { ...DBOperations(indexeddbConfiguration.name, indexeddbConfiguration.version, objectStore) };
}
