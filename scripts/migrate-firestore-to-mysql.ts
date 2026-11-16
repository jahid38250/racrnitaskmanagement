/**
 * Non-Destructive Firestore & Local Snapshot -> MySQL Migration Utility
 *
 * Reads production data READ-ONLY from Google Cloud Firestore REST API (using
 * firebase-applet-config.json) and/or local data snapshots (data/db.json,
 * data/permanent-staff.json, backups/latest-backup.json), preserves all bcrypt
 * password hashes & relationships, normalizes attachments to local disk, and
 * upserts everything idempotently into MySQL.
 *
 * NEVER modifies or deletes any original Firebase Firestore data.
 *
 * Usage:
 *   npx tsx scripts/migrate-firestore-to-mysql.ts [--source=auto|firestore|file] [--file=data/db.json] [--dry-run]
 */
import 'dotenv/config';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import {
  ensureMysqlSchema,
  getMysqlConfig,
  initMysqlPool,
  saveMysqlProductionData,
  saveMysqlBackupSnapshot
} from '../mysqlDb.ts';

interface MigrationArgs {
  source: 'auto' | 'firestore' | 'file';
  filePath: string;
  firebaseConfigPath: string;
  dryRun: boolean;
}

function parseArgs(): MigrationArgs {
  const args = process.argv.slice(2);
  let source: 'auto' | 'firestore' | 'file' = 'file';
  let filePath = 'data/db.json';
  let firebaseConfigPath = 'firebase-applet-config.json';
  let dryRun = false;

  for (const arg of args) {
    if (arg.startsWith('--source=')) {
      const val = arg.slice('--source='.length).toLowerCase();
      if (val === 'firestore' || val === 'file' || val === 'auto') source = val;
    } else if (arg.startsWith('--file=')) {
      filePath = arg.slice('--file='.length);
    } else if (arg.startsWith('--firebase-config=')) {
      firebaseConfigPath = arg.slice('--firebase-config='.length);
    } else if (arg === '--dry-run') {
      dryRun = true;
    }
  }
  return { source, filePath, firebaseConfigPath, dryRun };
}

function decodeFirestoreValue(val: any): any {
  if (!val || typeof val !== 'object') return val;
  if ('nullValue' in val) return null;
  if ('stringValue' in val) return val.stringValue;
  if ('booleanValue' in val) return Boolean(val.booleanValue);
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('timestampValue' in val) return val.timestampValue;
  if ('arrayValue' in val) {
    const values = val.arrayValue?.values || [];
    return values.map(decodeFirestoreValue);
  }
  if ('mapValue' in val) {
    const fields = val.mapValue?.fields || {};
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = decodeFirestoreValue(v);
    }
    return out;
  }
  return val;
}

function decodeFirestoreDocument(docObj: any): Record<string, any> {
  const out: Record<string, any> = {};
  const fields = docObj?.fields || {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = decodeFirestoreValue(v);
  }
  if (!out.id && typeof docObj?.name === 'string') {
    const parts = docObj.name.split('/');
    out.id = parts[parts.length - 1];
  }
  return out;
}

async function fetchFirestoreCollectionReadOnly(
  projectId: string,
  databaseId: string,
  collectionName: string,
  apiKey?: string
): Promise<any[]> {
  const docs: any[] = [];
  let pageToken = '';
  const base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents/${encodeURIComponent(collectionName)}`;

  do {
    const url = new URL(base);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    if (apiKey) url.searchParams.set('key', apiKey);

    const res = await fetch(url.toString(), { method: 'GET' });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Firestore REST GET ${collectionName} failed (${res.status}): ${txt.slice(0, 200)}`);
    }
    const json: any = await res.json();
    if (Array.isArray(json.documents)) {
      for (const d of json.documents) {
        docs.push(decodeFirestoreDocument(d));
      }
    }
    pageToken = json.nextPageToken || '';
  } while (pageToken);

  return docs;
}

