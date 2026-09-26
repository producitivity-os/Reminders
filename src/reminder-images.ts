import { invoke } from "@tauri-apps/api/core";
import { Image as TauriImage } from "@tauri-apps/api/image";
import { isTauri } from "./api";

export type ReminderImageAttachment = {
  id: string;
  reminderId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  hasThumbnail: boolean;
  createdAt: number;
};

type StoredReminderImage = ReminderImageAttachment & { blob: Blob };
const databaseName = "reminders-media-v1";
const storeName = "images";
const objectUrls = new Map<string, string>();

function openBrowserDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(storeName, {
        keyPath: "id",
      });
      store.createIndex("reminderId", "reminderId", { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        request.error ?? new Error("Couldn’t open reminder image storage."),
      );
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openBrowserDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = operation(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Reminder image storage failed."));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Reminder image storage failed."));
  });
}

function attachment(value: StoredReminderImage): ReminderImageAttachment {
  const { blob: _blob, ...entry } = value;
  return entry;
}

function rememberObjectUrl(value: StoredReminderImage): void {
  const previous = objectUrls.get(value.id);
  if (previous) URL.revokeObjectURL(previous);
  objectUrls.set(value.id, URL.createObjectURL(value.blob));
}

async function imageDimensions(
  blob: Blob,
): Promise<{ width: number; height: number }> {
  const image = await createImageBitmap(blob);
  try {
    return { width: image.width, height: image.height };
  } finally {
    image.close();
  }
}

function rgbaDataUrl(rgba: Uint8Array, width: number, height: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image conversion is unavailable.");
  context.putImageData(
    new ImageData(new Uint8ClampedArray(rgba), width, height),
    0,
    0,
  );
  return canvas.toDataURL("image/png");
}

async function sourcePixels(source: string): Promise<{
  rgba: Uint8Array;
  width: number;
  height: number;
}> {
  const blob = await fetch(source).then((response) => response.blob());
  const image = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image conversion is unavailable.");
    context.drawImage(image, 0, 0);
    return {
      rgba: new Uint8Array(
        context.getImageData(0, 0, image.width, image.height).data,
      ),
      width: image.width,
      height: image.height,
    };
  } finally {
    image.close();
  }
}

export function reminderImageUrl(id: string, thumbnail = true): string {
  if (isTauri)
    return `media://localhost/${encodeURIComponent(id)}/${thumbnail ? "thumbnail" : "content"}`;
  return objectUrls.get(id) ?? "";
}

export const reminderImages = {
  async list(
    reminderIds: readonly string[],
  ): Promise<ReminderImageAttachment[]> {
    if (reminderIds.length === 0) return [];
    if (isTauri) return invoke("list_reminder_images", { reminderIds });
    const ids = new Set(reminderIds);
    const stored = await withStore<StoredReminderImage[]>("readonly", (store) =>
      store.getAll(),
    );
    const matching = stored.filter((item) => ids.has(item.reminderId));
    for (const item of matching) rememberObjectUrl(item);
    return matching
      .sort(
        (left, right) =>
          left.createdAt - right.createdAt || left.id.localeCompare(right.id),
      )
      .map(attachment);
  },

  async import(
    reminderId: string,
    input: { originalName: string; mimeType: string; dataUrl: string },
  ): Promise<ReminderImageAttachment> {
    if (isTauri)
      return invoke("import_reminder_image", {
        input: { reminderId, ...input },
      });
    const blob = await fetch(input.dataUrl).then((response) => response.blob());
    const dimensions = await imageDimensions(blob);
    const value: StoredReminderImage = {
      id: crypto.randomUUID(),
      reminderId,
      originalName: input.originalName || "pasted-image",
      mimeType: input.mimeType || blob.type || "image/png",
      sizeBytes: blob.size,
      width: dimensions.width,
      height: dimensions.height,
      hasThumbnail: false,
      createdAt: Date.now(),
      blob,
    };
    await withStore<IDBValidKey>("readwrite", (store) => store.put(value));
    rememberObjectUrl(value);
    return attachment(value);
  },

  async delete(id: string): Promise<boolean> {
    if (isTauri) return invoke("delete_reminder_image", { id });
    const existing = await withStore<StoredReminderImage | undefined>(
      "readonly",
      (store) => store.get(id),
    );
    if (!existing) return false;
    await withStore<undefined>("readwrite", (store) => store.delete(id));
    const url = objectUrls.get(id);
    if (url) URL.revokeObjectURL(url);
    objectUrls.delete(id);
    return true;
  },

  async deleteForReminder(reminderId: string): Promise<void> {
    if (isTauri) return;
    const stored = await withStore<StoredReminderImage[]>("readonly", (store) =>
      store.getAll(),
    );
    await Promise.all(
      stored
        .filter((item) => item.reminderId === reminderId)
        .map((item) => this.delete(item.id)),
    );
  },
};

export function fileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(reader.error ?? new Error("Couldn’t read the pasted image."));
    reader.readAsDataURL(file);
  });
}

export async function readNativeClipboardImage(): Promise<{
  originalName: string;
  mimeType: string;
  dataUrl: string;
} | null> {
  if (!isTauri) return null;
  try {
    const { readImage } = await import("@tauri-apps/plugin-clipboard-manager");
    const image = await readImage();
    try {
      const [rgba, size] = await Promise.all([image.rgba(), image.size()]);
      return {
        originalName: "pasted-image.png",
        mimeType: "image/png",
        dataUrl: rgbaDataUrl(rgba, size.width, size.height),
      };
    } finally {
      await image.close();
    }
  } catch {
    return null;
  }
}

export async function copyReminderImage(id: string): Promise<void> {
  const url = reminderImageUrl(id, false);
  if (!url) throw new Error("The reminder image is unavailable.");
  if (isTauri) {
    const pixels = await sourcePixels(url);
    const image = await TauriImage.new(
      pixels.rgba,
      pixels.width,
      pixels.height,
    );
    try {
      const { writeImage } =
        await import("@tauri-apps/plugin-clipboard-manager");
      await writeImage(image);
    } finally {
      await image.close();
    }
    return;
  }
  const blob = await fetch(url).then((response) => response.blob());
  await navigator.clipboard.write([
    new ClipboardItem({ [blob.type || "image/png"]: blob }),
  ]);
}
