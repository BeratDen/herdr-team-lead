import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { addWorktree } from '../src/add.js';
import { mergeWorkers } from '../src/merge.js';
import { makeRepo, git, write, fakeHerdr } from './helpers.js';

// merge commits and auto-commits need an identity; do not depend on the machine's git config.
Object.assign(process.env, {
  GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.com',
});

const config = (extra = {}) => ({ worktreeDir: '.worktrees', prepare: [], ...extra });

function setup(cfg = config()) {
  const repoRoot = makeRepo();
  const herdr = fakeHerdr();
  const calls = [];
  const runCommand = (cmd, cwd) => { calls.push({ cmd, cwd }); };
  // A worker worktree; `files` are written, and committed unless `commit` is false.
  const addWorker = (name, files = {}, { commit = true } = {}) => {
    const r = addWorktree({ repoRoot, name, herdr, config: cfg });
    for (const [f, c] of Object.entries(files)) write(path.join(r.path, f), c);
    if (commit && Object.keys(files).length > 0) {
      git(r.path, 'add', '-A');
      git(r.path, 'commit', '-q', '-m', `${name} işi`);
    }
    return r.path;
  };
  const merge = (names, extra = {}) => mergeWorkers({ repoRoot, config: cfg, names, into: 'int', herdr, runCommand, ...extra });
  const intPath = path.join(repoRoot, '.worktrees', 'int');
  return { repoRoot, herdr, calls, addWorker, merge, intPath, cfg };
}

test('merges two workers into a new integration branch with --no-ff and leaves the main checkout alone', () => {
  const s = setup();
  s.addWorker('a', { 'a.txt': 'A' });
  s.addWorker('b', { 'b.txt': 'B' });
  const mainBefore = git(s.repoRoot, 'rev-parse', 'main').trim();
  const r = s.merge(['a', 'b']);
  assert.equal(r.status, 'merged');
  assert.deepEqual(r.merged, ['a', 'b']);
  assert.equal(r.integrationPath, s.intPath);
  assert.equal(fs.readFileSync(path.join(s.intPath, 'a.txt'), 'utf8'), 'A');
  assert.equal(fs.readFileSync(path.join(s.intPath, 'b.txt'), 'utf8'), 'B');
  assert.equal(git(s.intPath, 'rev-list', '--merges', '--count', 'HEAD').trim(), '2');
  assert.equal(git(s.repoRoot, 'rev-parse', 'main').trim(), mainBefore);
  assert.equal(fs.existsSync(path.join(s.repoRoot, 'a.txt')), false);
});

test('creates the integration worktree from --base', () => {
  const s = setup();
  s.addWorker('a', { 'a.txt': 'A' });
  s.merge(['a'], { base: 'main' });
  const created = s.herdr.calls.create.at(-1);
  assert.equal(created.branch, 'int');
  assert.equal(created.base, 'main');
});

test("commits a worker's uncommitted work on its behalf and lists the files", () => {
  const s = setup();
  const dir = s.addWorker('c', { 'dir/c1.txt': '1', 'c2.txt': '2' }, { commit: false });
  const r = s.merge(['c']);
  assert.deepEqual(r.committed, [{ name: 'c', files: ['c2.txt', 'dir/c1.txt'] }]);
  assert.match(git(dir, 'log', '-1', '--format=%s'), /^team: c işi \(otomatik commit\)/);
  assert.equal(fs.existsSync(path.join(s.intPath, 'dir', 'c1.txt')), true);
  assert.deepEqual(r.merged, ['c']);
});

