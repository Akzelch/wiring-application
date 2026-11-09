import assert from 'node:assert/strict';
import { mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createFileStore } from './fileStore.ts';

const tempPath = async () => join(await mkdtemp(join(tmpdir(), 'wiring-')), 'project.json');

test('a missing file loads empty and is created on first save', async () => {
  const path = await tempPath();
  const store = createFileStore(path);
  assert.deepEqual(await store.load(), { text: '', mtimeMs: null });
  const saved = await store.save('{}', null);
  assert.equal(saved.ok, true);
  assert.equal(await readFile(path, 'utf8'), '{}');
});

test('consecutive saves succeed when each uses the returned modification time', async () => {
  const store = createFileStore(await tempPath());
  const first = await store.save('a', null);
  assert.ok(first.ok);
  assert.equal((await store.save('b', first.mtimeMs)).ok, true);
});

test('a save is refused when the file changed on disk, and leaves it untouched', async () => {
  const path = await tempPath();
  const store = createFileStore(path);
  const first = await store.save('mine', null);
  assert.ok(first.ok);
  await writeFile(path, 'from git');
  await utimes(path, new Date(), new Date(Date.now() + 5000));
  assert.deepEqual(await store.save('stale', first.mtimeMs), { ok: false });
  assert.equal(await readFile(path, 'utf8'), 'from git');
});

test('a save is refused when a file appeared after loading it as missing', async () => {
  const path = await tempPath();
  const store = createFileStore(path);
  await writeFile(path, 'created elsewhere');
  assert.deepEqual(await store.save('stale', null), { ok: false });
});
