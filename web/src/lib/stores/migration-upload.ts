import { derived, writable } from 'svelte/store';

export enum MigrationUploadState {
  PENDING = 'pending',
  UPLOADING = 'uploading',
  DONE = 'done',
  ERROR = 'error',
}

export type MigrationUploadItem = {
  id: string;
  file: File;
  state: MigrationUploadState;
  progress: number;
  error?: string;
};

function createMigrationUploadStore() {
  const items = writable<MigrationUploadItem[]>([]);

  const addItem = (file: File) => {
    const id = `${file.name}-${file.size}-${file.lastModified}`;
    items.update((current) => {
      if (current.some((item) => item.id === id)) {
        return current;
      }
      return [
        ...current,
        {
          id,
          file,
          state: MigrationUploadState.PENDING,
          progress: 0,
        },
      ];
    });
    return id;
  };

  const updateItem = (id: string, patch: Partial<MigrationUploadItem>) => {
    items.update((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const removeItem = (id: string) => {
    items.update((current) => current.filter((item) => item.id !== id));
  };

  const reset = () => items.set([]);

  const remainingUploads = derived(items, (values) =>
    values.filter((item) => item.state === MigrationUploadState.PENDING || item.state === MigrationUploadState.UPLOADING)
      .length,
  );

  const completedUploads = derived(items, (values) =>
    values.filter((item) => item.state === MigrationUploadState.DONE).length,
  );

  return {
    subscribe: items.subscribe,
    remainingUploads,
    completedUploads,
    addItem,
    updateItem,
    removeItem,
    reset,
  };
}

export const migrationUploadStore = createMigrationUploadStore();
