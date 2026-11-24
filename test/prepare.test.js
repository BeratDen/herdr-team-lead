import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runPrepare, removeLinks } from '../src/prepare.js';
import { makeTmp, write } from './helpers.js';

function setup() {
  const repoRoot = makeTmp('ht-main-');
  const worktreePath = makeTmp('ht-wt-');
  return { repoRoot, worktreePath };
}

test('runPrepare copies a file into the worktree', () => {
  const { repoRoot, worktreePath } = setup();
  write(path.join(repoRoot, 'app', '.env'), 'SECRET=1');
  runPrepare([{ copy: 'app/.env' }], { repoRoot, worktreePath });
  assert.equal(fs.readFileSync(path.join(worktreePath, 'app', '.env'), 'utf8'), 'SECRET=1');
});

test('runPrepare copies a directory recursively', () => {
  const { repoRoot, worktreePath } = setup();
  write(path.join(repoRoot, 'app', 'vendor', 'x', 'a.php'), 'A');
  runPrepare([{ copy: 'app/vendor' }], { repoRoot, worktreePath });
  assert.equal(fs.readFileSync(path.join(worktreePath, 'app', 'vendor', 'x', 'a.php'), 'utf8'), 'A');
  assert.equal(fs.lstatSync(path.join(worktreePath, 'app', 'vendor')).isSymbolicLink(), false);
});

test('runPrepare link creates a junction that reads the source files', () => {
  const { repoRoot, worktreePath } = setup();
  write(path.join(repoRoot, 'app', 'node_modules', 'pkg', 'i.js'), 'J');
  runPrepare([{ link: 'app/node_modules' }], { repoRoot, worktreePath });
  const link = path.join(worktreePath, 'app', 'node_modules');
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(path.join(link, 'pkg', 'i.js'), 'utf8'), 'J');
});

test('runPrepare run calls runCommand in the worktree, honouring cwd', () => {
  const { repoRoot, worktreePath } = setup();
  const calls = [];
  const runCommand = (cmd, cwd) => calls.push([cmd, cwd]);
  runPrepare([{ run: 'one' }, { run: 'two', cwd: 'app' }], { repoRoot, worktreePath, runCommand });
  assert.deepEqual(calls, [['one', worktreePath], ['two', path.join(worktreePath, 'app')]]);
});

test('runPrepare names the source path when a copy source is missing', () => {
  const { repoRoot, worktreePath } = setup();
  assert.throws(
    () => runPrepare([{ copy: 'app/.env' }], { repoRoot, worktreePath }),
    (e) => e.message.includes(path.join(repoRoot, 'app', '.env')),
  );
});

test('runPrepare names the failing step when a command throws', () => {
  const { repoRoot, worktreePath } = setup();
  const runCommand = () => { throw new Error('boom'); };
  assert.throws(
    () => runPrepare([{ run: 'composer install' }], { repoRoot, worktreePath, runCommand }),
    (e) => e.message.includes('composer install') && e.message.includes('boom'),
  );
});

test('removeLinks deletes the junction but leaves the source intact', () => {
  const { repoRoot, worktreePath } = setup();
  write(path.join(repoRoot, 'app', 'node_modules', 'pkg', 'i.js'), 'J');
  const steps = [{ link: 'app/node_modules' }];
  runPrepare(steps, { repoRoot, worktreePath });
  const removed = removeLinks(steps, worktreePath);
  assert.deepEqual(removed, [path.join(worktreePath, 'app', 'node_modules')]);
  assert.equal(fs.existsSync(path.join(worktreePath, 'app', 'node_modules')), false);
  assert.equal(fs.readFileSync(path.join(repoRoot, 'app', 'node_modules', 'pkg', 'i.js'), 'utf8'), 'J');
});

test('removeLinks leaves a real directory at a link path untouched', () => {
  const { worktreePath } = setup();
  write(path.join(worktreePath, 'app', 'node_modules', 'keep.txt'), 'K');
  const removed = removeLinks([{ link: 'app/node_modules' }], worktreePath);
  assert.deepEqual(removed, []);
  assert.equal(fs.readFileSync(path.join(worktreePath, 'app', 'node_modules', 'keep.txt'), 'utf8'), 'K');
});

// --- final-review regressions ---
import { removeAllLinks } from '../src/prepare.js';

test('a link step whose source is a file fails instead of creating a broken junction', () => {
  const { repoRoot, worktreePath } = setup();
  write(path.join(repoRoot, '.env'), 'X');
  assert.throws(
    () => runPrepare([{ link: '.env' }], { repoRoot, worktreePath }),
    (e) => e.message.includes('dizin') && e.message.includes(path.join(repoRoot, '.env')),
  );
});

test('removeAllLinks unlinks every junction in the tree (listed or not), sparing targets and real directories', () => {
  const { repoRoot, worktreePath } = setup();
  write(path.join(repoRoot, 'shared', 'f.txt'), 'S');
  write(path.join(worktreePath, 'a', 'real', 'keep.txt'), 'K');
  fs.mkdirSync(path.join(worktreePath, 'a', 'b'), { recursive: true });
  fs.symlinkSync(path.join(repoRoot, 'shared'), path.join(worktreePath, 'a', 'b', 'jn'), 'junction');
  const removed = removeAllLinks(worktreePath);
  assert.deepEqual(removed, [path.join(worktreePath, 'a', 'b', 'jn')]);
  assert.equal(fs.existsSync(path.join(worktreePath, 'a', 'b', 'jn')), false);
  assert.equal(fs.readFileSync(path.join(repoRoot, 'shared', 'f.txt'), 'utf8'), 'S');
  assert.equal(fs.readFileSync(path.join(worktreePath, 'a', 'real', 'keep.txt'), 'utf8'), 'K');
});
