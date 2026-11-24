import { execFileSync } from 'node:child_process';

// Pathspecs that leave out files the tool itself put into a worktree (copies/links); they are not the worker's changes.
export function excludeSpecs(steps) {
  return steps
    .filter((s) => 'copy' in s || 'link' in s)
    .map((s) => `:(exclude)${(s.copy ?? s.link).replace(/\\/g, '/')}`);
}

export function dirtyFiles(target, steps) {
  const out = execFileSync('git', ['status', '--porcelain', '--', '.', ...excludeSpecs(steps)], { cwd: target, encoding: 'utf8' });
  return out.split(/\r?\n/).filter(Boolean);
}
