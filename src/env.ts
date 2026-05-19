import fs from 'fs';
import path from 'path';

// Loads a .env file from the project root into process.env.
// Does not overwrite variables already set in the environment.
export function loadEnv(): void {
  const envPath = path.resolve('.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}

export interface PcoCredentials {
  appId: string;
  secret: string;
}

export function loadPcoCredentials(): PcoCredentials | null {
  const appId = process.env.PCO_APP_ID;
  const secret = process.env.PCO_SECRET;
  if (!appId || !secret) return null;
  return { appId, secret };
}
