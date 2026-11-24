import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { addWorktree } from '../src/add.js';
import { makeRepo, git, write, fakeHerdr } from './helpers.js';

function repoWithEnv() {
  const repoRoot = makeRepo();
  write(path.join(repoRoot, 'app', '.env'), 'SECRET=1');
  return repoRoot;
}

const config = (extra = {}) => ({ worktreeDir: '.worktrees', prepare: [{ copy: 'app/.env' }], ...extra });

test('addWorktree creates a prepared worktree under worktreeDir and reports ready', () => {
  const repoRoot = repoWithEnv();
  const herdr = fakeHerdr();
  const r = addWorktree({ repoRoot, name: 'backend', herdr, config: config() });
  assert.equal(r.ready, true);
  assert.deepEqual(r.problems, []);
  assert.equal(r.branch, 'backend');
  assert.equal(r.path, path.join(repoRoot, '.worktrees', 'backend'));
  assert.equal(fs.readFileSync(path.join(r.path, 'app', '.env'), 'utf8'), 'SECRET=1');
  assert.equal(herdr.calls.create[0].branch, 'backend');
});

test('a failing prepare step reports not ready, names the step, and never starts the agent', () => {
  const repoRoot = makeRepo(); // no app/.env
  const herdr = fakeHerdr();
  const r = addWorktree({ repoRoot, name: 'backend', agent: 'codex', herdr, config: config() });
  assert.equal(r.ready, false);
  assert.ok(r.problems[0].includes(path.join(repoRoot, 'app', '.env')));
  assert.equal(herdr.calls.agent.length, 0);
});

test('a failing verify command reports not ready', () => {
  const repoRoot = repoWithEnv();
  const seen = [];
  const runCommand = (cmd, cwd) => {
    seen.push([cmd, cwd]);
    throw new Error('exit 1');
  };
  const r = addWorktree({ repoRoot, name: 'backend', herdr: fakeHerdr(), config: config({ verify: 'php artisan --version' }), runCommand });
  assert.equal(r.ready, false);
  assert.ok(r.problems.some((p) => p.includes('verify')));
  assert.deepEqual(seen, [['php artisan --version', path.join(repoRoot, '.worktrees', 'backend')]]);
});

test('an existing worktree path is refused before herdr or prepare run', () => {
  const repoRoot = repoWithEnv();
  fs.mkdirSync(path.join(repoRoot, '.worktrees', 'backend'), { recursive: true });
  const herdr = fakeHerdr();
  assert.throws(() => addWorktree({ repoRoot, name: 'backend', herdr, config: config() }), /zaten var/);
  assert.equal(herdr.calls.create.length, 0);
});

test('an existing branch is refused before herdr runs', () => {
  const repoRoot = repoWithEnv();
  git(repoRoot, 'branch', 'backend');
  const herdr = fakeHerdr();
  assert.throws(() => addWorktree({ repoRoot, name: 'backend', herdr, config: config() }), /branch.*zaten var/);
  assert.equal(herdr.calls.create.length, 0);
});

test('an invalid name is refused before anything happens', () => {
  const repoRoot = repoWithEnv();
  const herdr = fakeHerdr();
  assert.throws(() => addWorktree({ repoRoot, name: '../evil', herdr, config: config() }), /geçersiz ad/);
  assert.equal(herdr.calls.create.length, 0);
});

test('an unsupported agent kind is refused before anything happens', () => {
  const repoRoot = repoWithEnv();
  const herdr = fakeHerdr();
  assert.throws(() => addWorktree({ repoRoot, name: 'backend', agent: 'vim', herdr, config: config() }), /agent/);
  assert.equal(herdr.calls.create.length, 0);
});

test('with agent codex and a ready worktree the agent is started in the new pane', () => {
  const repoRoot = repoWithEnv();
  const herdr = fakeHerdr();
  const r = addWorktree({ repoRoot, name: 'reviewer', agent: 'codex', herdr, config: config() });
  assert.equal(r.ready, true);
  assert.deepEqual(herdr.calls.agent, [{ name: 'reviewer', kind: 'codex', paneId: 'w9:p1' }]);
});

// --- final-review regressions: initial prompt ---

test('with agent and prompt, the prompt is sent to the started agent', () => {
  const repoRoot = repoWithEnv();
  const herdr = fakeHerdr();
  const r = addWorktree({ repoRoot, name: 'reviewer', agent: 'codex', prompt: 'Review the diff', herdr, config: config() });
  assert.equal(r.ready, true);
  assert.deepEqual(herdr.calls.prompt, [{ name: 'reviewer', text: 'Review the diff' }]);
});

test('the prompt is not sent when the worktree is not ready', () => {
  const herdr = fakeHerdr();
  const r = addWorktree({ repoRoot: makeRepo(), name: 'reviewer', agent: 'codex', prompt: 'hi', herdr, config: config() });
  assert.equal(r.ready, false);
  assert.equal(herdr.calls.prompt.length, 0);
});

test('a prompt without an agent is refused before anything happens', () => {
  const herdr = fakeHerdr();
  assert.throws(() => addWorktree({ repoRoot: repoWithEnv(), name: 'x', prompt: 'hi', herdr, config: config() }), /--prompt/);
  assert.equal(herdr.calls.create.length, 0);
});

test('addWorktree excludes .team/ from git in the new worktree', () => {
  const repoRoot = repoWithEnv();
  const r = addWorktree({ repoRoot, name: 'backend', herdr: fakeHerdr(), config: config() });
  write(path.join(r.path, '.team', 'task.md'), 'x');
  assert.equal(git(r.path, 'status', '--porcelain', '--', '.', ':(exclude)app/.env').trim(), '');
});
