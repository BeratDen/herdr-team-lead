import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function makeTmp(prefix = 'ht-') {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

export function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// Temp git repo on branch `main` with one commit.
export function makeRepo() {
  const dir = makeTmp('ht-repo-');
  git(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'README.md'), 'hello\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

// Fake herdr that performs real `git worktree add|remove|list`, mirroring the real CLI's shapes.
export function fakeHerdr({ openWorkspace = true } = {}) {
  const calls = { create: [], agent: [], prompt: [], list: [], remove: [], get: [], read: [] };
  let repo;
  const paths = {};
  // agents[name] = { status, screen }; status may be a string or (getCallIndex) => string.
  const agents = {};
  return {
    calls,
    agents,
    getAgent({ name }) {
      const a = agents[name] ?? {};
      const status = typeof a.status === 'function' ? a.status(calls.get.length) : (a.status ?? 'idle');
      calls.get.push({ name });
      return { status };
    },
    readAgent({ name, lines }) {
      const a = agents[name] ?? {};
      const screen = typeof a.screen === 'function' ? a.screen(calls.read.length) : (a.screen ?? '');
      calls.read.push({ name, lines });
      return screen;
    },
    createWorktree({ cwd, branch, base, path: target }) {
      calls.create.push({ cwd, branch, base, path: target });
      repo = cwd;
      git(cwd, 'worktree', 'add', '-q', '-b', branch, target, base || 'HEAD');
      paths.w9 = target;
      return { path: target, workspaceId: 'w9', paneId: 'w9:p1' };
    },
    listWorktrees({ cwd }) {
      calls.list.push({ cwd });
      return git(cwd, 'worktree', 'list', '--porcelain')
        .split(/\r?\n\r?\n/)
        .filter(Boolean)
        .map((block) => {
          const p = block.match(/^worktree (.+)$/m)[1];
          const open = openWorkspace && Object.values(paths).some((v) => v.replace(/\\/g, '/') === p);
          return { path: p, open_workspace_id: open ? 'w9' : null };
        });
    },
    removeWorktree({ workspaceId, force }) {
      calls.remove.push({ workspaceId, force: !!force });
      git(repo, 'worktree', 'remove', ...(force ? ['--force'] : []), paths[workspaceId]);
    },
    startAgent(o) {
      calls.agent.push(o);
    },
    promptAgent(o) {
      calls.prompt.push(o);
    },
  };
}

export function write(file, content = 'x') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
