import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { addWorktree } from '../src/add.js';
import { removeWorktree } from '../src/remove.js';
import { makeRepo, git, write, fakeHerdr } from './helpers.js';

const config = { worktreeDir: '.worktrees', prepare: [{ copy: 'app/.env' }, { link: 'app/node_modules' }] };

// Repo whose prepared paths are gitignored (typical for app dependencies), with a main-checkout node_modules to protect.
function preparedRepo() {
  const repoRoot = makeRepo();
  write(path.join(repoRoot, '.gitignore'), 'app/.env\napp/node_modules\n');
  git(repoRoot, 'add', '.gitignore');
  git(repoRoot, 'commit', '-q', '-m', 'ignore');
  write(path.join(repoRoot, 'app', '.env'), 'SECRET=1');
  write(path.join(repoRoot, 'app', 'node_modules', 'pkg', 'i.js'), 'J');
  return repoRoot;
}

test('remove unlinks the junction, removes the worktree, and leaves the main node_modules intact', () => {
  const repoRoot = preparedRepo();
  const herdr = fakeHerdr();
  const added = addWorktree({ repoRoot, name: 'backend', herdr, config });
  assert.equal(added.ready, true);
  const r = removeWorktree({ repoRoot, name: 'backend', herdr, config });
  assert.deepEqual(r.removedLinks, [path.join(added.path, 'app', 'node_modules')]);
  assert.equal(fs.existsSync(added.path), false);
  // our own dirty check already passed, so the underlying removal is forced (tool-made, non-ignored files must not block it)
  assert.deepEqual(herdr.calls.remove, [{ workspaceId: 'w9', force: true }]);
  assert.equal(fs.readFileSync(path.join(repoRoot, 'app', 'node_modules', 'pkg', 'i.js'), 'utf8'), 'J');
});

test('remove refuses a dirty worktree without --force and changes nothing', () => {
  const repoRoot = preparedRepo();
  const herdr = fakeHerdr();
  const added = addWorktree({ repoRoot, name: 'backend', herdr, config });
  write(path.join(added.path, 'scratch.txt'), 'wip');
  assert.throws(() => removeWorktree({ repoRoot, name: 'backend', herdr, config }), /--force/);
  assert.equal(fs.existsSync(path.join(added.path, 'scratch.txt')), true);
  assert.equal(fs.lstatSync(path.join(added.path, 'app', 'node_modules')).isSymbolicLink(), true);
  assert.equal(herdr.calls.remove.length, 0);
});

test('remove with force removes a dirty worktree but still spares the main node_modules', () => {
  const repoRoot = preparedRepo();
  const herdr = fakeHerdr();
  const added = addWorktree({ repoRoot, name: 'backend', herdr, config });
  write(path.join(added.path, 'scratch.txt'), 'wip');
  removeWorktree({ repoRoot, name: 'backend', force: true, herdr, config });
  assert.equal(fs.existsSync(added.path), false);
  assert.deepEqual(herdr.calls.remove, [{ workspaceId: 'w9', force: true }]);
  assert.equal(fs.readFileSync(path.join(repoRoot, 'app', 'node_modules', 'pkg', 'i.js'), 'utf8'), 'J');
});

test('remove of an unknown name fails with a clear message', () => {
  const repoRoot = preparedRepo();
  assert.throws(() => removeWorktree({ repoRoot, name: 'ghost', herdr: fakeHerdr(), config }), /bulunamadı/);
});

test('remove validates the name before asking herdr anything', () => {
  const herdr = fakeHerdr();
  assert.throws(() => removeWorktree({ repoRoot: preparedRepo(), name: '../x', herdr, config }), /geçersiz ad/);
  assert.equal(herdr.calls.list.length, 0);
});

// --- final-review regressions ---

const copyOnly = { worktreeDir: '.worktrees', prepare: [{ copy: 'app/.env' }] };

test('CRITICAL: remove spares the main node_modules even when the junction is no longer listed in the config', () => {
  const repoRoot = preparedRepo();
  const herdr = fakeHerdr();
  addWorktree({ repoRoot, name: 'backend', herdr, config }); // created with the link step
  removeWorktree({ repoRoot, name: 'backend', herdr, config: copyOnly }); // config changed afterwards
  assert.equal(fs.readFileSync(path.join(repoRoot, 'app', 'node_modules', 'pkg', 'i.js'), 'utf8'), 'J');
});

