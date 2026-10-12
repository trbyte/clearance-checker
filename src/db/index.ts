// Cloud-backed data layer. Same function names as the old Dexie/IndexedDB module,
// but every call goes to the shared Postgres database via /api/db.

export interface MasterStudent {
  id: string; // Internal ID
  key: string; // Normalized key: `id:<normId>` or `nm:<normLast>|<normFirst>`
  studentId: string;
  lastName: string;
  firstName: string;
  program: string;
  yearLevel: string;
  remarks: string;
}

export interface StoredEventRecord {
  id: string;
  name: string;
  fileName: string;
  uploadedAt: number;
  clearanceColName?: string; // custom label for this event's clearance column
  recs: {
    id: string;
    last: string;
    first: string;
    program: string;
    year: string;
    status: string;
  }[];
}

export interface KeyValEntry {
  id: string;
  val: string;
  updatedAt: number;
}

export interface SystemMeta {
  id: string;
  masterFileName?: string;
  overallClearanceColName?: string;
  lastUpdated: number;
}

export interface FullState {
  version: number;
  students: MasterStudent[];
  events: StoredEventRecord[];
  edits: Record<string, string>;
  clr: Record<string, string>;
  meta?: SystemMeta;
}

export interface BackupData {
  students: MasterStudent[];
  events: StoredEventRecord[];
  edits: KeyValEntry[];
  clearances: KeyValEntry[];
  meta: SystemMeta[];
}

// ---------- access code ----------
const ACCESS_KEY = 'clearpass.accessCode';
export const getAccessCode = () => {
  try { return localStorage.getItem(ACCESS_KEY) ?? ''; } catch { return ''; }
};
export const setAccessCode = (code: string) => {
  try { localStorage.setItem(ACCESS_KEY, code); } catch { /* ignore */ }
};
export const clearAccessCode = () => {
  try { localStorage.removeItem(ACCESS_KEY); } catch { /* ignore */ }
};
export const UNAUTHORIZED_EVENT = 'clearpass:unauthorized';

// ---------- transport ----------
let pendingWrites = 0;

async function api<T>(path: string, init?: RequestInit, codeOverride?: string): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-access-code': codeOverride ?? getAccessCode(),
    },
  });
  if (res.status === 401) {
    if (codeOverride === undefined) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw new Error('Invalid access code');
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

async function write(op: string, payload: Record<string, unknown> = {}): Promise<void> {
  pendingWrites++;
  try {
    await api('/api/db', { method: 'POST', body: JSON.stringify({ op, ...payload }) });
  } finally {
    pendingWrites--;
  }
}

/** Returns true if the code is valid, false if rejected. Throws on network/server errors. */
export async function verifyAccessCode(code: string): Promise<boolean> {
  try {
    await api('/api/db?action=ping', undefined, code);
    return true;
  } catch (e: any) {
    if (e?.message === 'Invalid access code') return false;
    throw e;
  }
}

// ---------- reads ----------
export async function loadFullLocalState(): Promise<FullState> {
  const data = await api<FullState & { changed: boolean }>('/api/db');
  return data;
}

/** For polling: returns new state only if someone changed something since `version`.
 *  Returns null when nothing changed, or while this browser still has writes in flight. */
export async function loadStateIfChanged(version: number): Promise<FullState | null> {
  if (pendingWrites > 0) return null;
  const data = await api<(FullState & { changed: true }) | { changed: false }>(`/api/db?since=${version}`);
  if (!data.changed || pendingWrites > 0) return null;
  return data;
}

export const fetchBackup = () => api<BackupData>('/api/db?action=backup');

// ---------- writes ----------
export const saveMasterList = (students: MasterStudent[], fileName?: string) =>
  write('saveMasterList', { students, fileName });

export const saveSingleEvent = (event: StoredEventRecord) => write('saveSingleEvent', { event });

export const removeEventById = (eventId: string) => write('removeEventById', { eventId });

export const saveAttendanceEdit = (key: string, val: string) => write('saveAttendanceEdit', { key, val });

export const saveClearanceOverride = (key: string, val: string) => write('saveClearanceOverride', { key, val });

export const renameEventInDb = (oldName: string, newName: string) => write('renameEvent', { oldName, newName });

export const updateEventClearanceColName = (eventId: string, colName: string) =>
  write('updateEventClearanceColName', { eventId, colName });

export const updateOverallClearanceColName = (colName: string) =>
  write('updateOverallClearanceColName', { colName });

export const removeAttendanceEdit = (key: string) => write('removeAttendanceEdit', { key });

export const removeClearanceOverride = (key: string) => write('removeClearanceOverrides', { keys: [key] });

export const removeClearanceOverrides = (keys: string[]) => write('removeClearanceOverrides', { keys });

export const clearAllLocalData = () => write('clearAll');

export const restoreBackup = (data: Partial<BackupData>) => write('restoreBackup', { data });