test('does not auto-commit copied prepare paths or .team/', () => {
  const cfg = config({ prepare: [{ copy: 'vendor' }] });
  const s = setup(cfg);
  write(path.join(s.repoRoot, 'vendor', 'x.php'), 'lib'); // untracked in the main checkout, copied into workers
  const dir = s.addWorker('w', { 'w.txt': 'W' }, { commit: false });
  write(path.join(dir, '.team', 'task.md'), 'görev');
  const r = s.merge(['w']);
  assert.deepEqual(r.committed, [{ name: 'w', files: ['w.txt'] }]);
  // the integration worktree gets its own prepared copy of vendor/, but nothing of it (or .team/) is committed
  assert.equal(git(s.intPath, 'ls-files', 'vendor', '.team').trim(), '');
  assert.equal(git(dir, 'ls-files', 'vendor', '.team').trim(), '');
});

test('skips a worker with no commits and says why', () => {
  const s = setup();
  s.addWorker('idle');
  s.addWorker('a', { 'a.txt': 'A' });
  const r = s.merge(['idle', 'a']);
  assert.deepEqual(r.merged, ['a']);
  assert.equal(r.skipped.length, 1);
  assert.equal(r.skipped[0].name, 'idle');
  assert.match(r.skipped[0].reason, /yeni commit yok/);
});

function conflictSetup() {
  const s = setup();
  s.addWorker('a', { 'README.md': 'A\n' });
  s.addWorker('b', { 'README.md': 'B\n' });
  s.addWorker('c', { 'c.txt': 'C' });
  return s;
}

test('reports a conflict, lists the files, leaves the worktree in conflict and stops', () => {
  const s = conflictSetup();
  const r = s.merge(['a', 'b', 'c']);
  assert.equal(r.status, 'conflict');
  assert.deepEqual(r.conflicts, ['README.md']);
  assert.equal(r.conflictWorker, 'b');
  assert.deepEqual(r.merged, ['a']);
  assert.notEqual(git(s.intPath, 'rev-parse', '-q', '--verify', 'MERGE_HEAD').trim(), '');
  assert.equal(fs.existsSync(path.join(s.intPath, 'c.txt')), false);
  assert.equal(s.calls.length, 0); // tests do not run over a conflict
});

test('rerun after the lead resolved the conflict skips merged workers and merges the rest', () => {
  const s = conflictSetup();
  s.merge(['a', 'b', 'c']);
  write(path.join(s.intPath, 'README.md'), 'A+B\n');
  git(s.intPath, 'add', 'README.md');
  git(s.intPath, 'commit', '-q', '-m', 'çözüm');
  const r = s.merge(['a', 'b', 'c']);
  assert.equal(r.status, 'merged');
  assert.deepEqual(r.merged, ['c']);
  assert.deepEqual(r.skipped.map((x) => x.name), ['a', 'b']);
  assert.equal(fs.readFileSync(path.join(s.intPath, 'README.md'), 'utf8'), 'A+B\n');
  assert.equal(fs.existsSync(path.join(s.intPath, 'c.txt')), true);
});

test('refuses to continue while an unresolved merge is in progress', () => {
  const s = conflictSetup();
  s.merge(['a', 'b', 'c']);
  assert.throws(() => s.merge(['a', 'b', 'c']), /çözülmemiş birleştirme/);
});

test('runs config.test in the integration worktree after merging', () => {
  const s = setup(config({ test: 'npm test' }));
  s.addWorker('a', { 'a.txt': 'A' });
  const r = s.merge(['a']);
  assert.equal(r.status, 'merged');
  assert.deepEqual(s.calls, [{ cmd: 'npm test', cwd: s.intPath }]);
});

test('a failing test command gives tests_failed with the merges in place, and a rerun adds no merge commits', () => {
  const s = setup(config({ test: 'npm test' }));
  s.addWorker('a', { 'a.txt': 'A' });
  const failing = () => { throw new Error('2 test başarısız'); };
  const r = s.merge(['a'], { runCommand: failing });
  assert.equal(r.status, 'tests_failed');
  assert.match(r.testError, /2 test başarısız/);
  assert.deepEqual(r.merged, ['a']);
  const again = s.merge(['a'], { runCommand: failing });
  assert.equal(again.status, 'tests_failed');
  assert.deepEqual(again.merged, []);
  assert.equal(git(s.intPath, 'rev-list', '--merges', '--count', 'HEAD').trim(), '1');
});

