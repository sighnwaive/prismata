import { app, safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export function createElectronCredentialStore() {
  const file = () => path.join(app.getPath('userData'), 'auth.secure');
  return {
    async get(key: string): Promise<unknown | null> {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('OS credential encryption unavailable');
      try {
        const encrypted = await fs.readFile(file(), 'utf8');
        const values = JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, 'base64'))) as Record<string, unknown>;
        return values[key] ?? null;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async set(key: string, value: unknown): Promise<void> {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('OS credential encryption unavailable');
      let values: Record<string, unknown> = {};
      try {
        const encrypted = await fs.readFile(file(), 'utf8');
        values = JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, 'base64')));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      values[key] = value;
      await fs.mkdir(path.dirname(file()), { recursive: true });
       const temporary = `${file()}.tmp`;
       await fs.writeFile(temporary, safeStorage.encryptString(JSON.stringify(values)).toString('base64'), { encoding: 'utf8', mode: 0o600 });
       await fs.rename(temporary, file());
    },
    async delete(key: string): Promise<void> {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('OS credential encryption unavailable');
      let values: Record<string, unknown> = {};
      try { values = JSON.parse(safeStorage.decryptString(Buffer.from(await fs.readFile(file(), 'utf8'), 'base64'))) as Record<string, unknown>; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      delete values[key];
      const temporary = `${file()}.tmp`;
      await fs.writeFile(temporary, safeStorage.encryptString(JSON.stringify(values)).toString('base64'), { encoding: 'utf8', mode: 0o600 });
      await fs.rename(temporary, file());
    },
  };
}
