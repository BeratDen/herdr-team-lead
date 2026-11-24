import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHerdr, HerdrError, pickOutput } from '../src/herdr.js';

const fixture = (name) => fs.readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8');

function fake(output) {
  const calls = [];
  const run = (args) => {
    calls.push(args);
    return output;
  };
  return { run, calls };
}

test('createWorktree passes the documented flags and returns path, workspace and pane ids', () => {
  const { run, calls } = fake(fixture('worktree-create'));
  const out = createHerdr(run).createWorktree({
    cwd: 'C:/tmp/repo', branch: 'smoke-a', base: 'main', path: 'C:/tmp/repo/.worktrees/smoke-a', label: 'smoke-a',
  });
  assert.deepEqual(calls[0], [
    'worktree', 'create', '--cwd', 'C:/tmp/repo', '--branch', 'smoke-a', '--base', 'main',
    '--path', 'C:/tmp/repo/.worktrees/smoke-a', '--label', 'smoke-a', '--no-focus',
  ]);
  assert.deepEqual(out, { path: 'C:\\tmp\\repo/.worktrees/smoke-a', workspaceId: 'w5', paneId: 'w5:p1' });
});

test('createWorktree omits --base when none is given', () => {
  const { run, calls } = fake(fixture('worktree-create'));
  createHerdr(run).createWorktree({ cwd: 'c', branch: 'b', path: 'p', label: 'l' });
  assert.equal(calls[0].includes('--base'), false);
});

test('herdr error JSON becomes a HerdrError carrying code and message', () => {
  const { run } = fake(fixture('worktree-create-error'));
  assert.throws(
    () => createHerdr(run).createWorktree({ cwd: 'c', branch: 'b', path: 'p', label: 'l' }),
    (e) => e instanceof HerdrError && e.code === 'worktree_create_failed' && e.message.includes('already exists'),
  );
});

test('non-JSON output becomes a HerdrError with code invalid_json', () => {
  const { run } = fake('Segmentation fault');
  assert.throws(
    () => createHerdr(run).listWorktrees({ cwd: 'c' }),
    (e) => e instanceof HerdrError && e.code === 'invalid_json',
  );
});

test('listWorktrees returns the worktree entries', () => {
  const { run, calls } = fake(fixture('worktree-list'));
  const list = createHerdr(run).listWorktrees({ cwd: 'C:/tmp/repo' });
  assert.deepEqual(calls[0], ['worktree', 'list', '--cwd', 'C:/tmp/repo']);
  assert.equal(list.length, 2);
  assert.equal(list[1].open_workspace_id, 'w5');
});

test('removeWorktree targets the workspace and passes --force only when asked', () => {
  const { run, calls } = fake(fixture('worktree-remove'));
  const herdr = createHerdr(run);
  herdr.removeWorktree({ workspaceId: 'w5' });
  herdr.removeWorktree({ workspaceId: 'w5', force: true });
  assert.deepEqual(calls[0], ['worktree', 'remove', '--workspace', 'w5']);
  assert.deepEqual(calls[1], ['worktree', 'remove', '--workspace', 'w5', '--force']);
});

test('startAgent passes name, kind and pane', () => {
  const { run, calls } = fake('{"id":"cli:agent:start","result":{"type":"ok"}}');
  createHerdr(run).startAgent({ name: 'backend', kind: 'codex', paneId: 'w5:p1' });
  assert.deepEqual(calls[0], ['agent', 'start', 'backend', '--kind', 'codex', '--pane', 'w5:p1']);
});

test('promptAgent passes the agent name and text to `herdr agent prompt`', () => {
  const { run, calls } = fake('{"id":"cli:agent:prompt","result":{"type":"ok"}}');
  createHerdr(run).promptAgent({ name: 'reviewer', text: 'Review the diff' });
  assert.deepEqual(calls[0], ['agent', 'prompt', 'reviewer', 'Review the diff']);
});

test('pickOutput prefers stdout, and falls back to stderr (herdr prints errors there)', () => {
  assert.equal(pickOutput({ stdout: '{"result":{}}\n', stderr: 'noise' }), '{"result":{}}\n');
  assert.equal(pickOutput({ stdout: '', stderr: '{"error":{"code":"agent_not_ready","message":"x"}}' }), '{"error":{"code":"agent_not_ready","message":"x"}}');
  assert.equal(pickOutput({ stdout: '  \n', stderr: 'boom' }), 'boom');
});

test('a JSON error that arrived on stderr becomes a HerdrError', () => {
  const { run } = fake(pickOutput({ stdout: '', stderr: '{"error":{"code":"agent_not_ready","message":"blocked during startup"}}' }));
  assert.throws(
    () => createHerdr(run).startAgent({ name: 'a', kind: 'claude', paneId: 'w1:p1' }),
    (e) => e instanceof HerdrError && e.code === 'agent_not_ready',
  );
});

test('getAgent passes the agent name and returns its status', () => {
  const { run, calls } = fake(fixture('agent-get'));
  const out = createHerdr(run).getAgent({ name: 'w5-a' });
  assert.deepEqual(calls[0], ['agent', 'get', 'w5-a']);
  assert.deepEqual(out, { status: 'idle' });
});

test('getAgent surfaces herdr errors as HerdrError', () => {
  const { run } = fake('{"error":{"code":"agent_not_found","message":"no such agent"}}');
  assert.throws(
    () => createHerdr(run).getAgent({ name: 'nope' }),
    (e) => e instanceof HerdrError && e.code === 'agent_not_found',
  );
});

test('readAgent asks for the visible screen and returns raw text', () => {
  const { run, calls } = fake('line one\n❯\n');
  const text = createHerdr(run).readAgent({ name: 'a', lines: 15 });
  assert.deepEqual(calls[0], ['agent', 'read', 'a', '--source', 'visible', '--lines', '15']);
  assert.equal(text, 'line one\n❯\n');
});

test('readAgent defaults to 20 lines', () => {
  const { run, calls } = fake('x');
  createHerdr(run).readAgent({ name: 'a' });
  assert.equal(calls[0].at(-1), '20');
});

test('readAgent turns a JSON error body into a HerdrError', () => {
  const { run } = fake('{"id":"cli:agent:read","error":{"code":"agent_not_found","message":"no such agent"}}');
  assert.throws(
    () => createHerdr(run).readAgent({ name: 'nope' }),
    (e) => e instanceof HerdrError && e.code === 'agent_not_found',
  );
});
