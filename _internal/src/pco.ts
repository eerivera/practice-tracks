import fs from 'fs';
import path from 'path';
import { type PcoCredentials } from './env.js';

export interface PcoSong {
  id: string;
  title: string;
}

export interface PcoArrangement {
  id: string;
  name: string;
}

export interface PcoKey {
  id: string;
  name: string;
  startingKey: string;
}

// Stored per song directory in songs/<name>/pco.json
export interface PcoSongLink {
  songId: string;
  arrangementId: string;
  // Maps key signature (e.g. "Ab") to the PCO key resource ID
  keys: Record<string, string>;
}

const PCO_BASE = 'https://api.planningcenteronline.com/services/v2';

function authHeader(creds: PcoCredentials): string {
  return `Basic ${Buffer.from(`${creds.appId}:${creds.secret}`).toString('base64')}`;
}

async function pcoGet<T>(endpoint: string, creds: PcoCredentials): Promise<T> {
  const res = await fetch(`${PCO_BASE}${endpoint}`, {
    headers: { Authorization: authHeader(creds), 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`PCO API ${res.status}: ${res.statusText} (${endpoint})`);
  return res.json() as Promise<T>;
}

interface PcoListResponse<TAttr> { data: { id: string; attributes: TAttr }[] }

export async function validateCredentials(creds: PcoCredentials): Promise<boolean> {
  try {
    await pcoGet('/songs?per_page=1', creds);
    return true;
  } catch {
    return false;
  }
}

export async function searchSongs(title: string, creds: PcoCredentials): Promise<PcoSong[]> {
  const data = await pcoGet<PcoListResponse<{ title: string }>>(
    `/songs?where[title]=${encodeURIComponent(title)}&per_page=10`,
    creds
  );
  return data.data.map((s) => ({ id: s.id, title: s.attributes.title }));
}

export async function getArrangements(
  songId: string,
  creds: PcoCredentials
): Promise<PcoArrangement[]> {
  const data = await pcoGet<PcoListResponse<{ name: string }>>(
    `/songs/${songId}/arrangements`,
    creds
  );
  return data.data.map((a) => ({ id: a.id, name: a.attributes.name }));
}

export async function getKeys(
  songId: string,
  arrangementId: string,
  creds: PcoCredentials
): Promise<PcoKey[]> {
  const data = await pcoGet<PcoListResponse<{ name: string; starting_key: string }>>(
    `/songs/${songId}/arrangements/${arrangementId}/keys`,
    creds
  );
  return data.data.map((k) => ({
    id: k.id,
    name: k.attributes.name,
    startingKey: k.attributes.starting_key,
  }));
}

export function loadPcoLink(songDir: string): PcoSongLink | null {
  const p = path.join(songDir, 'pco.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8')) as PcoSongLink;
}

export function savePcoLink(songDir: string, link: PcoSongLink): void {
  fs.writeFileSync(path.join(songDir, 'pco.json'), JSON.stringify(link, null, 2) + '\n');
}

// TODO: Implement once a PAT is available for testing.
//
// PCO attachment upload is a two-step process:
//   1. POST /songs/{id}/arrangements/{id}/keys/{id}/attachments
//      with multipart/form-data (file + metadata)
//   2. Verify the response attachment record
//
// Alternatively PCO may provide a presigned S3 URL — check the response body
// of step 1 for an upload_url field.
//
// Reference: https://developer.planning.center/docs/#/apps/services
// Issue a GET to the attachments endpoint first to check for existing files
// before uploading (to implement the skip logic).
export function uploadMixFile(
  _link: PcoSongLink,
  _keySignature: string,
  _filePath: string,
  _creds: PcoCredentials
): Promise<void> {
  return Promise.reject(new Error(
    'PCO upload not yet implemented — PAT required.\n' +
      'See MAINTAINER.md § "PCO Upload Implementation" for the plan.'
  ));
}

// Returns false until the upload is implemented.
// TODO: Replace with GET /attachments filtered by filename once PAT is available.
export function attachmentExists(
  _link: PcoSongLink,
  _keySignature: string,
  _fileName: string,
  _creds: PcoCredentials
): Promise<boolean> {
  return Promise.resolve(false);
}
