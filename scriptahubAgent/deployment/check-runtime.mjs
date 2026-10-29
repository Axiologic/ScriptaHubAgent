import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { skillSource } from './skill-source.mjs';

const agent=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const installed='/opt/scriptahub/runtime';
try {
  const receipt=JSON.parse(await fs.readFile(path.join(installed,'installed.json'),'utf8'));
  if(receipt.platform!==`${process.platform}-${process.arch}`)throw new Error('Runtime architecture differs from the deployed agent');
  const expected=JSON.parse(await fs.readFile(path.join(installed,'source.json'),'utf8'));
  const actual=await skillSource(path.join(agent,'skills'));
  if(Object.keys(actual).length!==Object.keys(expected).length || Object.entries(actual).some(([name,hash])=>expected[name]!==hash))
    throw new Error('The skill sources differ from the prepared runtime. Build and deploy the matching ScriptaHub image');
  await fs.access('/usr/local/bin/scriptahub-skill',fs.constants.X_OK);
  if(!(await fs.readFile(path.join(agent,'site/reader/reader.css'))).equals(await fs.readFile(path.join(installed,'reader/reader.css'))))
    throw new Error('Reader styles differ from the prepared validation runtime. Build and deploy the matching ScriptaHub image');
  console.log(`ScriptaHub runtime matches all ${receipt.skills.length} deployed skills (${receipt.platform}).`);
}catch(error){console.error(`ScriptaHub deployment refused: ${error.message}`);process.exitCode=1;}
