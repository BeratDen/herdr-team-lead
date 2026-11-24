import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { main } from '../src/cli.js';
import { makeRepo, makeTmp, write, git, fakeHerdr } from './helpers.js';

// skillsDir is always a temp directory: no test may ever write to the real ~/.claude/skills.
function run(argv, { repoRoot = makeRepo(), config, herdr = fakeHerdr(), runCommand, skillsDir = makeTmp('ht-skills-') } = {}) {
  if (config) write(path.join(repoRoot, '.herdr-team.json'), JSON.stringify(config));
  const out = [];
  const err = [];
  const clock = { t: 0 }; // a fake clock: nothing in the CLI tests really sleeps
  const code = main(argv, {
    cwd: repoRoot, herdr, out: (s) => out.push(s), err: (s) => err.push(s),
    now: () => clock.t, sleep: (ms) => { clock.t += ms; }, runCommand, skillsDir,
  });
  return { code, out: out.join('\n'), err: err.join('\n'), repoRoot, herdr, clock, skillsDir };
}

test('an unknown subcommand exits 1 and prints usage', () => {
  const r = run(['frobnicate']);
  assert.equal(r.code, 1);
  assert.match(r.err, /kullanım/);
});

test('add with an invalid name exits 1 and creates nothing', () => {
  const r = run(['worktree', 'add', '../evil']);
  assert.equal(r.code, 1);
  assert.match(r.err, /geçersiz ad/);
  assert.equal(r.herdr.calls.create.length, 0);
  assert.equal(fs.existsSync(path.join(r.repoRoot, '.worktrees')), false);
});

test('add with a failing prepare step exits 1 and says it is not ready', () => {
  const r = run(['worktree', 'add', 'backend'], { config: { prepare: [{ copy: 'app/.env' }] } });
  assert.equal(r.code, 1);
  assert.match(r.err, /HAZIR DEĞİL/);
  assert.ok(r.err.includes(path.join(r.repoRoot, 'app', '.env')));
  assert.ok(r.err.includes(path.join(r.repoRoot, '.worktrees', 'backend')));
});

test('add succeeds, prints the path, and starts the requested agent', () => {
  const r = run(['worktree', 'add', 'reviewer', '--base', 'main', '--agent', 'codex']);
  assert.equal(r.code, 0);
  assert.ok(r.out.includes(path.join(r.repoRoot, '.worktrees', 'reviewer')));
  assert.equal(r.herdr.calls.create[0].base, 'main');
  assert.equal(r.herdr.calls.agent[0].kind, 'codex');
});

function workerRepo() {
  const herdr = fakeHerdr();
  const repoRoot = makeRepo();
  assert.equal(run(['worktree', 'add', 'a'], { repoRoot, herdr }).code, 0);
  herdr.agents.a = { status: 'idle', screen: '❯' };
  return { herdr, repoRoot };
}

test('task send writes the task and prompts the agent', () => {
  const { herdr, repoRoot } = workerRepo();
  const r = run(['task', 'send', 'a', '--text', 'yap'], { repoRoot, herdr });
  assert.equal(r.code, 0);
  assert.equal(fs.readFileSync(path.join(repoRoot, '.worktrees', 'a', '.team', 'task.md'), 'utf8'), 'yap');
  assert.equal(herdr.calls.prompt.length, 1);
});

test('task send reads --file relative to the working directory', () => {
  const { herdr, repoRoot } = workerRepo();
  write(path.join(repoRoot, 'brief.md'), 'dosyadan');
  const r = run(['task', 'send', 'a', '--file', 'brief.md'], { repoRoot, herdr });
  assert.equal(r.code, 0);
  assert.equal(fs.readFileSync(path.join(repoRoot, '.worktrees', 'a', '.team', 'task.md'), 'utf8'), 'dosyadan');
});

test('task send without file or text exits 1', () => {
  const { herdr, repoRoot } = workerRepo();
  const r = run(['task', 'send', 'a'], { repoRoot, herdr });
  assert.equal(r.code, 1);
  assert.match(r.err, /--file veya --text/);
});

