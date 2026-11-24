import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_NAME = 'herdr-team-lead';
export const PACKAGED_SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skill', SKILL_NAME);

// Copies the packaged lead skill into `<skillsDir>/herdr-team-lead`. Only `team skill install` calls this:
// nothing else ever writes to the user's global skills directory.
export function installSkill({ skillsDir }) {
  const dest = path.join(skillsDir, SKILL_NAME);
  fs.mkdirSync(skillsDir, { recursive: true });
  fs.cpSync(PACKAGED_SKILL, dest, { recursive: true, force: true });
  return { dest };
}
