import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function parseEnvLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return;
  }

  const equalsIndex = trimmed.indexOf('=');
  if (equalsIndex === -1) {
    return;
  }

  const key = trimmed.slice(0, equalsIndex).trim();
  let value = trimmed.slice(equalsIndex + 1).trim();

  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }

  if (key && process.env[key] === undefined) {
    process.env[key] = value;
  }
}

export function loadEnvFiles() {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
    join(__dirname, '../../../.env'),
  ];

  for (const filePath of candidates) {
    if (!existsSync(filePath)) {
      continue;
    }

    for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      parseEnvLine(line);
    }
  }
}
