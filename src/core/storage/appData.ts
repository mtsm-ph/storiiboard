import { command } from './tauriDriver';

/**
 * Small text files that belong to the person, not to a project, in the app's data folder. The Rust side allows only
 * the names it knows (src-tauri/src/app_data.rs).
 */
export interface AppDataStore {
  read(name: string): Promise<string | null>;
  write(name: string, contents: string): Promise<void>;
}

export const tauriAppData: AppDataStore = {
  read: (name) => command<string | null>('app_data_read', { name }),
  write: (name, contents) => command('app_data_write', { name, contents }),
};