test('no test key means no test run', () => {
  const s = setup();
  s.addWorker('a', { 'a.txt': 'A' });
  s.merge(['a']);
  assert.equal(s.calls.length, 0);
});

test('rejects an unknown worker branch before changing anything', () => {
  const s = setup();
  s.addWorker('a', { 'a.txt': 'A' });
  const created = s.herdr.calls.create.length;
  assert.throws(() => s.merge(['a', 'ghost']), /branch bulunamadı: ghost/);
  assert.equal(s.herdr.calls.create.length, created);
  assert.equal(fs.existsSync(s.intPath), false);
});

test('rejects an integration name equal to a worker name, and invalid or duplicate names', () => {
  const s = setup();
  s.addWorker('a', { 'a.txt': 'A' });
  assert.throws(() => s.merge(['a'], { into: 'a' }), /işçi adıyla aynı/);
  assert.throws(() => s.merge(['a'], { into: '../x' }), /geçersiz ad/);
  assert.throws(() => s.merge(['a', 'a']), /tekrar/);
  assert.throws(() => s.merge([]), /en az bir ad/);
});

test('rejects an existing integration directory that is on another branch', () => {
  const s = setup();
  s.addWorker('a', { 'a.txt': 'A' });
  const dir = addWorktree({ repoRoot: s.repoRoot, name: 'int', herdr: s.herdr, config: s.cfg }).path;
  git(dir, 'checkout', '-q', '-b', 'other');
  assert.throws(() => s.merge(['a']), /int branch'inde değil \(şu an: other\)/);
});

test('refuses to auto-commit a worker that switched to another branch, and commits nothing', () => {
  const s = setup();
  const dir = s.addWorker('a', { 'a.txt': 'A' });
  git(dir, 'checkout', '-q', '-b', 'other');
  write(path.join(dir, 'late.txt'), 'late');
  assert.throws(() => s.merge(['a']), /a branch'inde değil \(şu an: other\)/);
  assert.equal(git(dir, 'status', '--porcelain').trim(), '?? late.txt');
  assert.equal(fs.existsSync(s.intPath), false);
});

test('refuses to auto-commit a worker on a detached HEAD', () => {
  const s = setup();
  const dir = s.addWorker('a', { 'a.txt': 'A' });
  git(dir, 'checkout', '-q', '--detach');
  write(path.join(dir, 'late.txt'), 'late');
  assert.throws(() => s.merge(['a']), /detached/);
  assert.equal(git(dir, 'status', '--porcelain').trim(), '?? late.txt');
});

test("a plain leftover directory where a worktree should be never makes git act on the user's checkout", () => {
  const s = setup();
  git(s.repoRoot, 'branch', 'ghost'); // the branch survives, the worktree is gone, the directory is a plain leftover
  write(path.join(s.repoRoot, '.worktrees', 'ghost', 'leftover.txt'), 'x');
  write(path.join(s.repoRoot, 'staged-by-user.txt'), 'mine');
  git(s.repoRoot, 'add', 'staged-by-user.txt');
  const head = git(s.repoRoot, 'rev-parse', 'HEAD').trim();
  assert.throws(() => s.merge(['ghost']), /git worktree'si değil/);
  assert.equal(git(s.repoRoot, 'rev-parse', 'HEAD').trim(), head);
  assert.match(git(s.repoRoot, 'status', '--porcelain'), /^A\s+staged-by-user\.txt/m);
  assert.equal(fs.existsSync(s.intPath), false);
});

test('a plain directory at the integration path is refused as not a worktree', () => {
  const s = setup();
  s.addWorker('a', { 'a.txt': 'A' });
  write(path.join(s.intPath, 'leftover.txt'), 'x');
  assert.throws(() => s.merge(['a']), /git worktree'si değil/);
});
