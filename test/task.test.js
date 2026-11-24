import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { addWorktree } from '../src/add.js';
import { isReady, sendTask, readResult, ensureTeamExcluded, TEAM_DIR } from '../src/task.js';
import { makeRepo, write, git, fakeHerdr } from './helpers.js';

const config = { worktreeDir: '.worktrees', prepare: [] };
const READY = '─────\n❯\n─────';

// A worker worktree plus a fake herdr whose agent `a` sits at a prompt.
function setup({ screen = READY, status = 'idle' } = {}) {
  const repoRoot = makeRepo();
  const herdr = fakeHerdr();
  addWorktree({ repoRoot, name: 'a', herdr, config });
  herdr.agents.a = { status, screen };
  const clock = { t: 0, sleeps: 0 };
  const deps = { now: () => clock.t, sleep: (ms) => { clock.t += ms; clock.sleeps++; } };
  const send = (extra = {}) => sendTask({ repoRoot, config, name: 'a', text: 'do it', herdr, ...deps, ...extra });
  return { repoRoot, herdr, clock, send, dir: path.join(repoRoot, '.worktrees', 'a') };
}

test('isReady accepts a Claude prompt line', () => {
  assert.equal(isReady('─\n❯\n─').ready, true);
});

test('isReady accepts a Codex prompt line', () => {
  assert.equal(isReady('some output\n› ').ready, true);
});

test('isReady rejects an approval menu even though it contains a ❯ line', () => {
  const r = isReady('Do you want to proceed?\n❯ 1. Yes\n  2. No');
  assert.equal(r.ready, false);
  assert.match(r.reason, /onay/);
});

for (const screen of ['Enter to confirm · Esc to cancel\n❯', 'Overwrite? (y/n)\n❯']) {
  test(`isReady rejects an approval pattern: ${JSON.stringify(screen)}`, () => {
    assert.equal(isReady(screen).ready, false);
  });
}

const fixtureScreen = (name) => fs.readFileSync(new URL(`./fixtures/${name}.txt`, import.meta.url), 'utf8');

test('real screens captured from herdr: idle prompts are ready, first-run dialogs are not', () => {
  assert.equal(isReady(fixtureScreen('screen-claude-idle')).ready, true);
  assert.equal(isReady(fixtureScreen('screen-codex-idle')).ready, true);
  assert.equal(isReady(fixtureScreen('screen-claude-trust')).ready, false);
  assert.equal(isReady(fixtureScreen('screen-codex-update')).ready, false);
});

// A menu must never count as ready, even when an earlier echoed "❯ text" line (the previous task) is on screen.
for (const screen of [
  '❯ Yeni görev: .team/task.md dosyasını oku ve yap.\n\n Would you like to proceed?\n ❯ 1. Yes\n   2. No',
  '› Yeni görev: ...\n\n  Update available!\n› 1. Update now\n  2. Skip\n  Press enter to continue',
  'Proceed?\n❯  1. Yes\n   2. No',
  'Continue?\n❯ 1) Yes\n  2) No',
  '❯ eski mesaj\n\nSelect model\n❯ Default (recommended)\n  Opus\n\nEnter to confirm',
]) {
  test(`isReady rejects a menu screen: ${JSON.stringify(screen.slice(0, 40))}`, () => {
    assert.equal(isReady(screen).ready, false);
  });
}

test('isReady does not treat ordinary agent prose as a dialog', () => {
  assert.equal(isReady('● Bitti. Do you want me to also update the tests?\n───\n❯ \n───').ready, true);
  assert.equal(isReady('● I updated the trust store config.\n───\n❯ \n───').ready, true);
});

test('isReady rejects a numbered menu line even without a known approval phrase', () => {
  assert.equal(isReady('Pick one\n❯ 1. Alpha\n  2. Beta').ready, false);
});

test('isReady rejects a screen with no prompt line', () => {
  const r = isReady('thinking...\nrunning tool');
  assert.equal(r.ready, false);
  assert.match(r.reason, /giriş satırı/);
});

test('sendTask writes .team/task.md from --text and prompts the agent once', () => {
  const s = setup();
  const r = s.send({ text: 'Yeni görev\nikinci satır' });
  assert.equal(fs.readFileSync(path.join(s.dir, TEAM_DIR, 'task.md'), 'utf8'), 'Yeni görev\nikinci satır');
  assert.equal(r.taskPath, path.join(s.dir, TEAM_DIR, 'task.md'));
  assert.equal(s.herdr.calls.prompt.length, 1);
  const { name, text } = s.herdr.calls.prompt[0];
  assert.equal(name, 'a');
  assert.ok(text.includes('.team/task.md') && text.includes('.team/result.md'));
  assert.equal(/[\n\\]/.test(text), false);
});

