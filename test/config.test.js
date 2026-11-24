import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';

function repoWith(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ht-config-'));
  if (config !== undefined) {
    fs.writeFileSync(path.join(dir, '.herdr-team.json'), typeof config === 'string' ? config : JSON.stringify(config));
  }
  return dir;
}

test('loadConfig returns defaults when the file is missing', () => {
  assert.deepEqual(loadConfig(repoWith()), { worktreeDir: '.worktrees', prepare: [] });
});

test('loadConfig returns the spec example as written', () => {
  const example = {
    worktreeDir: '.worktrees',
    prepare: [
      { copy: 'app/.env' },
      { link: 'app/node_modules' },
      { copy: 'app/vendor' },
    ],
    verify: 'php artisan --version',
  };
  assert.deepEqual(loadConfig(repoWith(example)), example);
});

test('loadConfig rejects an unknown step key', () => {
  assert.throws(() => loadConfig(repoWith({ prepare: [{ symlink: 'x' }] })), /bilinmeyen adım/);
});

for (const key of ['copy', 'link']) {
  for (const bad of ['/abs/path', 'C:\\abs', 'a/../b', '..']) {
    test(`loadConfig rejects ${key} path ${JSON.stringify(bad)}`, () => {
      assert.throws(() => loadConfig(repoWith({ prepare: [{ [key]: bad }] })), /geçersiz yol/);
    });
  }
}

test('loadConfig reports invalid JSON with the file name', () => {
  assert.throws(() => loadConfig(repoWith('{nope')), /\.herdr-team\.json/);
});

test('test command is optional and returned when present', () => {
  assert.equal(loadConfig(repoWith({ test: 'npm test' })).test, 'npm test');
  assert.equal('test' in loadConfig(repoWith({})), false);
});

test('test must be a non-empty string', () => {
  for (const bad of ['', 5, null, ['npm test']]) {
    assert.throws(() => loadConfig(repoWith({ test: bad })), /test boş olmayan bir dize olmalı/);
  }
});
