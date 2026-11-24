import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { addWorktree } from '../src/add.js';
import { sendTask, TEAM_DIR } from '../src/task.js';
import { waitForTasks } from '../src/wait.js';
import { makeRepo, write, fakeHerdr } from './helpers.js';

const config = { worktreeDir: '.worktrees', prepare: [] };

// Workers `names` in a real repo, fake herdr, and a fake clock (sleep advances time, nothing really waits).
function setup(names = ['a']) {
  const repoRoot = makeRepo();
  const herdr = fakeHerdr();
  for (const name of names) {
    addWorktree({ repoRoot, name, herdr, config });
    herdr.agents[name] = { status: 'idle', screen: '❯' };
  }
  const clock = { t: 0, sleeps: 0 };
  const deps = { now: () => clock.t, sleep: (ms) => { clock.t += ms; clock.sleeps++; } };
  const wait = (extra = {}) => waitForTasks({ repoRoot, config, names, herdr, ...deps, ...extra });
  const resultFile = (name) => path.join(repoRoot, '.worktrees', name, TEAM_DIR, 'result.md');
  return { repoRoot, herdr, clock, wait, resultFile };
}

test('reports done when result.md exists and the agent is idle', () => {
  const s = setup();
  write(s.resultFile('a'), 'bitti');
  const r = s.wait();
  assert.deepEqual(r.agents, [{ name: 'a', state: 'done' }]);
  assert.equal(r.exitCode, 0);
});

test('keeps waiting while the agent is working even if result.md already exists', () => {
  const s = setup();
  write(s.resultFile('a'), 'ara sonuç');
  s.herdr.agents.a.status = (i) => (i < 3 ? 'working' : 'idle');
  const r = s.wait();
  assert.equal(r.agents[0].state, 'done');
  assert.ok(s.clock.sleeps >= 3);
});

test('a stale result does not count: sendTask deletes it, so a working agent times out instead of done', () => {
  const s = setup();
  write(s.resultFile('a'), 'önceki tur');
  sendTask({ repoRoot: s.repoRoot, config, name: 'a', text: 'yeni', herdr: s.herdr, now: () => s.clock.t, sleep: () => {} });
  s.herdr.agents.a.status = 'working';
  const r = s.wait({ timeoutMs: 10000 });
  assert.equal(r.agents[0].state, 'timeout');
  assert.equal(r.exitCode, 4);
});

test('reports blocked immediately with the screen tail', () => {
  const s = setup();
  s.herdr.agents.a = { status: 'blocked', screen: 'Allow this tool?\n❯ 1. Yes' };
  const r = s.wait();
  assert.equal(r.agents[0].state, 'blocked');
  assert.ok(r.agents[0].detail.includes('Allow this tool?'));
  assert.equal(r.exitCode, 2);
  assert.equal(s.clock.sleeps, 0);
});

test('reports idle_without_result after idleMs of not working', () => {
  const s = setup();
  const r = s.wait();
  assert.equal(r.agents[0].state, 'idle_without_result');
  assert.ok(r.agents[0].detail.includes('❯'));
  assert.ok(s.clock.t >= 60000);
  assert.equal(r.exitCode, 2);
});

test('resets the idle clock when the agent works again', () => {
  const s = setup();
  s.herdr.agents.a.status = (i) => (i === 20 ? 'working' : 'idle');
  const r = s.wait({ timeoutMs: 85000 });
  assert.equal(r.agents[0].state, 'timeout');
  assert.equal(r.exitCode, 4);
});

test('times out with exit 4 when an agent keeps working', () => {
  const s = setup();
  s.herdr.agents.a.status = 'working';
  const r = s.wait({ timeoutMs: 20000 });
  assert.deepEqual(r.agents, [{ name: 'a', state: 'timeout', detail: 'hâlâ çalışıyor' }]);
  assert.equal(r.exitCode, 4);
  assert.ok(s.clock.t >= 20000);
});

test('returns early on a blocked agent while another is still working', () => {
  const s = setup(['a', 'b']);
  s.herdr.agents.a = { status: 'blocked', screen: 'Allow?' };
  s.herdr.agents.b.status = 'working';
  const r = s.wait();
  assert.deepEqual(r.agents.map((x) => [x.name, x.state]), [['a', 'blocked'], ['b', 'timeout']]);
  assert.equal(r.agents[1].detail, 'hâlâ çalışıyor');
  assert.equal(r.exitCode, 2);
  assert.equal(s.clock.sleeps, 0);
});

test('exit 0 only when every agent is done', () => {
  const s = setup(['a', 'b']);
  write(s.resultFile('a'), 'ok');
  s.herdr.agents.b.status = (i) => (i < 4 ? 'working' : 'idle');
  write(s.resultFile('b'), 'ok');
  const r = s.wait();
  assert.deepEqual(r.agents.map((x) => x.state), ['done', 'done']);
  assert.equal(r.exitCode, 0);
});

test('a finished agent keeps its done state while the others are still running', () => {
  const s = setup(['a', 'b']);
  write(s.resultFile('a'), 'ok');
  s.herdr.agents.b.status = 'working';
  const r = s.wait({ timeoutMs: 6000 });
  assert.deepEqual(r.agents.map((x) => x.state), ['done', 'timeout']);
  assert.equal(r.exitCode, 4);
});

test('propagates herdr errors instead of waiting or reporting done', () => {
  const s = setup();
  s.herdr.getAgent = () => { throw new Error('agent bulunamadı'); };
  assert.throws(() => s.wait(), /agent bulunamadı/);
});

test('rejects empty and duplicate names', () => {
  const s = setup();
  assert.throws(() => s.wait({ names: [] }), /en az bir ad/);
  assert.throws(() => s.wait({ names: ['a', 'a'] }), /tekrar/);
  assert.throws(() => s.wait({ names: ['../x'] }), /geçersiz ad/);
});
