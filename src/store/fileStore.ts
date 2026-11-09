import { randomUUID } from 'node:crypto';
import { rename, stat, readFile, writeFile } from 'node:fs/promises';

export type Loaded = { text: string; mtimeMs: number | null };
export type Saved = { ok: true; mtimeMs: number } | { ok: false };
export type FileStore = {
  load(): Promise<Loaded>;
  save(text: string, expectedMtimeMs: number | null): Promise<Saved>;
};

const mtimeOf = async (path: string): Promise<number | null> => {
  try {
    return (await stat(path)).mtimeMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
};

export const createFileStore = (path: string): FileStore => ({
  async load() {
    const mtimeMs = await mtimeOf(path);
    return mtimeMs === null ? { text: '', mtimeMs } : { text: await readFile(path, 'utf8'), mtimeMs };
  },
  async save(text, expectedMtimeMs) {
    if ((await mtimeOf(path)) !== expectedMtimeMs) return { ok: false };
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, text);
    await rename(temporary, path);
    return { ok: true, mtimeMs: (await stat(path)).mtimeMs };
  },
});