test('task result prints the result, and exits 1 when there is none', () => {
  const { herdr, repoRoot } = workerRepo();
  assert.equal(run(['task', 'result', 'a'], { repoRoot, herdr }).code, 1);
  write(path.join(repoRoot, '.worktrees', 'a', '.team', 'result.md'), 'bitti');
  const r = run(['task', 'result', 'a'], { repoRoot, herdr });
  assert.equal(r.code, 0);
  assert.equal(r.out, 'bitti');
});

test('task wait prints one line per agent with indented detail, exit 0 when all done', () => {
  const { herdr, repoRoot } = workerRepo();
  write(path.join(repoRoot, '.worktrees', 'a', '.team', 'result.md'), 'ok');
  const r = run(['task', 'wait', 'a'], { repoRoot, herdr });
  assert.equal(r.code, 0);
  assert.equal(r.out, 'a: done');
});

test('task wait exits 2 for a blocked agent and prints the screen indented', () => {
  const { herdr, repoRoot } = workerRepo();
  herdr.agents.a = { status: 'blocked', screen: 'Allow?\nline2' };
  const r = run(['task', 'wait', 'a'], { repoRoot, herdr });
  assert.equal(r.code, 2);
  assert.equal(r.out, 'a: blocked\n  Allow?\n  line2');
});

test('task wait exits 4 on timeout and converts --timeout seconds to milliseconds', () => {
  const { herdr, repoRoot } = workerRepo();
  herdr.agents.a.status = 'working';
  const r = run(['task', 'wait', 'a', '--timeout', '5'], { repoRoot, herdr });
  assert.equal(r.code, 4);
  assert.equal(r.out, 'a: timeout\n  hâlâ çalışıyor');
  assert.ok(r.clock.t >= 5000 && r.clock.t < 9000);
});

test('task wait rejects a non-positive or non-numeric --timeout', () => {
  const { herdr, repoRoot } = workerRepo();
  for (const bad of ['abc', '0', '-3']) {
    const r = run(['task', 'wait', 'a', '--timeout', bad], { repoRoot, herdr });
    assert.equal(r.code, 1);
    assert.match(r.err, /--timeout/);
  }
});

test('task wait without a name exits 1', () => {
  const r = run(['task', 'wait']);
  assert.equal(r.code, 1);
  assert.match(r.err, /en az bir ad/);
});

test('worktree remove --merged-into passes the integration branch through', () => {
  const { herdr, repoRoot } = workerRepo();
  const dir = path.join(repoRoot, '.worktrees', 'a');
  write(path.join(dir, 'work.txt'), 'x');
  git(dir, 'add', 'work.txt');
  git(dir, 'commit', '-q', '-m', 'work');
  git(repoRoot, 'branch', 'int', 'a');
  const r = run(['worktree', 'remove', 'a', '--merged-into', 'int'], { repoRoot, herdr });
  assert.equal(r.code, 0);
  assert.equal(git(repoRoot, 'branch', '--list', 'a').trim(), '');
});

// Workers a and b, each with a committed change to `file` (different files unless told otherwise).
function mergeRepo({ fileA = 'a.txt', fileB = 'b.txt', config } = {}) {
  const herdr = fakeHerdr();
  const repoRoot = makeRepo();
  if (config) write(path.join(repoRoot, '.herdr-team.json'), JSON.stringify(config));
  for (const [name, file] of [['a', fileA], ['b', fileB]]) {
    assert.equal(run(['worktree', 'add', name], { repoRoot, herdr }).code, 0);
    const dir = path.join(repoRoot, '.worktrees', name);
    write(path.join(dir, file), name.toUpperCase());
    git(dir, 'add', '-A');
    git(dir, '-c', 'user.name=t', '-c', 'user.email=t@e.x', 'commit', '-q', '-m', name);
  }
  return { herdr, repoRoot };
}