async function fetchFirestoreDocReadOnly(
  projectId: string,
  databaseId: string,
  docPath: string,
  apiKey?: string
): Promise<Record<string, any> | null> {
  const url = new URL(
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents/${docPath}`
  );
  if (apiKey) url.searchParams.set('key', apiKey);

  const res = await fetch(url.toString(), { method: 'GET' });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  const json: any = await res.json();
  return decodeFirestoreDocument(json);
}

async function loadFromFirestoreReadOnly(configPath: string): Promise<any | null> {
  const cfgPath = path.isAbsolute(configPath) ? configPath : path.join(process.cwd(), configPath);
  if (!fsSync.existsSync(cfgPath)) return null;

  const cfg = JSON.parse(await fs.readFile(cfgPath, 'utf-8'));
  const projectId = cfg.projectId;
  const databaseId = cfg.firestoreDatabaseId || '(default)';
  const apiKey = cfg.apiKey;
  if (!projectId) return null;

  console.log(`[MIGRATION] Reading Firestore REST API (READ-ONLY) for project ${projectId}...`);
  const [users, tasks, meta, att, pts, sec, shifts] = await Promise.all([
    fetchFirestoreCollectionReadOnly(projectId, databaseId, 'production_users', apiKey),
    fetchFirestoreCollectionReadOnly(projectId, databaseId, 'production_tasks', apiKey),
    fetchFirestoreDocReadOnly(projectId, databaseId, 'production_state/metadata', apiKey),
    fetchFirestoreDocReadOnly(projectId, databaseId, 'production_state/attendance', apiKey),
    fetchFirestoreDocReadOnly(projectId, databaseId, 'production_state/points', apiKey),
    fetchFirestoreDocReadOnly(projectId, databaseId, 'production_state/security', apiKey),
    fetchFirestoreDocReadOnly(projectId, databaseId, 'production_state/shifts', apiKey)
  ]);

  if (users.length === 0 && tasks.length === 0) return null;
  return {
    users,
    tasks,
    deletedTaskIds: meta?.deletedTaskIds || [],
    autoBackupSettings: meta?.autoBackupSettings || { enabled: true, intervalMinutes: 5, retentionCount: 5000 },
    assignmentRequests: meta?.assignmentRequests || [],
    attendanceRecords: att?.records || [],
    pointTransactions: pts?.pointTransactions || [],
    technicianPerformance: pts?.technicianPerformance || [],
    activityLogs: sec?.activityLogs || [],
    adminAuditLogs: sec?.adminAuditLogs || [],
    lockedDevices: sec?.lockedDevices || [],
    shiftConfigurations: shifts?.shiftConfigurations || [],
    technicianShiftAssignments: shifts?.technicianShiftAssignments || [],
    overtimeRequests: shifts?.overtimeRequests || [],
    taskTimeExtensions: shifts?.taskTimeExtensions || [],
    taskTimeSessions: shifts?.taskTimeSessions || [],
    taskTimerAuditLogs: shifts?.taskTimerAuditLogs || [],
    performanceConfig: shifts?.performanceConfig || null
  };
}

async function loadFromLocalFiles(filePath: string): Promise<any | null> {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  const candidates = [
    resolved,
    path.join(process.cwd(), 'data', 'db.json'),
    path.join(process.cwd(), 'data.json'),
    path.join(process.cwd(), 'backups', 'latest-backup.json')
  ];

  let base: any = null;
  for (const cand of candidates) {
    if (fsSync.existsSync(cand)) {
      try {
        const parsed = JSON.parse(await fs.readFile(cand, 'utf-8'));
        if (parsed && Array.isArray(parsed.users) && parsed.users.length > 0) {
          console.log(`[MIGRATION] Loaded local snapshot from ${cand} (${parsed.users.length} users, ${parsed.tasks?.length || 0} tasks)`);
          base = parsed;
          break;
        }
      } catch (err: any) {
        console.warn(`[MIGRATION] Skipping unreadable file ${cand}: ${err.message}`);
      }
    }
  }

  // Merge authoritative permanent-staff.json if present
  const staffFile = path.join(process.cwd(), 'data', 'permanent-staff.json');
  if (base && fsSync.existsSync(staffFile)) {
    try {
      const staff = JSON.parse(await fs.readFile(staffFile, 'utf-8'));
      if (Array.isArray(staff) && staff.length > 0) {
        const map = new Map<string, any>();
        for (const u of base.users || []) map.set(String(u.employeeId || u.id), u);
        for (const u of staff) map.set(String(u.employeeId || u.id), u);
        base.users = Array.from(map.values());
      }
    } catch {}
  }

  return base;
}

function mergeDatasets(primary: any, secondary: any): any {
  if (!primary) return secondary;
  if (!secondary) return primary;

  const userMap = new Map<string, any>();
  for (const u of secondary.users || []) userMap.set(String(u.employeeId || u.id), u);
  for (const u of primary.users || []) userMap.set(String(u.employeeId || u.id), u);

  const deletedSet = new Set<string>([
    ...(secondary.deletedTaskIds || []).map(String),
    ...(primary.deletedTaskIds || []).map(String)
  ]);

  const taskMap = new Map<string, any>();
  for (const t of secondary.tasks || []) {
    const id = String(t.id || t.taskId || '').trim();
    if (id && !deletedSet.has(id)) taskMap.set(id, t);
  }
  for (const t of primary.tasks || []) {
    const id = String(t.id || t.taskId || '').trim();
    if (id && !deletedSet.has(id)) taskMap.set(id, t);
  }

  return {
    ...secondary,
    ...primary,
    users: Array.from(userMap.values()),
    tasks: Array.from(taskMap.values()),
    deletedTaskIds: Array.from(deletedSet)
  };
}

async function normalizeAttachmentsToDisk(tasks: any[], dryRun: boolean): Promise<number> {
  const attDir = path.join(process.cwd(), 'uploads', 'attachments');
  if (!dryRun && !fsSync.existsSync(attDir)) {
    fsSync.mkdirSync(attDir, { recursive: true });
  }

  let migratedFiles = 0;
  for (const t of tasks) {
    if (!Array.isArray(t.attachments)) continue;
    for (const att of t.attachments) {
      if (att && typeof att.dataUrl === 'string' && att.dataUrl.startsWith('data:')) {
        const match = att.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          const mimeType = match[1];
          const buf = Buffer.from(match[2], 'base64');
          const safeName = `${Date.now()}-${(att.originalName || att.filename || 'file').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
          if (!dryRun) {
            await fs.writeFile(path.join(attDir, safeName), buf);
          }
          att.filename = safeName;
          att.mimeType = mimeType;
          att.sizeBytes = buf.length;
          att.url = `/uploads/attachments/${safeName}`;
          delete att.dataUrl;
          migratedFiles++;
        }
      }
    }
  }
  return migratedFiles;
}

