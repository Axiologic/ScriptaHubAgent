import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const defaultPoints = Object.freeze({ bookReward: 0, correctionReward: 0, editionCost: 0, forkCost: 0, rewardValidityDays: 180, firstNoticeDays: 30, lastNoticeDays: 7 });

export function validatePoints(points) {
  if (points === undefined) return { ...defaultPoints };
  if (!points || typeof points !== 'object' || Array.isArray(points) ||
    Object.keys(points).some(key=>!Object.hasOwn(defaultPoints,key))) throw new Error('Invalid points settings.');
  const result = {...defaultPoints,...points};
  for (const [key,value] of Object.entries(result)) {
    const limit = key.endsWith('Days') ? 3650 : 1000000;
    if (!Number.isSafeInteger(value) || value < 0 || value > limit) throw new Error('Enter a valid whole number for each points setting.');
  }
  if (result.firstNoticeDays && result.lastNoticeDays > result.firstNoticeDays) throw new Error('The first reminder must be at least as early as the last one.');
  return result;
}

export async function loadPointsPolicy(directory) {
  try { return validatePoints(JSON.parse(await fs.readFile(path.join(directory,'points.json'),'utf8'))); }
  catch (error) { if (error.code === 'ENOENT') return { ...defaultPoints }; throw error; }
}

export async function savePointsPolicy(directory, input) {
  const points = validatePoints(input);
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  const file = path.join(directory,'points.json');
  const temp = file + '.' + crypto.randomUUID();
  try {
    await fs.writeFile(temp,JSON.stringify(points) + '\n',{flag:'wx',mode:0o600});
    await fs.rename(temp,file);
  } finally { await fs.rm(temp,{force:true}); }
  return points;
}
