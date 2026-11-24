import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { validateName } from './names.js';
import { removeAllLinks } from './prepare.js';
import { dirtyFiles } from './gitutil.js';

function samePath(a, b) {
  const norm = (p) => path.resolve(p).toLowerCase();
  return norm(a) === norm(b);
}

function branchExists(repoRoot, ref) {
  return spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${ref}`], { cwd: repoRoot }).status === 0;
}

// Without `mergedInto`, `git branch -d` only deletes a branch merged into HEAD. With it, the worker branch is deleted
// only when it is an ancestor of that branch, so unmerged work is never lost either way.
function deleteMergedBranch(repoRoot, name, mergedInto) {
  try {
    if (mergedInto) {
      execFileSync('git', ['merge-base', '--is-ancestor', name, mergedInto], { cwd: repoRoot, stdio: 'pipe' });
      execFileSync('git', ['branch', '-D', name], { cwd: repoRoot, stdio: 'pipe' });
    } else {
      execFileSync('git', ['branch', '-d', name], { cwd: repoRoot, stdio: 'pipe' });
    }
    return { branchDeleted: true };
  } catch {
    return {
      branchDeleted: false,
      branchNote: `branch ${name} birleştirilmemiş commit içeriyor, silinmedi (silmek için: git branch -D ${name})`,
    };
  }
}

export function removeWorktree({ repoRoot, name, force = false, mergedInto, herdr, config }) {
  validateName(name);
  if (mergedInto === name) throw new Error('--merged-into worker dalının kendisine verilemez: bir dal kendisinin atasıdır, hiçbir şeyi kanıtlamaz');
  if (mergedInto !== undefined && !branchExists(repoRoot, mergedInto)) throw new Error(`branch bulunamadı: ${mergedInto}`);
  const target = path.join(repoRoot, config.worktreeDir, name);
  const entry = herdr.listWorktrees({ cwd: repoRoot }).find((w) => samePath(w.path, target));
  if (!entry) throw new Error(`worktree bulunamadı: ${name} (${target})`);

  if (!force) {
    const dirty = dirtyFiles(target, config.prepare);
    if (dirty.length > 0) {
      throw new Error(`worktree'de kaydedilmemiş değişiklik var, hiçbir şey silinmedi (zorlamak için --force):\n${dirty.join('\n')}`);
    }
  }

  // Every link goes first, listed in the config or not: the removal below follows junctions.
  const removedLinks = removeAllLinks(target);
  // Our own dirty check has passed (or the user forced it), so the underlying removal is forced:
  // tool-made, non-ignored files must not make it fail halfway.
  if (entry.open_workspace_id) {
    herdr.removeWorktree({ workspaceId: entry.open_workspace_id, force: true });
  } else {
    execFileSync('git', ['worktree', 'remove', '--force', target], { cwd: repoRoot });
  }
  return { removedLinks, ...deleteMergedBranch(repoRoot, name, mergedInto) };
}