async function main() {
  const args = parseArgs();
  console.log('==============================================================');
  console.log(' RAC R&I Task Management System - Data Migration Utility');
  console.log(` Source mode: ${args.source} | Dry run: ${args.dryRun ? 'YES' : 'NO'}`);
  console.log('==============================================================');

  let firestoreData: any = null;
  let fileData: any = null;

  if (args.source === 'firestore' || args.source === 'auto') {
    try {
      firestoreData = await loadFromFirestoreReadOnly(args.firebaseConfigPath);
      if (firestoreData) {
        console.log(`[MIGRATION] Firestore snapshot fetched (${firestoreData.users.length} users, ${firestoreData.tasks.length} tasks). Original Firestore data untouched.`);
      }
    } catch (err: any) {
      console.warn(`[MIGRATION] Firestore REST fetch skipped/unavailable: ${err.message}`);
    }
  }

  if (args.source === 'file' || args.source === 'auto') {
    fileData = await loadFromLocalFiles(args.filePath);
  }

  const dataset = mergeDatasets(firestoreData, fileData);
  if (!dataset || !Array.isArray(dataset.users) || dataset.users.length === 0) {
    console.error('[MIGRATION ERROR] No valid source records found in Firestore or local files.');
    process.exit(1);
  }

  // Ensure every user has a valid bcrypt hash (preserve existing $2a$/$2b$ hashes; flag accounts needing reset)
  let preservedHashes = 0;
  let initializedFallbackPasswords = 0;
  for (const u of dataset.users) {
    if (typeof u.password === 'string' && u.password.startsWith('$2')) {
      preservedHashes++;
    } else {
      const initialPass = String(u.employeeId || '3624');
      u.password = await bcrypt.hash(initialPass, 10);
      u.mustChangePassword = true;
      initializedFallbackPasswords++;
    }
  }

  const normalizedAttCount = await normalizeAttachmentsToDisk(dataset.tasks || [], args.dryRun);
  const departments = new Set<string>(['RAC R&I']);
  dataset.users.forEach((u: any) => u.department && departments.add(String(u.department).trim()));
  dataset.tasks.forEach((t: any) => t.department && departments.add(String(t.department).trim()));

  const projects = new Set<string>();
  dataset.tasks.forEach((t: any) => {
    if (t.project) projects.add(String(t.project).trim());
    if (t.model) projects.add(String(t.model).trim());
  });

  const summary = {
    departments: departments.size,
    projects: projects.size,
    users: dataset.users.length,
    preservedBcryptHashes: preservedHashes,
    flaggedPasswordResets: initializedFallbackPasswords,
    tasks: (dataset.tasks || []).length,
    deletedTaskTombstones: (dataset.deletedTaskIds || []).length,
    taskLogs: (dataset.tasks || []).reduce((acc: number, t: any) => acc + (Array.isArray(t.logs) ? t.logs.length : 0), 0),
    taskComments: (dataset.tasks || []).reduce((acc: number, t: any) => acc + (Array.isArray(t.comments) ? t.comments.length : 0), 0),
    taskAttachmentsNormalized: normalizedAttCount,
    attendanceRecords: (dataset.attendanceRecords || []).length,
    pointTransactions: (dataset.pointTransactions || []).length,
    notifications: (dataset.notifications || []).length,
    activityLogs: (dataset.activityLogs || []).length,
    adminAuditLogs: (dataset.adminAuditLogs || []).length,
    shiftConfigurations: (dataset.shiftConfigurations || []).length,
    technicianShiftAssignments: (dataset.technicianShiftAssignments || []).length,
    overtimeRequests: (dataset.overtimeRequests || []).length,
    taskTimeExtensions: (dataset.taskTimeExtensions || []).length,
    taskTimeSessions: (dataset.taskTimeSessions || []).length
  };

  console.log('[MIGRATION] Prepared records summary:', JSON.stringify(summary, null, 2));

  if (args.dryRun) {
    console.log('[MIGRATION] --dry-run complete. Zero writes performed.');
    process.exit(0);
  }

  const cfg = getMysqlConfig();
  if (!cfg.enabled) {
    console.error('[MIGRATION ERROR] MYSQL_HOST is not set. Configure .env before running live MySQL migration (or use --dry-run to verify source parsing).');
    process.exit(1);
  }

  const schemaOk = await ensureMysqlSchema(true);
  if (!schemaOk) {
    console.error('[MIGRATION ERROR] Failed to initialize MySQL schema.');
    process.exit(1);
  }

  const saved = await saveMysqlProductionData(dataset);
  if (!saved) {
    console.error('[MIGRATION ERROR] Failed to save migrated dataset to MySQL.');
    process.exit(1);
  }

  await saveMysqlBackupSnapshot(dataset, 'MANUAL', {
    action: 'FIRESTORE_TO_MYSQL_MIGRATION',
    migratedAt: new Date().toISOString(),
    summary
  });

  const pool = initMysqlPool();
  if (pool) {
    const [[uCnt]]: any = await pool.query('SELECT COUNT(*) AS cnt FROM users');
    const [[tCnt]]: any = await pool.query('SELECT COUNT(*) AS cnt FROM tasks');
    const [[dCnt]]: any = await pool.query('SELECT COUNT(*) AS cnt FROM departments');
    const [[pCnt]]: any = await pool.query('SELECT COUNT(*) AS cnt FROM projects');
    const [[attCnt]]: any = await pool.query('SELECT COUNT(*) AS cnt FROM attendance_records');
    console.log(
      `[MIGRATION VERIFIED] MySQL row counts -> departments=${dCnt.cnt}, projects=${pCnt.cnt}, users=${uCnt.cnt}, tasks=${tCnt.cnt}, attendance=${attCnt.cnt}`
    );
  }

  console.log('[MIGRATION COMPLETE] All data migrated safely to MySQL. Original Firebase data remains untouched.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[MIGRATION FATAL ERROR]', err);
  process.exit(1);
});
