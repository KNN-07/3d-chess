/**
 * Local companion persistence. Files are structured-cloned by IndexedDB;
 * callers must preserve their relative paths separately in `paths`.
 * This module never loads, fetches, or executes a saved runtime.
 */
const DATABASE_NAME = 'noir-chess-companion-v1';
const DATABASE_VERSION = 1;
const STORE_NAME = 'records';
const COMPANION_KEY = 'current';
const CORE_KEY = 'selected-core';

/**
 * @typedef {Object} CompanionSave
 * @property {File[]} files
 * @property {string[]} paths Relative paths corresponding to `files`.
 * @property {string} manifestPath
 * @property {File} [coreFile]
 * @property {{size: number}} [preferences]
 */

function storageError(cause, fallback, code) {
  let message = fallback;
  let storageCode = code || 'storage-failed';

  if (cause?.name === 'QuotaExceededError') {
    message = 'There is not enough browser storage to save this companion. Free some browser storage and try again.';
    storageCode = 'quota-exceeded';
  } else if (cause?.name === 'SecurityError' || cause?.name === 'NotAllowedError') {
    message = 'Local companion storage is unavailable because this browser or its privacy settings block IndexedDB.';
    storageCode = 'unavailable';
  } else if (cause?.name === 'DataCloneError') {
    message = 'The companion could not be saved because it contains data that the browser cannot store.';
    storageCode = 'invalid-data';
  } else if (cause?.message) {
    message += ` ${cause.message}`;
  }

  const error = new Error(message);
  error.name = 'CompanionStorageError';
  error.code = storageCode;
  if (cause) error.cause = cause;
  return error;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    let request;
    let rejected = false;

    try {
      if (!globalThis.indexedDB) {
        reject(storageError(null, 'Local companion storage is unavailable because this browser does not provide IndexedDB.', 'unavailable'));
        return;
      }
      request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    } catch (cause) {
      reject(storageError(cause, 'The browser could not open local companion storage.', 'unavailable'));
      return;
    }

    const fail = error => {
      if (rejected) return;
      rejected = true;
      reject(error);
    };

    request.onupgradeneeded = () => {
      // A previously blocked open can continue after its promise was rejected.
      // Do not let that abandoned request change the database.
      if (rejected) {
        request.transaction.abort();
        return;
      }
      try {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      } catch (cause) {
        request.transaction.abort();
        fail(storageError(cause, 'The browser could not initialize local companion storage.'));
      }
    };
    request.onerror = () => fail(storageError(request.error, 'The browser could not open local companion storage.'));
    request.onblocked = () => fail(storageError(null,
      'Local companion storage is blocked by another open game tab. Close the other tab and try again.', 'blocked'));
    request.onsuccess = () => {
      const database = request.result;
      if (rejected) {
        database.close();
        return;
      }
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}

/** Resolve only after the transaction has committed, never on request success. */
async function runRequest(mode, makeRequest) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    let transaction;
    let requestError;
    let result;
    let settled = false;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      database.close();
      if (error) reject(error);
      else resolve(result);
    };

    try {
      transaction = database.transaction(STORE_NAME, mode);
      transaction.oncomplete = () => finish();
      transaction.onabort = () => finish(storageError(requestError || transaction.error,
        'The browser could not finish saving or reading the companion. Please try again.'));
      // Let IndexedDB's default error handling abort failed requests atomically.
      transaction.onerror = event => {
        requestError = event.target?.error || transaction.error || requestError;
      };

      const request = makeRequest(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => { requestError = request.error; };
    } catch (cause) {
      if (transaction) {
        try { transaction.abort(); } catch { /* Already inactive. */ }
      }
      finish(storageError(cause, 'The browser could not access local companion storage.'));
    }
  });
}

/** @returns {Promise<CompanionSave|null>} */
export async function readCompanionSave() {
  return (await runRequest('readonly', store => store.get(COMPANION_KEY))) ?? null;
}

/**
 * Atomically replaces the complete companion record. The caller validates the
 * selected files, paths, manifest, and the 150 MB size limit before calling.
 * @param {CompanionSave} record
 * @returns {Promise<void>}
 */
export async function writeCompanionSave(record) {
  if (!record || typeof record !== 'object') {
    throw storageError(null, 'A companion save record is required.', 'invalid-data');
  }
  await runRequest('readwrite', store => store.put(record, COMPANION_KEY));
}

/** Removes the companion record while retaining the separately selected core. */
export async function clearCompanionSave() {
  await runRequest('readwrite', store => store.delete(COMPANION_KEY));
}

/** @returns {Promise<File|null>} */
export async function readCoreSave() {
  return (await runRequest('readonly', store => store.get(CORE_KEY))) ?? null;
}

/**
 * Saves only a core File that the user explicitly selected. Persistence does
 * not grant execution permission; the caller controls runtime loading.
 * @param {File} coreFile
 * @returns {Promise<void>}
 */
export async function writeCoreSave(coreFile) {
  if (!coreFile || typeof coreFile !== 'object') {
    throw storageError(null, 'An explicitly selected core file is required.', 'invalid-data');
  }
  await runRequest('readwrite', store => store.put(coreFile, CORE_KEY));
}
