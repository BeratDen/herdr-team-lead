import fs from 'node:fs';
import path from 'node:path';

export const CONFIG_FILE = '.herdr-team.json';
const STEP_KEYS = ['copy', 'link', 'run'];

function checkRelativePath(value, where) {
  const segments = typeof value === 'string' ? value.split(/[\\/]/) : [];
  if (typeof value !== 'string' || value === '' || path.isAbsolute(value) || segments.includes('..')) {
    throw new Error(`${CONFIG_FILE}: geçersiz yol ${JSON.stringify(value)} (${where}): göreli olmalı, '..' içermemeli`);
  }
}

function checkStep(step, index) {
  if (typeof step !== 'object' || step === null) {
    throw new Error(`${CONFIG_FILE}: prepare[${index}] bir nesne olmalı`);
  }
  const keys = Object.keys(step);
  const kind = keys.find((k) => STEP_KEYS.includes(k));
  const allowed = kind === 'run' ? ['run', 'cwd'] : [kind];
  if (!kind || keys.length !== allowed.length || keys.some((k) => !allowed.includes(k))) {
    throw new Error(`${CONFIG_FILE}: bilinmeyen adım prepare[${index}]: ${JSON.stringify(step)}`);
  }
  if (kind === 'run') {
    if (typeof step.run !== 'string' || step.run === '') throw new Error(`${CONFIG_FILE}: prepare[${index}].run boş olamaz`);
    if (step.cwd !== undefined) checkRelativePath(step.cwd, `prepare[${index}].cwd`);
  } else {
    checkRelativePath(step[kind], `prepare[${index}].${kind}`);
  }
}

export function loadConfig(repoRoot) {
  const file = path.join(repoRoot, CONFIG_FILE);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { worktreeDir: '.worktrees', prepare: [] };
    throw e;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${CONFIG_FILE} okunamadı (${file}): ${e.message}`);
  }
  const config = { worktreeDir: parsed.worktreeDir ?? '.worktrees', prepare: parsed.prepare ?? [] };
  checkRelativePath(config.worktreeDir, 'worktreeDir');
  if (!Array.isArray(config.prepare)) throw new Error(`${CONFIG_FILE}: prepare bir dizi olmalı`);
  config.prepare.forEach(checkStep);
  if (parsed.verify !== undefined) config.verify = parsed.verify;
  if (parsed.test !== undefined) {
    if (typeof parsed.test !== 'string' || parsed.test.trim() === '') {
      throw new Error(`${CONFIG_FILE}: test boş olmayan bir dize olmalı`);
    }
    config.test = parsed.test;
  }
  return config;
}
