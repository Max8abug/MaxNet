const DATABASE = "photo-desktop-game-save-cache";
const STORE = "files";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local game-save storage."));
  });
}

export async function readLocalGameSaveFile(key: string): Promise<ArrayBuffer | null> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, "readonly");
      const request = transaction.objectStore(STORE).get(key);
      request.onsuccess = () => {
        const value = request.result;
        resolve(value instanceof ArrayBuffer ? value : null);
      };
      request.onerror = () => reject(request.error ?? new Error("Could not read the local game save."));
    });
  } finally {
    database.close();
  }
}

export async function writeLocalGameSaveFile(key: string, bytes: ArrayBuffer): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(bytes.slice(0), key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not write the local game save."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Local game-save write was aborted."));
    });
  } finally {
    database.close();
  }
}