test('CRITICAL: the no-open-workspace fallback (git worktree remove) also spares unlisted junction targets', () => {
  const repoRoot = preparedRepo();
  const herdr = fakeHerdr({ openWorkspace: false });
  const added = addWorktree({ repoRoot, name: 'backend', herdr, config });
  removeWorktree({ repoRoot, name: 'backend', herdr, config: copyOnly });
  assert.equal(herdr.calls.remove.length, 0); // really took the git fallback
  assert.equal(fs.existsSync(added.path), false);
  assert.equal(fs.readFileSync(path.join(repoRoot, 'app', 'node_modules', 'pkg', 'i.js'), 'utf8'), 'J');
});

test('remove succeeds when a copied (non-ignored) file is present, and leaves no half-dismantled worktree', () => {
  const repoRoot = preparedRepo();
  write(path.join(repoRoot, 'cfg.local'), 'local'); // copied but NOT gitignored
  const cfg = { worktreeDir: '.worktrees', prepare: [{ copy: 'cfg.local' }, { link: 'app/node_modules' }] };
  const herdr = fakeHerdr();
  const added = addWorktree({ repoRoot, name: 'backend', herdr, config: cfg });
  removeWorktree({ repoRoot, name: 'backend', herdr, config: cfg });
  assert.equal(fs.existsSync(added.path), false);
});

test('remove deletes the merged branch so the same name can be added again', () => {
  const repoRoot = preparedRepo();
  const herdr = fakeHerdr();
  addWorktree({ repoRoot, name: 'backend', herdr, config });
  const r = removeWorktree({ repoRoot, name: 'backend', herdr, config });
  assert.equal(r.branchDeleted, true);
  const again = addWorktree({ repoRoot, name: 'backend', herdr: fakeHerdr(), config });
  assert.equal(again.ready, true);
});

test('remove keeps a branch with unmerged commits and says so', () => {
  const repoRoot = preparedRepo();
  const herdr = fakeHerdr();
  const added = addWorktree({ repoRoot, name: 'backend', herdr, config });
  write(path.join(added.path, 'work.txt'), 'done');
  git(added.path, 'add', 'work.txt');
  git(added.path, 'commit', '-q', '-m', 'work');
  const r = removeWorktree({ repoRoot, name: 'backend', herdr, config });
  assert.equal(r.branchDeleted, false);
  assert.match(r.branchNote, /backend/);
  assert.match(git(repoRoot, 'branch', '--list', 'backend'), /backend/);
});

// A worker with one commit, and an `integration` branch that contains it (HEAD/main does not).
function workerMergedIntoIntegration() {
  const repoRoot = preparedRepo();
  const herdr = fakeHerdr();
  const added = addWorktree({ repoRoot, name: 'backend', herdr, config });
  write(path.join(added.path, 'work.txt'), 'done');
  git(added.path, 'add', 'work.txt');
  git(added.path, 'commit', '-q', '-m', 'work');
  git(repoRoot, 'branch', 'integration', 'backend');
  return { repoRoot, herdr };
}

test('remove --merged-into deletes the worker branch when it is merged into that branch, not into HEAD', () => {
  const { repoRoot, herdr } = workerMergedIntoIntegration();
  const r = removeWorktree({ repoRoot, name: 'backend', herdr, config, mergedInto: 'integration' });
  assert.equal(r.branchDeleted, true);
  assert.equal(git(repoRoot, 'branch', '--list', 'backend').trim(), '');
  assert.match(git(repoRoot, 'branch', '--list', 'integration'), /integration/);
});

test('remove --merged-into keeps the branch and notes it when it is not merged into the given branch', () => {
  const { repoRoot, herdr } = workerMergedIntoIntegration();
  git(repoRoot, 'branch', 'other', 'main');
  const r = removeWorktree({ repoRoot, name: 'backend', herdr, config, mergedInto: 'other' });
  assert.equal(r.branchDeleted, false);
  assert.match(r.branchNote, /backend/);
  assert.match(git(repoRoot, 'branch', '--list', 'backend'), /backend/);
});

test('remove --merged-into rejects an unknown branch before touching the worktree', () => {
  const { repoRoot, herdr } = workerMergedIntoIntegration();
  assert.throws(
    () => removeWorktree({ repoRoot, name: 'backend', herdr, config, mergedInto: 'nope' }),
    /branch bulunamadı: nope/,
  );
  assert.equal(fs.existsSync(path.join(repoRoot, '.worktrees', 'backend')), true);
  assert.equal(herdr.calls.remove.length, 0);
});

test('remove --merged-into the branch itself is refused: a branch is its own ancestor' , () => {
  const { repoRoot, herdr } = workerMergedIntoIntegration();
  assert.throws(() => removeWorktree({ repoRoot, name: 'backend', herdr, config, mergedInto: 'backend' }), /kendisine/);
  assert.equal(fs.existsSync(path.join(repoRoot, '.worktrees', 'backend')), true);
  assert.match(git(repoRoot, 'branch', '--list', 'backend'), /backend/);
});