test('sendTask reads the task from --file', () => {
  const s = setup();
  const file = path.join(s.repoRoot, 'brief.md');
  write(file, 'from file');
  s.send({ text: undefined, file });
  assert.equal(fs.readFileSync(path.join(s.dir, TEAM_DIR, 'task.md'), 'utf8'), 'from file');
});

test('sendTask deletes a stale result.md', () => {
  const s = setup();
  write(path.join(s.dir, TEAM_DIR, 'result.md'), 'old round');
  s.send();
  assert.equal(fs.existsSync(path.join(s.dir, TEAM_DIR, 'result.md')), false);
});

test('sendTask refuses when both or neither of file/text are given', () => {
  const s = setup();
  assert.throws(() => s.send({ text: undefined }), /--file veya --text/);
  assert.throws(() => s.send({ file: 'x.md' }), /--file veya --text/);
  assert.equal(s.herdr.calls.prompt.length, 0);
});

test('sendTask refuses a working agent unless forced', () => {
  const s = setup({ status: 'working' });
  assert.throws(() => s.send(), /çalışıyor/);
  assert.equal(s.herdr.calls.prompt.length, 0);
  s.send({ force: true });
  assert.equal(s.herdr.calls.prompt.length, 1);
});

test('--force never types into an approval screen, even when herdr says idle', () => {
  const s = setup({ status: 'idle', screen: 'Do you want to proceed?\n❯ 1. Yes\n  2. No' });
  assert.throws(() => s.send({ force: true }), /onay/);
  assert.equal(s.herdr.calls.prompt.length, 0);
});

test('an agent that ended its turn with a question is ready for the next task', () => {
  const s = setup({ status: 'idle', screen: '● Bitti. Do you want me to also update the tests?\n───\n❯ \n───' });
  s.send();
  assert.equal(s.herdr.calls.prompt.length, 1);
});

test('sendTask always refuses a blocked agent and includes the screen tail', () => {
  const s = setup({ status: 'blocked', screen: 'Allow this tool?\n❯ 1. Yes' });
  for (const force of [false, true]) {
    assert.throws(() => s.send({ force }), (e) => /bloke/.test(e.message) && e.message.includes('Allow this tool?'));
  }
  assert.equal(s.herdr.calls.prompt.length, 0);
});

test('sendTask waits for the agent to become ready then sends', () => {
  const s = setup();
  s.herdr.agents.a.screen = (i) => (i === 0 ? 'starting...' : i === 1 ? 'Do you trust this folder?\n❯ 1. Yes' : READY);
  s.send();
  assert.ok(s.clock.sleeps >= 2);
  assert.equal(s.herdr.calls.prompt.length, 1);
});

test('sendTask gives up after readyTimeoutMs without prompting and shows the screen', () => {
  const s = setup({ screen: 'Enter to confirm\n❯ 1. Yes' });
  assert.throws(() => s.send({ readyTimeoutMs: 6000 }), (e) => /hazır değil/.test(e.message) && e.message.includes('Enter to confirm'));
  assert.equal(s.herdr.calls.prompt.length, 0);
  assert.ok(s.clock.t >= 6000);
});

test('sendTask refuses a worker whose worktree does not exist', () => {
  const s = setup();
  assert.throws(() => sendTask({ repoRoot: s.repoRoot, config, name: 'ghost', text: 'x', herdr: s.herdr }), /worktree bulunamadı: ghost/);
});

test('sendTask rejects an invalid worker name', () => {
  const s = setup();
  assert.throws(() => s.send({ name: '../x' }), /geçersiz ad/);
});

test('ensureTeamExcluded appends .team/ once', () => {
  const repoRoot = makeRepo();
  assert.equal(ensureTeamExcluded(repoRoot), true);
  assert.equal(ensureTeamExcluded(repoRoot), false);
  const excludeFile = path.join(repoRoot, '.git', 'info', 'exclude');
  assert.equal(fs.readFileSync(excludeFile, 'utf8').split(/\r?\n/).filter((l) => l === '.team/').length, 1);
});

test('readResult returns the file content', () => {
  const s = setup();
  write(path.join(s.dir, TEAM_DIR, 'result.md'), 'yapıldı');
  assert.equal(readResult({ repoRoot: s.repoRoot, config, name: 'a' }), 'yapıldı');
});

test('readResult explains a missing result', () => {
  const s = setup();
  assert.throws(() => readResult({ repoRoot: s.repoRoot, config, name: 'a' }), /sonuç yok/);
});

test('git ignores .team/ in a worker after sendTask', () => {
  const s = setup();
  s.send();
  assert.equal(git(s.dir, 'status', '--porcelain').trim(), '');
});
