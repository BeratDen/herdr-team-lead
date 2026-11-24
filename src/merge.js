import fs from 'node:fs';
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { validateName } from './names.js';
import { addWorktree } from './add.js';
import { workerPath } from './task.js';
import { dirtyFiles, excludeSpecs } from './gitutil.js';

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const gitOk = (cwd, args) => spawnSync('git', args, { cwd, stdio: 'ignore' }).status === 0;

const samePath = (a, b) => {
  const norm = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
  const slash = (p) => norm(p).split('\\').join('/').toLowerCase();
  return slash(a) === slash(b);
};

// Git commands run in `dir` must act on that worktree, on `branch`: a plain leftover directory would make git fall
// through to the user's own checkout, and a worker that switched branches would have its work committed elsewhere.
function assertWorktreeOn(dir, branch) {
  let top = '';
  try {
    top = git(dir, ['rev-parse', '--show-toplevel']).trim();
  } catch { /* not a repo at all */ }
  if (!top || !samePath(top, dir)) throw new Error(`${dir} bir git worktree'si değil (leftover klasör olabilir), dokunulmadı`);
  let head;
  try {
    head = git(dir, ['symbolic-ref', '--short', 'HEAD']).trim();
  } catch {
    head = '(detached)';
  }
  if (head !== branch) throw new Error(`${dir} ${branch} branch'inde değil (şu an: ${head}), dokunulmadı`);
}

// A worker that could not commit (e.g. a sandboxed agent) must not lose its work: commit it on the worker's behalf.
function autoCommit(dir, name, steps) {
  if (dirtyFiles(dir, steps).length === 0) return undefined;
  git(dir, ['add', '-A', '--', '.', ...excludeSpecs(steps)]);
  const files = git(dir, ['diff', '--cached', '--name-only']).split(/\r?\n/).filter(Boolean);
  if (files.length === 0) return undefined;
  git(dir, ['commit', '-q', '-m', `team: ${name} işi (otomatik commit)`, '-m', files.join('\n')]);
  return { name, files };
}

export function mergeWorkers({ repoRoot, config, names, into, base, herdr, runCommand }) {
  if (!Array.isArray(names) || names.length === 0) throw new Error('en az bir ad verin');
  names.forEach(validateName);
  validateName(into);
  if (new Set(names).size !== names.length) throw new Error('aynı ad tekrar verilmiş');
  if (names.includes(into)) throw new Error(`--into adı (${into}) bir işçi adıyla aynı olamaz`);
  for (const name of names) {
    if (!gitOk(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`])) throw new Error(`branch bulunamadı: ${name}`);
    const dir = workerPath(repoRoot, config, name);
    if (fs.existsSync(dir)) assertWorktreeOn(dir, name);
  }

  const integrationPath = workerPath(repoRoot, config, into);
  if (fs.existsSync(integrationPath)) {
    assertWorktreeOn(integrationPath, into);
    if (gitOk(integrationPath, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])) {
      throw new Error(`çözülmemiş birleştirme var (${integrationPath}): önce çakışmayı çöz ve commit et`);
    }
  } else {
    const created = addWorktree({ repoRoot, name: into, base, herdr, config, runCommand });
    if (!created.ready) throw new Error(`entegrasyon worktree'si hazırlanamadı:\n${created.problems.join('\n')}`);
  }

  const result = { status: 'merged', integrationPath, merged: [], skipped: [], committed: [], conflicts: [] };
  for (const name of names) {
    const dir = workerPath(repoRoot, config, name);
    if (fs.existsSync(dir)) {
      const c = autoCommit(dir, name, config.prepare);
      if (c) result.committed.push(c);
    }
    if (gitOk(integrationPath, ['merge-base', '--is-ancestor', name, into])) {
      result.skipped.push({ name, reason: 'yeni commit yok: zaten birleşmiş ya da hiç commit atmamış' });
      continue;
    }
    const m = spawnSync('git', ['merge', '--no-ff', '-m', `team: ${name} birleştirildi`, name], { cwd: integrationPath, encoding: 'utf8' });
    if (m.status === 0) {
      result.merged.push(name);
      continue;
    }
    const conflicts = git(integrationPath, ['diff', '--name-only', '--diff-filter=U']).split(/\r?\n/).filter(Boolean);
    if (conflicts.length === 0) throw new Error(`git merge ${name} başarısız: ${(m.stderr || m.stdout).trim()}`);
    return { ...result, status: 'conflict', conflicts, conflictWorker: name };
  }

  if (config.test) {
    const run = runCommand ?? ((cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' }));
    try {
      run(config.test, integrationPath);
    } catch (e) {
      return { ...result, status: 'tests_failed', testError: e.message };
    }
  }
  return result;
}
