import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

function defaultRunCommand(cmd, cwd) {
  execSync(cmd, { cwd, stdio: 'inherit' });
}

function copyOrLink(kind, rel, { repoRoot, worktreePath }) {
  const source = path.join(repoRoot, rel);
  const dest = path.join(worktreePath, rel);
  if (!fs.existsSync(source)) {
    throw new Error(`prepare ${kind} adımı başarısız: kaynak yok: ${source}`);
  }
  if (kind === 'link' && !fs.statSync(source).isDirectory()) {
    throw new Error(`prepare link adımı başarısız: kaynak bir dizin olmalı (dosya bağlanamaz): ${source}`);
  }
  if (fs.existsSync(dest) || isLink(dest)) {
    throw new Error(`prepare ${kind} adımı başarısız: hedef zaten var: ${dest}`);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (kind === 'copy') fs.cpSync(source, dest, { recursive: true });
  else fs.symlinkSync(source, dest, 'junction');
}

function isLink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

export function runPrepare(steps, ctx) {
  const runCommand = ctx.runCommand ?? defaultRunCommand;
  for (const step of steps) {
    if ('copy' in step) copyOrLink('copy', step.copy, ctx);
    else if ('link' in step) copyOrLink('link', step.link, ctx);
    else {
      const cwd = step.cwd ? path.join(ctx.worktreePath, step.cwd) : ctx.worktreePath;
      try {
        runCommand(step.run, cwd);
      } catch (e) {
        throw new Error(`prepare run adımı başarısız: "${step.run}" (${cwd}): ${e.message}`);
      }
    }
  }
}

// Unlinks EVERY junction/symlink under the worktree, whether or not the current config lists it.
// Git for Windows follows junctions when deleting a worktree, which would wipe the link target
// (e.g. the main checkout's node_modules). The walk never descends into a link.
export function removeAllLinks(worktreePath) {
  const removed = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue; // plain files cannot be links
      if (isLink(p)) {
        unlinkEntry(p);
        removed.push(p);
      } else if (entry.isDirectory()) {
        walk(p);
      }
    }
  };
  walk(worktreePath);
  return removed;
}

function unlinkEntry(p) {
  try {
    fs.unlinkSync(p);
  } catch {
    fs.rmdirSync(p); // non-recursive: removes the junction entry only
  }
}

// Removes only the links named by `link` steps, never a real directory and never a link target.
export function removeLinks(steps, worktreePath) {
  const removed = [];
  for (const step of steps) {
    if (!('link' in step)) continue;
    const p = path.join(worktreePath, step.link);
    if (!isLink(p)) continue;
    unlinkEntry(p);
    removed.push(p);
  }
  return removed;
}
