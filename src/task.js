import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { validateName } from './names.js';

export const TEAM_DIR = '.team';

// A dialog is recognised by its shape (footer hints, a cursor on a numbered option), never by ordinary prose such as
// "Do you want me to..." that an agent may end its turn with. Verified against a real Claude trust dialog and a real
// Codex update dialog; other dialogs are covered only by these generic shapes. This is the first line of defence against
// typing into a dialog, not a guarantee (see the design doc).
export const APPROVAL_PATTERNS = [
  /Enter to confirm/i, /Esc to cancel/i, /\(y\/n\)/i, /Press enter/i, /\benter continue\b/i, /\besc skip\b/i,
  /to select\b/i, /to navigate\b/i,
  /^\s*[❯›]\s*\d+[.)]/m, // the cursor sits on a numbered option: "❯ 1. Yes", "› 1) Update"
];
// An input line: a bare prompt glyph, or one followed by text that is not a numbered menu choice ("❯ 1. Yes").
export const PROMPT_PATTERN = /^\s*[❯›](?:\s*$|\s+(?!\d+[.)]))/m;

export function defaultSleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function isReady(screen) {
  const text = String(screen);
  const hit = APPROVAL_PATTERNS.find((p) => p.test(text));
  if (hit) return { ready: false, approval: true, reason: `onay/soru ekranı görünüyor (${hit})` };
  if (!PROMPT_PATTERN.test(text)) return { ready: false, reason: 'agent giriş satırı görünmüyor' };
  return { ready: true };
}

export function workerPath(repoRoot, config, name) {
  return path.join(repoRoot, config.worktreeDir, name);
}

// Adds `.team/` to the repo-wide exclude file (shared by every worktree) so task files never show up as changes.
export function ensureTeamExcluded(repoRoot) {
  const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  const file = path.join(path.resolve(repoRoot, common), 'info', 'exclude');
  const line = `${TEAM_DIR}/`;
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (current.split(/\r?\n/).includes(line)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${current}${current && !current.endsWith('\n') ? '\n' : ''}${line}\n`);
  return true;
}

export function screenTail(screen, n = 15) {
  return String(screen).split(/\r?\n/).filter((l) => l.trim() !== '').slice(-n).join('\n');
}

function taskPrompt() {
  return `Yeni görev: ${TEAM_DIR}/task.md dosyasını oku ve yap. Bitince ${TEAM_DIR}/result.md dosyasına yaptıklarını, değişen dosyaları, test sonucunu ve sorularını yaz ve işini commit et. Sen bir işçisin; başka agent başlatma veya prompt etme.`;
}

export function sendTask({
  repoRoot, config, name, file, text, force = false, herdr,
  sleep = defaultSleep, now = Date.now, readyTimeoutMs = 60000, pollMs = 2000,
}) {
  validateName(name);
  if ((file === undefined) === (text === undefined)) throw new Error('--file veya --text verin (yalnızca biri)');
  const dir = workerPath(repoRoot, config, name);
  if (!fs.existsSync(dir)) throw new Error(`worktree bulunamadı: ${name} (${dir})`);
  const body = file !== undefined ? fs.readFileSync(file, 'utf8') : text;
  ensureTeamExcluded(repoRoot);

  const started = now();
  for (;;) {
    const { status } = herdr.getAgent({ name });
    const screen = herdr.readAgent({ name, lines: 15 });
    if (status === 'blocked') throw new Error(`${name} bloke (onay/soru bekliyor), görev gönderilmedi:\n${screenTail(screen)}`);
    const ready = isReady(screen);
    // --force skips the "working" refusal and the wait, never the approval-screen guard.
    if (force) {
      if (ready.approval) throw new Error(`${name} onay/soru ekranında (${ready.reason}), --force ile bile gönderilmedi:\n${screenTail(screen)}`);
      break;
    }
    if (status === 'working') throw new Error(`${name} çalışıyor, görev gönderilmedi (zorlamak için --force)`);
    if (ready.ready) break;
    if (now() - started >= readyTimeoutMs) {
      throw new Error(`${name} hazır değil (${ready.reason}), görev gönderilmedi:\n${screenTail(screen)}`);
    }
    sleep(pollMs);
  }

  const teamDir = path.join(dir, TEAM_DIR);
  fs.mkdirSync(teamDir, { recursive: true });
  fs.rmSync(path.join(teamDir, 'result.md'), { force: true });
  const taskPath = path.join(teamDir, 'task.md');
  fs.writeFileSync(taskPath, body);
  herdr.promptAgent({ name, text: taskPrompt() });
  return { taskPath };
}

export function readResult({ repoRoot, config, name }) {
  validateName(name);
  const file = path.join(workerPath(repoRoot, config, name), TEAM_DIR, 'result.md');
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error(`sonuç yok: ${name} henüz ${TEAM_DIR}/result.md yazmadı`);
    throw e;
  }
}