test('team merge prints the integration path and the merged workers, exit 0', () => {
  const { herdr, repoRoot } = mergeRepo();
  const r = run(['merge', 'a', 'b', '--into', 'int'], { repoRoot, herdr });
  assert.equal(r.code, 0);
  assert.ok(r.out.includes(path.join(repoRoot, '.worktrees', 'int')));
  assert.match(r.out, /birleşti: a, b/);
});

test('team merge exits 3 on a conflict, naming the files and how to continue', () => {
  const { herdr, repoRoot } = mergeRepo({ fileA: 'README.md', fileB: 'README.md' });
  const r = run(['merge', 'a', 'b', '--into', 'int'], { repoRoot, herdr });
  assert.equal(r.code, 3);
  assert.match(r.out, /ÇAKIŞMA \(b\)/);
  assert.match(r.out, /README\.md/);
  assert.match(r.out, /aynı komutu yeniden çalıştır/);
});

test('team merge exits 5 when the merge worked but the tests failed', () => {
  const { herdr, repoRoot } = mergeRepo({ config: { test: 'npm test' } });
  const runCommand = () => { throw new Error('kırmızı'); };
  const r = run(['merge', 'a', 'b', '--into', 'int'], { repoRoot, herdr, runCommand });
  assert.equal(r.code, 5);
  assert.match(r.out, /birleşti: a, b/);
  assert.match(r.out, /TEST BAŞARISIZ.*kırmızı/);
});

test('team merge without --into exits 1', () => {
  const r = run(['merge', 'a']);
  assert.equal(r.code, 1);
  assert.match(r.err, /--into/);
});

test('skill install copies the lead skill into skillsDir and prints where, even outside a git repo', () => {
  const skillsDir = makeTmp('ht-skills-');
  const out = [];
  const code = main(['skill', 'install'], { cwd: makeTmp('ht-nogit-'), out: (s) => out.push(s), err: () => {}, skillsDir });
  assert.equal(code, 0);
  assert.equal(fs.existsSync(path.join(skillsDir, 'herdr-team-lead', 'SKILL.md')), true);
  assert.ok(out.join('\n').includes(path.join(skillsDir, 'herdr-team-lead')));
});

test('no other command writes to skillsDir', () => {
  const skillsDir = makeTmp('ht-skills-');
  run(['worktree', 'add', 'x'], { skillsDir });
  assert.deepEqual(fs.readdirSync(skillsDir), []);
});

test('an unknown task action prints usage and exits 1', () => {
  const r = run(['task', 'frobnicate']);
  assert.equal(r.code, 1);
  assert.match(r.err, /kullanım/);
});

test('remove --force passes force through', () => {
  const herdr = fakeHerdr();
  const repoRoot = makeRepo();
  assert.equal(run(['worktree', 'add', 'backend'], { repoRoot, herdr }).code, 0);
  write(path.join(repoRoot, '.worktrees', 'backend', 'scratch.txt'), 'wip');
  const refused = run(['worktree', 'remove', 'backend'], { repoRoot, herdr });
  assert.equal(refused.code, 1);
  assert.match(refused.err, /--force/);
  const forced = run(['worktree', 'remove', 'backend', '--force'], { repoRoot, herdr });
  assert.equal(forced.code, 0);
  assert.deepEqual(herdr.calls.remove, [{ workspaceId: 'w9', force: true }]);
});

test('the real binary exits 1 with usage when given no arguments', () => {
  const r = spawnSync(process.execPath, [new URL('../src/cli.js', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /kullanım/);
});

test('add --agent codex --prompt forwards the prompt', () => {
  const r = run(['worktree', 'add', 'reviewer', '--agent', 'codex', '--prompt', 'Review the diff']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.herdr.calls.prompt, [{ name: 'reviewer', text: 'Review the diff' }]);
});

test('the binary still runs when invoked through a link to the repo (npm link / global shim)', () => {
  const linkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ht-link-'));
  const link = path.join(linkDir, 'herdr-team');
  fs.symlinkSync(path.resolve(import.meta.dirname, '..'), link, 'junction');
  const r = spawnSync(process.execPath, [path.join(link, 'src', 'cli.js')], { encoding: 'utf8' });
  fs.unlinkSync(link);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /kullanım/);
});
