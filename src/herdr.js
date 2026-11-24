import { spawnSync } from 'node:child_process';

export class HerdrError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'HerdrError';
    this.code = code;
  }
}

// herdr prints most errors as JSON on stdout, but the docs (and `agent start`) use stderr: take whichever has content.
export function pickOutput({ stdout, stderr }) {
  return stdout && stdout.trim() ? stdout : (stderr ?? '');
}

export function defaultRun(args) {
  const bin = process.env.HERDR_TEAM_HERDR || 'herdr';
  const r = spawnSync(bin, args, { encoding: 'utf8' });
  if (r.error) throw new HerdrError('spawn_failed', `herdr çalıştırılamadı: ${r.error.message}`);
  return pickOutput(r);
}

function call(run, args) {
  const out = run(args);
  let parsed;
  try {
    parsed = JSON.parse(String(out).trim());
  } catch {
    throw new HerdrError('invalid_json', `herdr ${args.slice(0, 2).join(' ')}: JSON olmayan çıktı: ${String(out).slice(0, 200)}`);
  }
  if (parsed.error) throw new HerdrError(parsed.error.code, parsed.error.message);
  return parsed.result;
}

export function createHerdr(run = defaultRun) {
  return {
    createWorktree({ cwd, branch, base, path, label }) {
      const args = ['worktree', 'create', '--cwd', cwd, '--branch', branch];
      if (base) args.push('--base', base);
      args.push('--path', path, '--label', label, '--no-focus');
      const r = call(run, args);
      return { path: r.worktree.path, workspaceId: r.workspace.workspace_id, paneId: r.root_pane.pane_id };
    },
    listWorktrees({ cwd }) {
      return call(run, ['worktree', 'list', '--cwd', cwd]).worktrees;
    },
    removeWorktree({ workspaceId, force }) {
      const args = ['worktree', 'remove', '--workspace', workspaceId];
      if (force) args.push('--force');
      return call(run, args);
    },
    promptAgent({ name, text }) {
      return call(run, ['agent', 'prompt', name, text]);
    },
    startAgent({ name, kind, paneId }) {
      return call(run, ['agent', 'start', name, '--kind', kind, '--pane', paneId]);
    },
    getAgent({ name }) {
      return { status: call(run, ['agent', 'get', name]).agent.agent_status };
    },
    // `agent read` prints the screen as raw text; only an error comes back as JSON.
    readAgent({ name, lines = 20 }) {
      const out = String(run(['agent', 'read', name, '--source', 'visible', '--lines', String(lines)]));
      if (out.startsWith('{"id"')) {
        let parsed;
        try {
          parsed = JSON.parse(out.trim());
        } catch {
          return out;
        }
        if (parsed.error) throw new HerdrError(parsed.error.code, parsed.error.message);
      }
      return out;
    },
  };
}
