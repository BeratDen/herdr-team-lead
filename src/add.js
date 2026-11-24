import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { validateName } from './names.js';
import { runPrepare } from './prepare.js';
import { ensureTeamExcluded } from './task.js';

export const AGENT_KINDS = ['claude', 'codex'];

function branchExists(repoRoot, name) {
  const r = spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], { cwd: repoRoot });
  return r.status === 0;
}

export function addWorktree({ repoRoot, name, base, agent, prompt, herdr, config, runCommand }) {
  validateName(name);
  if (prompt !== undefined && agent === undefined) throw new Error('--prompt için --agent gerekli');
  if (agent !== undefined && !AGENT_KINDS.includes(agent)) {
    throw new Error(`desteklenmeyen agent ${JSON.stringify(agent)}: ${AGENT_KINDS.join(' veya ')} olmalı`);
  }
  const target = path.join(repoRoot, config.worktreeDir, name);
  if (fs.existsSync(target)) throw new Error(`worktree yolu zaten var: ${target}`);
  if (branchExists(repoRoot, name)) throw new Error(`branch zaten var: ${name}`);

  ensureTeamExcluded(repoRoot);
  const created = herdr.createWorktree({ cwd: repoRoot, branch: name, base, path: target, label: name });
  const problems = [];
  const run = runCommand ?? ((cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' }));

  try {
    runPrepare(config.prepare, { repoRoot, worktreePath: target, runCommand });
  } catch (e) {
    problems.push(e.message);
  }
  if (problems.length === 0 && config.verify) {
    try {
      run(config.verify, target);
    } catch (e) {
      problems.push(`verify başarısız: "${config.verify}": ${e.message}`);
    }
  }
  if (problems.length === 0 && agent) {
    try {
      herdr.startAgent({ name, kind: agent, paneId: created.paneId });
      if (prompt !== undefined) herdr.promptAgent({ name, text: prompt });
    } catch (e) {
      problems.push(`agent başlatılamadı veya prompt gönderilemedi (${agent}): ${e.message}`);
    }
  }
  return { path: target, branch: name, ready: problems.length === 0, problems };
}
