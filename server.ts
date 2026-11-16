import "dotenv/config";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import fs from "fs/promises";
import fsSync from "fs";
import XLSX from "xlsx";
import multer from "multer";
import { GoogleGenAI } from "@google/genai";
import type {
  Role,
  User,
  Task,
  Attendance,
  TaskLog,
  TaskStatus,
  ActivityLog,
  AdminAuditLog,
  UserSession,
  FailedLoginAttempt,
  LockedDevice,
  ShiftConfiguration,
  TechnicianShiftAssignment,
  TaskTimeSession,
  OvertimeRequest,
  TaskTimeExtension,
  PerformanceConfig,
  TaskTimerAuditLog
} from './types.ts';
import {
  DEFAULT_SHIFTS,
  DEFAULT_PERFORMANCE_CONFIG,
  calculateTaskWorkingTime,
  calculatePerformanceScore,
  getBangladeshDateTime,
  createBangladeshTimestamp,
  getTechnicianShiftForDate,
  formatMinutes,
  parseDurationToMinutes,
  parseDate
} from './workingTimeEngine.ts';
import {
  initMysqlPool,
  isMysqlEnabled,
  checkMysqlDbHealth,
  loadMysqlProductionData,
  saveMysqlProductionData,
  saveMysqlBackupSnapshot,
  getPersistentBackupList,
  getPersistentBackupData,
  deleteMysqlTask,
  saveSingleMysqlTask,
  getLocalDbStatus
} from './mysqlDb.ts';

let genAIClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY) return null;
  if (!genAIClient) {
    genAIClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return genAIClient;
}

const upload = multer({ dest: 'uploads/' });
const attachmentStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(process.cwd(), 'uploads', 'attachments');
    if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safeName}`);
  }
});
const attachmentUpload = multer({
  storage: attachmentStorage,
  limits: { fileSize: 25 * 1024 * 1024 }
});

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const portArgIdx = process.argv.indexOf('--port');
const cliPort = portArgIdx !== -1 && process.argv[portArgIdx + 1] ? parseInt(process.argv[portArgIdx + 1], 10) : NaN;
const envPort = process.env.PORT ? parseInt(process.env.PORT, 10) : NaN;
const nginxPort = process.env.NGINX_PORT ? parseInt(process.env.NGINX_PORT, 10) : NaN;
const defaultAppPort = process.env.DEFAULT_APP_PORT ? parseInt(process.env.DEFAULT_APP_PORT, 10) : 3000;
const PORT = !isNaN(cliPort)
  ? cliPort
  : (!isNaN(envPort) && envPort !== nginxPort ? envPort : (!isNaN(defaultAppPort) ? defaultAppPort : 3000));
const JWT_SECRET = process.env.JWT_SECRET || "enterprise-secret-key";

async function startServer() {
  console.log("Starting server initialization...");
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // --- Data Variables (Initialized early to avoid ReferenceError) ---
  let users: User[] = [];
  let tasks: Task[] = [];
  let deletedTaskIds: string[] = [];
  let attendanceRecords: Attendance[] = [];
  let notifications: any[] = [];
  let pointTransactions: any[] = [];
  let technicianPerformance: any[] = [];
  let assignmentRequests: any[] = [];
  let activityLogs: ActivityLog[] = [];
  let adminAuditLogs: AdminAuditLog[] = [];
  let userSessions: UserSession[] = [];
  let failedLoginAttempts: FailedLoginAttempt[] = [];
  let lockedDevices: LockedDevice[] = [];
  let shiftConfigurations: ShiftConfiguration[] = [...DEFAULT_SHIFTS];
  let technicianShiftAssignments: TechnicianShiftAssignment[] = [];
  let taskTimeSessions: TaskTimeSession[] = [];
  let taskTimeExtensions: TaskTimeExtension[] = [];
  let overtimeRequests: OvertimeRequest[] = [];
  let taskTimerAuditLogs: TaskTimerAuditLog[] = [];
  let performanceConfig: PerformanceConfig = { ...DEFAULT_PERFORMANCE_CONFIG };

  function addTaskTimerAuditLog(entry: Omit<TaskTimerAuditLog, 'id' | 'timestamp'> & { timestamp?: string }) {
    taskTimerAuditLogs.push({
      id: `tl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: entry.timestamp || new Date().toISOString(),
      ...entry
    });
    if (taskTimerAuditLogs.length > 1000) {
      taskTimerAuditLogs.splice(0, taskTimerAuditLogs.length - 1000);
    }
  }

  // --- Shifting Technician Logic ---
  const shiftingTechnicianIds = [
    '20368', '52903', '50328', '42692', '43264', '43249', 
    '60578', '60914', '62536', '63513', '64456', '63124'
  ];
  const shiftingOfficerIds = ['41412', '67123']; // Yousuf and Shakib

  function applyShiftingTechnicianLogic() {
    users.forEach(u => {
      if (u.role === 'TECHNICIAN' && shiftingTechnicianIds.includes(u.employeeId)) {
        u.supervisor_ids = shiftingOfficerIds;
      }
    });
  }

  function isTechnicianSupervisedByOfficer(tech: any, officer: any): boolean {
    if (!tech || !officer) return false;
    const offId = String(officer.id || '').trim();
    const offEmpId = String(officer.employeeId || '').trim();
    const techSupId = String(tech.supervisorId || '').trim();

    if (techSupId && (techSupId === offId || techSupId === offEmpId)) return true;
    if (Array.isArray(tech.supervisor_ids)) {
      if (tech.supervisor_ids.some((sid: any) => String(sid).trim() === offId || String(sid).trim() === offEmpId)) return true;
    }
    if (shiftingTechnicianIds.includes(tech.employeeId) && shiftingOfficerIds.includes(officer.employeeId)) {
      return true;
    }
    return false;
  }

  // --- Request Logging ---
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      if (req.originalUrl.startsWith('/api')) {
        console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
      }
    });
    next();
  });

  // --- Data Persistence Configuration ---
  const DATA_FILE = path.join(process.cwd(), "data.json");
  const DATA_DIR = path.join(process.cwd(), "data");
  const DB_FILE = path.join(DATA_DIR, "db.json");
  const BACKUPS_DIR = path.join(process.cwd(), "backups");
  const UPLOADS_DIR = path.join(process.cwd(), "uploads");
  const ATTACHMENTS_DIR = path.join(UPLOADS_DIR, "attachments");
  const PERMANENT_STAFF_FILE = path.join(DATA_DIR, "permanent-staff.json");
  const STAFF_BACKUPS_DIR = path.join(BACKUPS_DIR, "staff-backups");

  // Helper to backup staff management database and enforce permanent-staff.json
  async function backupAndSyncPermanentStaff(action: 'ADDED' | 'DELETED' | 'UPDATED', targetEmpId?: string, targetName?: string) {
    try {
      if (!fsSync.existsSync(STAFF_BACKUPS_DIR)) {
        fsSync.mkdirSync(STAFF_BACKUPS_DIR, { recursive: true });
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFilename = `staff-backup-${timestamp}-${action.toLowerCase()}-${targetEmpId || 'all'}.json`;
      const backupPath = path.join(STAFF_BACKUPS_DIR, backupFilename);
      const payload = {
        action,
        targetEmployeeId: targetEmpId,
        targetName,
        timestamp: new Date().toISOString(),
        totalUsers: users.length,
        users: JSON.parse(JSON.stringify(users))
      };
      await fs.writeFile(backupPath, JSON.stringify(payload, null, 2), "utf-8");
      await fs.writeFile(path.join(BACKUPS_DIR, "latest-staff-backup.json"), JSON.stringify(payload, null, 2), "utf-8");
      await fs.writeFile(PERMANENT_STAFF_FILE, JSON.stringify(users, null, 2), "utf-8");
      console.log(`[PERMANENT STAFF DB] Created staff backup ${backupFilename} and updated ${PERMANENT_STAFF_FILE}`);
    } catch (err: any) {
      console.error("[PERMANENT STAFF DB] Error in backupAndSyncPermanentStaff:", err.message);
    }
  }

  // Auto-backup configuration state (Default 5-minute automated snapshot schedule)
  let autoBackupSettings = {
    enabled: true,
    intervalMinutes: 5,
    lastBackupTime: null as string | null,
    nextBackupTime: null as string | null,
    retentionCount: 5000 // Permanent retention: backups are preserved and never auto-deleted
  };

  // Ensure necessary directories exist synchronously or on boot
  try {
    if (!fsSync.existsSync(DATA_DIR)) fsSync.mkdirSync(DATA_DIR, { recursive: true });
    if (!fsSync.existsSync(BACKUPS_DIR)) fsSync.mkdirSync(BACKUPS_DIR, { recursive: true });
    if (!fsSync.existsSync(UPLOADS_DIR)) fsSync.mkdirSync(UPLOADS_DIR, { recursive: true });
    if (!fsSync.existsSync(ATTACHMENTS_DIR)) fsSync.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
  } catch (err) {
    console.error("Error creating system directories:", err);
  }

  async function loadData() {
    let loadedContent: any = null;
    let loadedFrom: string = '';

    // 0. Primary Authoritative Source: Attempt to load from Local MySQL Database (when configured)
    try {
      initMysqlPool();
      const mysqlData = await loadMysqlProductionData();
      if (mysqlData && Array.isArray(mysqlData.users) && mysqlData.users.length > 0) {
        console.log(`[MYSQL RECOVERY] Production data loaded from MySQL (${mysqlData.users.length} users, ${mysqlData.tasks?.length || 0} tasks)`);
        loadedContent = mysqlData;
        loadedFrom = 'MYSQL_LOCAL';
      }
    } catch (mysqlErr: any) {
      console.warn('[MYSQL RECOVERY] Could not load from MySQL, falling back to local disk cache:', mysqlErr.message);
    }

    // Inspect local DB_FILE (data/db.json) and merge with cloud data
    try {
      if (fsSync.existsSync(DB_FILE)) {
        const dbContent = await fs.readFile(DB_FILE, "utf-8");
        const parsedDb = JSON.parse(dbContent);
        if (parsedDb && typeof parsedDb === 'object') {
          if (!loadedContent) {
            loadedContent = parsedDb;
            loadedFrom = DB_FILE;
          } else {
            console.log(`[DATA MERGE] Merging primary MySQL state (${(loadedContent.tasks || []).length} tasks, ${(loadedContent.users || []).length} users) with local disk state (${(parsedDb.tasks || []).length} tasks, ${(parsedDb.users || []).length} users)...`);
            
            // Merge tasks by id
            const taskMap = new Map<string, any>();
            (loadedContent.tasks || []).forEach((t: any) => {
              const id = String(t.id || t.taskId || '').trim();
              if (id) taskMap.set(id, t);
            });
            (parsedDb.tasks || []).forEach((lt: any) => {
              const id = String(lt.id || lt.taskId || '').trim();
              if (!id) return;
              if (!taskMap.has(id)) {
                taskMap.set(id, lt);
              } else {
                const existing = taskMap.get(id);
                const extTime = new Date(existing.updatedAt || existing.completedAt || existing.createdAt || 0).getTime();
                const locTime = new Date(lt.updatedAt || lt.completedAt || lt.createdAt || 0).getTime();
                if (locTime >= extTime) {
                  taskMap.set(id, { ...existing, ...lt });
                }
              }
            });

            // Merge deletedTaskIds tombstones
            const mergedDeletedIds = Array.from(new Set([
              ...(Array.isArray(loadedContent.deletedTaskIds) ? loadedContent.deletedTaskIds : []),
              ...(Array.isArray(parsedDb.deletedTaskIds) ? parsedDb.deletedTaskIds : [])
            ]));
            const delSet = new Set(mergedDeletedIds.map(String));

            loadedContent.tasks = Array.from(taskMap.values()).filter(t => {
              const id = String(t.id || '').trim();
              const taskId = String(t.taskId || '').trim();
              return (!id || !delSet.has(id)) && (!taskId || !delSet.has(taskId));
            });
            loadedContent.deletedTaskIds = mergedDeletedIds;

            // Merge users
            const userMap = new Map<string, any>();
            (loadedContent.users || []).forEach((u: any) => {
              const empId = String(u.employeeId || u.id || '').trim();
              if (empId) userMap.set(empId, u);
            });
            (parsedDb.users || []).forEach((u: any) => {
              const empId = String(u.employeeId || u.id || '').trim();
              if (empId && !userMap.has(empId)) userMap.set(empId, u);
            });
            loadedContent.users = Array.from(userMap.values());

            console.log(`[DATA MERGE] Merge result: ${loadedContent.tasks.length} tasks and ${loadedContent.users.length} users preserved.`);
          }
        }
      }
    } catch (dbErr: any) {
      console.warn('[DATA RECOVERY] Error inspecting DB_FILE:', dbErr.message);
    }

    // 1. Inspect primary DATA_FILE (data.json) and merge with loadedContent
    try {
      if (fsSync.existsSync(DATA_FILE)) {
        const content = await fs.readFile(DATA_FILE, "utf-8");
        const parsedData = JSON.parse(content);
        if (parsedData && typeof parsedData === 'object') {
          if (!loadedContent) {
            loadedContent = parsedData;
            loadedFrom = DATA_FILE;
          } else {
            console.log(`[DATA MERGE] Merging DATA_FILE (${(parsedData.tasks || []).length} tasks, ${(parsedData.users || []).length} users)...`);
            const taskMap = new Map<string, any>();
            (loadedContent.tasks || []).forEach((t: any) => {
              const id = String(t.id || t.taskId || '').trim();
              if (id) taskMap.set(id, t);
            });
            (parsedData.tasks || []).forEach((lt: any) => {
              const id = String(lt.id || lt.taskId || '').trim();
              if (!id) return;
              if (!taskMap.has(id)) {
                taskMap.set(id, lt);
              } else {
                const existing = taskMap.get(id);
                const extTime = new Date(existing.updatedAt || existing.completedAt || existing.createdAt || 0).getTime();
                const locTime = new Date(lt.updatedAt || lt.completedAt || lt.createdAt || 0).getTime();
                if (locTime >= extTime) {
                  taskMap.set(id, { ...existing, ...lt });
                }
              }
            });
            const mergedDeletedIds = Array.from(new Set([
              ...(Array.isArray(loadedContent.deletedTaskIds) ? loadedContent.deletedTaskIds : []),
              ...(Array.isArray(parsedData.deletedTaskIds) ? parsedData.deletedTaskIds : [])
            ]));
            const delSet = new Set(mergedDeletedIds.map(String));
            loadedContent.tasks = Array.from(taskMap.values()).filter(t => {
              const id = String(t.id || '').trim();
              const taskId = String(t.taskId || '').trim();
              return (!id || !delSet.has(id)) && (!taskId || !delSet.has(taskId));
            });
            loadedContent.deletedTaskIds = mergedDeletedIds;
          }
        }
      }
    } catch (err: any) {
      console.error(`Error inspecting ${DATA_FILE}:`, err.message);
    }

    // 3. Fallback to DATA_FILE.bak if primary files could not be loaded
    if (!loadedContent) {
      try {
        const bakFile = DATA_FILE + ".bak";
        if (fsSync.existsSync(bakFile)) {
          const content = await fs.readFile(bakFile, "utf-8");
          const parsed = JSON.parse(content);
          if (parsed && typeof parsed === 'object') {
            loadedContent = parsed;
            loadedFrom = bakFile;
            console.log(`[AUTO-RECOVERY] Recovered database state from backup ${bakFile}!`);
          }
        }
      } catch (bakErr: any) {
        console.warn("Could not check backup file:", bakErr.message);
      }
    }

    // 4. ONLY if neither DATA_FILE, DB_FILE, nor .bak could be loaded, inspect recent backups
    if (!loadedContent) {
      try {
        const latestBackup = path.join(BACKUPS_DIR, 'latest-hourly-db.json');
        if (fsSync.existsSync(latestBackup)) {
          const content = await fs.readFile(latestBackup, "utf-8");
          const parsed = JSON.parse(content);
          if (parsed && typeof parsed === 'object') {
            loadedContent = parsed;
            loadedFrom = latestBackup;
            console.log(`[AUTO-RECOVERY] Recovered database state from backup ${latestBackup}!`);
          }
        }
      } catch (backupErr: any) {
        console.warn("Could not check latest backup:", backupErr.message);
      }
    }

    if (loadedContent) {
      // Permanent Staff Database: Authoritative permanent database for staff management
      try {
        if (fsSync.existsSync(PERMANENT_STAFF_FILE)) {
          const staffRaw = await fs.readFile(PERMANENT_STAFF_FILE, 'utf-8');
          const parsedStaff = JSON.parse(staffRaw);
          if (Array.isArray(parsedStaff) && parsedStaff.length > 0) {
            loadedContent.users = parsedStaff;
            console.log(`[PERMANENT STAFF DB] Enforced authoritative permanent staff database from ${PERMANENT_STAFF_FILE} (${parsedStaff.length} employees)`);
          }
        } else if (Array.isArray(loadedContent.users) && loadedContent.users.length > 0) {
          // Initialize permanent staff file from current users
          await fs.writeFile(PERMANENT_STAFF_FILE, JSON.stringify(loadedContent.users, null, 2), 'utf-8');
          console.log(`[PERMANENT STAFF DB] Initialized permanent staff file ${PERMANENT_STAFF_FILE} with ${loadedContent.users.length} employees`);
        }
      } catch (err: any) {
        console.warn("[PERMANENT STAFF DB] Error handling permanent staff file:", err.message);
      }

      // User preservation fallback: only run if permanent staff file does NOT exist
      if (!fsSync.existsSync(PERMANENT_STAFF_FILE)) {
        try {
          const latestBackupPath = path.join(BACKUPS_DIR, 'latest-backup.json');
          if (fsSync.existsSync(latestBackupPath)) {
            const backupRaw = await fs.readFile(latestBackupPath, 'utf-8');
            const backupParsed = JSON.parse(backupRaw);
            if (Array.isArray(backupParsed.users) && backupParsed.users.length > 0) {
              const currentUsers = loadedContent.users || [];
              const currentEmpIds = new Set(currentUsers.map((u: any) => String(u.employeeId || '').toLowerCase().trim()));
              let mergedUsers = false;
              for (const bUser of backupParsed.users) {
                const bEmpId = String(bUser.employeeId || '').toLowerCase().trim();
                if (bEmpId && !currentEmpIds.has(bEmpId)) {
                  currentUsers.push(bUser);
                  currentEmpIds.add(bEmpId);
                  mergedUsers = true;
                }
              }
              if (mergedUsers) {
                console.log(`[USER ROSTER PROTECTION] Restored missing employee profiles from latest-backup.json. Total users: ${currentUsers.length}`);
                loadedContent.users = currentUsers;
              }
            }
          }
        } catch (err: any) {
          console.warn("[USER ROSTER PROTECTION] Error checking backup user roster:", err.message);
        }
      }

      // Enforce deletedTaskIds tombstone policy: never resurrect deleted tasks
      if (Array.isArray(loadedContent.deletedTaskIds) && loadedContent.deletedTaskIds.length > 0) {
        const delSet = new Set(loadedContent.deletedTaskIds.map((id: any) => String(id).trim()));
        if (Array.isArray(loadedContent.tasks)) {
          const originalCount = loadedContent.tasks.length;
          loadedContent.tasks = loadedContent.tasks.filter((t: any) => {
            const id = String(t.id || '').trim();
            const taskId = String(t.taskId || '').trim();
            return (!id || !delSet.has(id)) && (!taskId || !delSet.has(taskId));
          });
          if (loadedContent.tasks.length < originalCount) {
            console.log(`[TOMBSTONE FILTER] Filtered out ${originalCount - loadedContent.tasks.length} deleted tasks matching deletedTaskIds tombstone.`);
          }
        }
      }

      console.log(`Successfully loaded database state from ${loadedFrom} (Tasks: ${loadedContent.tasks?.length || 0}, Users: ${loadedContent.users?.length || 0})`);
      if (Array.isArray(loadedContent.tasks)) {
        loadedContent.tasks.forEach((t: any) => {
          if (t && t.status === 'HOLD' && !t.currentHoldStartTime) {
            let recoveredTime: string | null = null;
            if (Array.isArray(t.logs)) {
              const holdLog = [...t.logs].reverse().find((l: any) =>
                l.action && String(l.action).toLowerCase().includes('hold')
              );
              if (holdLog?.timestamp) {
                recoveredTime = holdLog.timestamp;
              }
            }
            t.currentHoldStartTime = recoveredTime || t.startedAt || t.createdAt || new Date().toISOString();
            console.log(`[HOLD TIME PROTECTION] Populated hold start time for task ${t.id || t.taskId} (${t.title}): ${t.currentHoldStartTime}`);
          }
        });
      }
      if (loadedContent.autoBackupSettings) {
        autoBackupSettings = { ...autoBackupSettings, ...loadedContent.autoBackupSettings };
      }
      return loadedContent;
    }

    console.warn("No existing data found in data.json, data/db.json, or backups. Initializing with empty state.");
    return { 
      users: [], 
      tasks: [], 
      deletedTaskIds: [],
      attendanceRecords: [], 
      notifications: [], 
      pointTransactions: [], 
      technicianPerformance: [], 
      assignmentRequests: [],
      activityLogs: [],
      adminAuditLogs: [],
      userSessions: [],
      failedLoginAttempts: [],
      lockedDevices: []
    };
  }

  function parseTaskDate(dateStr?: string): Date {
    if (!dateStr) return new Date(NaN);
    const trimmed = String(dateStr).trim();
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) {
      return new Date(`${trimmed}+06:00`);
    }
    return new Date(trimmed);
  }

  function parseTaskDurationMins(dur?: string): number {
    if (!dur) return 60;
    const str = String(dur).trim();
    if (/^\d+$/.test(str)) return parseInt(str, 10) || 60;
    let mins = 0;
    const dMatch = str.match(/(\d+)\s*d/i);
    const hMatch = str.match(/(\d+)\s*h/i);
    const mMatch = str.match(/(\d+)\s*m/i);
    if (dMatch) mins += parseInt(dMatch[1], 10) * 24 * 60;
    if (hMatch) mins += parseInt(hMatch[1], 10) * 60;
    if (mMatch) mins += parseInt(mMatch[1], 10);
    if (mins === 0) {
      const numMatch = str.match(/(\d+)/);
      if (numMatch) mins = parseInt(numMatch[1], 10);
    }
    return mins || 60;
  }

  function getTaskHoldMs(taskObj: any, currentOrEndTime?: Date): number {
    let holdMs = Number(taskObj.totalHoldMs) || ((Number(taskObj.totalHoldMinutes) || 0) * 60 * 1000);
    
    // If task is currently on HOLD, add the ongoing hold time
    if (taskObj.status === 'HOLD') {
      let holdStartMs = 0;
      if (taskObj.currentHoldStartTime) {
        const hStart = parseTaskDate(taskObj.currentHoldStartTime);
        if (!isNaN(hStart.getTime())) holdStartMs = hStart.getTime();
      }
      if (!holdStartMs && Array.isArray(taskObj.holdHistory) && taskObj.holdHistory.length > 0) {
        const lastH = taskObj.holdHistory[taskObj.holdHistory.length - 1];
        if (lastH?.holdStart) {
          const hStart = parseTaskDate(lastH.holdStart);
          if (!isNaN(hStart.getTime())) holdStartMs = hStart.getTime();
        }
      }
      if (!holdStartMs && Array.isArray(taskObj.logs)) {
        const holdLog = [...taskObj.logs].reverse().find((l: any) =>
          l.action && String(l.action).toLowerCase().includes('hold')
        );
        if (holdLog?.timestamp) {
          const hStart = parseTaskDate(holdLog.timestamp);
          if (!isNaN(hStart.getTime())) holdStartMs = hStart.getTime();
        }
      }
      if (!holdStartMs) {
        const start = parseTaskDate(taskObj.startedAt || taskObj.createdAt);
        if (!isNaN(start.getTime())) holdStartMs = start.getTime();
      }

      if (holdStartMs) {
        const refTime = currentOrEndTime || new Date();
        const ongoingHoldMs = Math.max(0, refTime.getTime() - holdStartMs);
        holdMs += ongoingHoldMs;
      }
    }
    return holdMs;
  }

  function computeTaskTiming(taskObj: any, referenceDate?: Date) {
    const startRaw = taskObj.customStartTime || taskObj.startedAt || taskObj.createdAt;
    const endRaw = taskObj.actualCompletionTime || taskObj.completedAt;
    const start = parseTaskDate(startRaw);
    const end = parseTaskDate(endRaw);

    const result = calculateTaskWorkingTime(taskObj, {
      now: referenceDate || new Date(),
      attendanceRecords,
      overtimeRequests,
      shiftAssignments: technicianShiftAssignments,
      shifts: shiftConfigurations.length > 0 ? shiftConfigurations : DEFAULT_SHIFTS,
      technicians: users
    });

    const taskTakenTime = formatMinutes(result.accumulatedWorkingMinutes);
    const remainingTime = formatMinutes(result.remainingMinutes);
    const overTime = formatMinutes(result.overTimeMinutes);

    return {
      ...result,
      taskTakenTime,
      remainingTime,
      overTime,
      actualMinutes: result.accumulatedWorkingMinutes,
      estimatedMinutes: result.estimatedMinutes,
      start,
      end: !isNaN(end.getTime()) ? end : (referenceDate || new Date())
    };
  }

  function decorateTaskWithTiming(taskObj: any) {
    if (!taskObj) return taskObj;
    const timing = computeTaskTiming(taskObj);
    return {
      ...taskObj,
      originalEstimatedDuration: taskObj.originalEstimatedDuration || taskObj.estimatedDuration || '',
      revisedEstimatedDuration: taskObj.revisedEstimatedDuration || taskObj.estimatedDuration || '',
      taskTakenTime: timing.taskTakenTime,
      remainingTime: timing.remainingTime,
      overTime: timing.overTime,
      timerStatus: timing.timerStatus,
      assignedShiftCode: timing.activeShift?.code || taskObj.assignedShiftCode || 'SHIFT_B',
      accumulatedWorkingMinutes: timing.accumulatedWorkingMinutes,
      accumulatedOvertimeMinutes: timing.accumulatedOvertimeMinutes,
      approvedOvertimeMinutes: timing.approvedOvertimeMinutes,
      isTimeExceeded: timing.isTimeExceeded,
      timeExceededMinutes: timing.overTimeMinutes
    };
  }

  function recalculateAllPoints() {
    console.log("Recalculating all points and task counts...");
    
    // 1. Preserve manual adjustments
    const manualAdjustments = pointTransactions.filter((pt: any) => pt.taskId === 'MANUAL_ADJUSTMENT');
    
    // 2. Reset all users
    users.forEach((u: any) => {
      u.total_point = 0;
      u.completedTask = 0;
    });

    // 3. Clear and rebuild task-based transactions
    pointTransactions.length = 0;
    pointTransactions.push(...manualAdjustments);

    // Create a map for faster user lookups
    const userMap = new Map();
    users.forEach(u => {
      userMap.set(u.employeeId, u);
      userMap.set(u.id, u);
      if (u.name) userMap.set(u.name, u);
    });

    // Pre-index technicianPerformance by taskId for O(1) instant lookups
    const tpByTaskId = new Map<string, any[]>();
    technicianPerformance.forEach((tp: any) => {
      const tid = String(tp.taskId || '').trim();
      if (!tpByTaskId.has(tid)) tpByTaskId.set(tid, []);
      tpByTaskId.get(tid)!.push(tp);
    });

    // 4. Process all tasks
    tasks.forEach((t: any) => {
      // Normalize assignedTo if stored as internal user.id
      if (t.assignedTo) {
        const matchedAssignee = userMap.get(t.assignedTo);
        if (matchedAssignee && matchedAssignee.name) {
          t.assignedTo = matchedAssignee.name;
        }
      }

      const status = (t.status || '').toUpperCase();
      const isCompleted = status === 'COMPLETED';
      if (isCompleted) {
        const timing = computeTaskTiming(t);
        t.taskTakenTime = timing.taskTakenTime;
        t.remainingTime = timing.remainingTime;
        t.overTime = timing.overTime;

        // Keep technicianPerformance records in sync with corrected timing
        const matchedTps = tpByTaskId.get(String(t.id || '').trim()) || [];
        matchedTps.forEach((tp: any) => {
          tp.totalWorkMinutes = timing.actualMinutes;
          tp.estimatedMinutes = timing.estimatedMinutes;
          const efficiency = timing.actualMinutes > 0 ? (timing.estimatedMinutes / timing.actualMinutes) * 100 : 100;
          const speedScore = efficiency > 120 ? 15 : (efficiency < 80 ? 5 : 10);
          tp.completionSpeedScore = speedScore;
          tp.efficiencyScore = Math.min(Math.round(efficiency / 2), 50);
          tp.finalDailyScore = Math.min(Math.round(efficiency / 2) + (tp.attendanceScore || 10) + speedScore, 100);
        });
      }
      
      // Points criteria: COMPLETED and (engineer approved for Officer tasks, or valid non-rejected task for management/engineers)
      const creator = userMap.get(t.createdBy);
      const isOfficerCreated = creator?.role === 'OFFICER' || (!creator && t.responsibleOfficerId && userMap.get(t.responsibleOfficerId)?.role === 'OFFICER');

      let isPointEligible = false;
      if (isOfficerCreated) {
        // STRICT REQUIREMENT: For ANY task created by an Officer (Single or Team),
        // no performance points can be awarded until the authorized Concern Engineer explicitly recommends/approves it (engineerApproved = true).
        // Team borrowing approvals or task completions cannot bypass this.
        isPointEligible = Boolean(t.engineerApproved);
      } else {
        isPointEligible = t.requestStatus !== 'REJECTED';
      }

      if (isCompleted) {
        // Technician Task Count & Points (deduplicating technicians per task)
        const participatingTechIds = new Set<string>();
        if (t.assignedTo) {
          const tech = userMap.get(t.assignedTo);
          if (tech && tech.role === 'TECHNICIAN') {
            participatingTechIds.add(tech.employeeId);
          }
        }
        if (t.assignedTechnicians && Array.isArray(t.assignedTechnicians)) {
          t.assignedTechnicians.forEach((at: any) => {
            const tech = userMap.get(at.employeeId);
            if (tech && tech.role === 'TECHNICIAN') {
              participatingTechIds.add(tech.employeeId);
            }
          });
        }

        const rawPoints = Number(t.points) || 1;
        const techCount = participatingTechIds.size || 1;
        participatingTechIds.forEach(techEmpId => {
          const tech = userMap.get(techEmpId);
          if (tech && tech.role === 'TECHNICIAN') {
            tech.completedTask = (tech.completedTask || 0) + 1;
            if (isPointEligible) {
              const techPointAward = t.workType === 'TEAM' && techCount > 1
                ? Math.max(1, Math.round(rawPoints / techCount))
                : rawPoints;
              tech.total_point = (tech.total_point || 0) + techPointAward;
            }
          }
        });

        // Officer Points (Rule 10 & 21: Cross-team technician rule)
        // Task creator / responsible Officer is the source of Officer-side attribution.
        // Borrowed technician's supervisor NEVER receives points for another Officer's task.
        if (isPointEligible) {
          let assignedOfficer = null;
          if (t.responsibleOfficerId) {
            const respOff = userMap.get(t.responsibleOfficerId);
            if (respOff?.role === 'OFFICER') {
              assignedOfficer = respOff;
            }
          }
          if (!assignedOfficer && creator?.role === 'OFFICER') {
            assignedOfficer = creator;
          }
          if (!assignedOfficer && t.assignedBy) {
            const assigner = userMap.get(t.assignedBy);
            if (assigner?.role === 'OFFICER') {
              assignedOfficer = assigner;
            }
          }
          if (!assignedOfficer && t.assignedTo) {
            const assigneeUser = userMap.get(t.assignedTo);
            if (assigneeUser?.role === 'OFFICER') {
              assignedOfficer = assigneeUser;
            }
          }

          if (assignedOfficer) {
            const pointValue = Number(t.points) || 1;
            assignedOfficer.total_point = (assignedOfficer.total_point || 0) + pointValue;
            
            // Add to transactions with deterministic ID to prevent duplicates
            const txId = `pt_${t.id}_${assignedOfficer.employeeId || assignedOfficer.id}`;
            pointTransactions.push({
              id: txId,
              taskId: t.id,
              officerId: assignedOfficer.id,
              engineerId: t.approvedBy || (creator?.role !== 'OFFICER' ? creator?.employeeId : '') || '',
              pointValue: pointValue,
              taskPriority: t.urgency,
              completedAt: t.completedAt || t.createdAt
            });
          }

          // Hierarchical roll-up attribution (without duplicating source transactions)
          // ONLY attribute to the specific Engineer who created, assigned, or approved this task
          const pointVal = Number(t.points) || 1;
          let concernEng = null;
          if (creator?.role === 'ENGINEER') {
            concernEng = creator;
          } else if (t.assignedBy) {
            const assignerUser = userMap.get(t.assignedBy);
            if (assignerUser?.role === 'ENGINEER') concernEng = assignerUser;
          }
          if (!concernEng && t.assignedTo) {
            const assigneeUser = userMap.get(t.assignedTo);
            if (assigneeUser?.role === 'ENGINEER') concernEng = assigneeUser;
          }
          if (!concernEng && t.approvedBy) {
            const appUser = userMap.get(t.approvedBy);
            if (appUser?.role === 'ENGINEER') concernEng = appUser;
          }
          if (!concernEng && t.recommendedBy) {
            const recUser = userMap.get(t.recommendedBy);
            if (recUser?.role === 'ENGINEER') concernEng = recUser;
          }
          if (!concernEng && t.concernEngineerId) {
            const ceUser = userMap.get(t.concernEngineerId);
            if (ceUser?.role === 'ENGINEER') concernEng = ceUser;
          }
          if (!concernEng && creator?.role === 'OFFICER') {
            if (Array.isArray(creator.assignedEngineers) && creator.assignedEngineers.length > 0) {
              const ceUser = userMap.get(creator.assignedEngineers[0]);
              if (ceUser?.role === 'ENGINEER') concernEng = ceUser;
            }
          }
          if (concernEng && concernEng.role === 'ENGINEER') {
            concernEng.total_point = (concernEng.total_point || 0) + pointVal;
            concernEng.completedTask = (concernEng.completedTask || 0) + 1;
          }

          let modelMgr = t.modelManagerId ? userMap.get(t.modelManagerId) : null;
          if (!modelMgr) {
            modelMgr = users.find(u => u.role === 'MODEL_MANAGER' && (
              (concernEng && (u.assignedEngineers || []).includes(concernEng.employeeId)) ||
              (u.section && t.model && u.section.toLowerCase() === t.model.toLowerCase())
            ));
          }
          if (modelMgr && modelMgr.role === 'MODEL_MANAGER') {
            modelMgr.total_point = (modelMgr.total_point || 0) + pointVal;
          }

          let inChargeUser = t.inChargeId ? userMap.get(t.inChargeId) : null;
          if (!inChargeUser) {
            inChargeUser = users.find(u => u.role === 'IN_CHARGE' && (
              (modelMgr && (u.assignedEngineers || []).includes(modelMgr.employeeId)) ||
              (concernEng && (u.assignedEngineers || []).includes(concernEng.employeeId))
            )) || users.find(u => u.role === 'IN_CHARGE');
          }
          if (inChargeUser && inChargeUser.role === 'IN_CHARGE') {
            inChargeUser.total_point = (inChargeUser.total_point || 0) + pointVal;
          }

          const dhodUser = users.find(u => u.role === 'DHOD' || u.employeeId === '17668');
          if (dhodUser) {
            dhodUser.total_point = (dhodUser.total_point || 0) + pointVal;
          }

          const hodUser = users.find(u => u.role === 'HOD' || u.employeeId === '19219');
          if (hodUser) {
            hodUser.total_point = (hodUser.total_point || 0) + pointVal;
          }
        }
      }
    });

    // 5. Apply manual adjustments to user totals
    manualAdjustments.forEach((pt: any) => {
      const user = userMap.get(pt.officerId);
      if (user && user.role !== 'CBO' && user.role !== 'DCBO') {
        user.total_point = (user.total_point || 0) + (Number(pt.pointValue) || 0);
      }
    });

    // 6. Strict rule for CBO and DCBO: Personal Performance Points = 0
    users.forEach((u: any) => {
      if (u.role === 'CBO' || u.role === 'DCBO') {
        u.total_point = 0;
      }
    });

    console.log("Recalculation complete.");
  }

  // Calculate authoritative hierarchical performance & point rollups without double counting
  function getHierarchicalPerformanceData(filterMonth?: number, filterYear?: number) {
    const currentDate = new Date();
    const currentMonthNum = currentDate.getMonth() + 1;
    const currentYearNum = currentDate.getFullYear();
    const month = filterMonth || currentMonthNum;
    const year = filterYear || currentYearNum;
    const targetPrefix = `${year}-${String(month).padStart(2, '0')}`;

    // Filter tasks for the selected period
    const periodTasks = tasks.filter((t: any) => {
      if (!t) return false;
      if (t.createdAt && typeof t.createdAt === 'string' && t.createdAt.startsWith(targetPrefix)) return true;
      if (t.completedAt && typeof t.completedAt === 'string' && t.completedAt.startsWith(targetPrefix)) return true;
      if (t.deadline && typeof t.deadline === 'string' && t.deadline.startsWith(targetPrefix)) return true;
      if (t.createdAt) {
        const d = new Date(t.createdAt);
        if (d.getMonth() + 1 === month && d.getFullYear() === year) return true;
      }
      if (t.deadline) {
        const d = new Date(t.deadline);
        if (d.getMonth() + 1 === month && d.getFullYear() === year) return true;
      }
      return false;
    });

    const userMap = new Map<string, any>();
    const empMap = new Map<string, any>();
    users.forEach(u => {
      userMap.set(u.id, u);
      empMap.set(u.employeeId, u);
    });

    // Build verified tasks and trace hierarchical relationships
    const verifiedTasksAudit: any[] = [];
    const officerTasksMap = new Map<string, any[]>();
    const engineerTasksMap = new Map<string, any[]>();
    const modelManagerTasksMap = new Map<string, any[]>();
    const inChargeTasksMap = new Map<string, any[]>();
    const dhodTasksMap = new Map<string, any[]>();
    const hodTasksMap = new Map<string, any[]>();

    periodTasks.forEach((t: any) => {
      const status = (t.status || '').toUpperCase();
      const isCompleted = status === 'COMPLETED';
      const creator = empMap.get(t.createdBy) || userMap.get(t.createdBy);
      const isOfficerCreated = creator?.role === 'OFFICER' || (!creator && t.responsibleOfficerId && (empMap.get(t.responsibleOfficerId)?.role === 'OFFICER' || userMap.get(t.responsibleOfficerId)?.role === 'OFFICER'));
      let isPointEligible = false;
      if (isOfficerCreated) {
        isPointEligible = Boolean(t.engineerApproved);
      } else {
        isPointEligible = t.requestStatus !== 'REJECTED';
      }

      if (isCompleted && isPointEligible) {
        const pointValue = Number(t.points) || 1;

        // Technician
        let techUser = null;
        if (t.assignedTo) {
          techUser = empMap.get(t.assignedTo) || userMap.get(t.assignedTo) || users.find(u => u.name === t.assignedTo);
        } else if (t.workType === 'TEAM' && Array.isArray(t.assignedTechnicians) && t.assignedTechnicians.length > 0) {
          techUser = empMap.get(t.assignedTechnicians[0].employeeId);
        }

        // Responsible Officer (Rule 21: Task creator / assignedBy is the source)
        // Borrowed technician's supervisor NEVER receives points for another Officer's task.
        let responsibleOfficer = null;
        if (t.responsibleOfficerId) {
          responsibleOfficer = empMap.get(t.responsibleOfficerId) || userMap.get(t.responsibleOfficerId);
        } else if (creator?.role === 'OFFICER') {
          responsibleOfficer = creator;
        } else if (t.assignedBy) {
          const assigner = empMap.get(t.assignedBy) || userMap.get(t.assignedBy);
          if (assigner?.role === 'OFFICER') responsibleOfficer = assigner;
        } else if (t.assignedTo) {
          const assignee = empMap.get(t.assignedTo) || userMap.get(t.assignedTo);
          if (assignee?.role === 'OFFICER') responsibleOfficer = assignee;
        }

        // Concern Engineer (Rule 11: ONLY the specific Engineer who created, assigned, or approved the task)
        let concernEngineer = null;
        if (creator?.role === 'ENGINEER') {
          concernEngineer = creator;
        } else if (t.assignedBy) {
          const assigner = empMap.get(t.assignedBy) || userMap.get(t.assignedBy);
          if (assigner?.role === 'ENGINEER') concernEngineer = assigner;
        }
        if (!concernEngineer && techUser?.role === 'ENGINEER') {
          concernEngineer = techUser;
        }
        if (!concernEngineer && t.approvedBy) {
          const approver = empMap.get(t.approvedBy) || userMap.get(t.approvedBy);
          if (approver?.role === 'ENGINEER') concernEngineer = approver;
        }
        if (!concernEngineer && t.recommendedBy) {
          const recommender = empMap.get(t.recommendedBy) || userMap.get(t.recommendedBy);
          if (recommender?.role === 'ENGINEER') concernEngineer = recommender;
        }
        if (!concernEngineer && t.concernEngineerId) {
          const ce = empMap.get(t.concernEngineerId) || userMap.get(t.concernEngineerId);
          if (ce?.role === 'ENGINEER') concernEngineer = ce;
        }

        // Model Manager (Rule 12)
        let modelManager = null;
        if (t.modelManagerId) {
          modelManager = empMap.get(t.modelManagerId) || userMap.get(t.modelManagerId);
        } else {
          modelManager = users.find(u => u.role === 'MODEL_MANAGER' && (
            (concernEngineer && (u.assignedEngineers || []).includes(concernEngineer.employeeId)) ||
            (u.section && t.model && u.section.toLowerCase() === t.model.toLowerCase())
          ));
        }

        // In-Charge (Rule 13)
        let inCharge = null;
        if (t.inChargeId) {
          inCharge = empMap.get(t.inChargeId) || userMap.get(t.inChargeId);
        } else {
          inCharge = users.find(u => u.role === 'IN_CHARGE' && (
            (modelManager && (u.assignedEngineers || []).includes(modelManager.employeeId)) ||
            (concernEngineer && (u.assignedEngineers || []).includes(concernEngineer.employeeId))
          ));
          if (!inCharge) {
            inCharge = users.find(u => u.role === 'IN_CHARGE');
          }
        }

        // DHOD (Rule 14: Abdul Aowal 17668)
        let dhod = users.find(u => u.role === 'DHOD' || u.employeeId === '17668');

        // HOD (Rule 15: Ariful Islam 19219)
        let hod = users.find(u => u.role === 'HOD' || u.employeeId === '19219');

        const auditItem = {
          taskId: t.id,
          taskCode: t.taskId,
          title: t.title,
          model: t.model,
          urgency: t.urgency,
          verifiedPoints: pointValue,
          completedAt: t.completedAt || t.createdAt,
          technician: techUser ? { employeeId: techUser.employeeId, name: techUser.name } : null,
          officer: responsibleOfficer ? { employeeId: responsibleOfficer.employeeId, name: responsibleOfficer.name } : null,
          engineer: concernEngineer ? { employeeId: concernEngineer.employeeId, name: concernEngineer.name } : null,
          modelManager: modelManager ? { employeeId: modelManager.employeeId, name: modelManager.name } : null,
          inCharge: inCharge ? { employeeId: inCharge.employeeId, name: inCharge.name } : null,
          dhod: dhod ? { employeeId: dhod.employeeId, name: dhod.name } : null,
          hod: hod ? { employeeId: hod.employeeId, name: hod.name } : null
        };
        verifiedTasksAudit.push(auditItem);

        if (responsibleOfficer) {
          const arr = officerTasksMap.get(responsibleOfficer.employeeId) || [];
          arr.push(auditItem);
          officerTasksMap.set(responsibleOfficer.employeeId, arr);
        }
        if (concernEngineer) {
          const arr = engineerTasksMap.get(concernEngineer.employeeId) || [];
          arr.push(auditItem);
          engineerTasksMap.set(concernEngineer.employeeId, arr);
        }
        if (modelManager) {
          const arr = modelManagerTasksMap.get(modelManager.employeeId) || [];
          arr.push(auditItem);
          modelManagerTasksMap.set(modelManager.employeeId, arr);
        }
        if (inCharge) {
          const arr = inChargeTasksMap.get(inCharge.employeeId) || [];
          arr.push(auditItem);
          inChargeTasksMap.set(inCharge.employeeId, arr);
        }
        if (dhod) {
          const arr = dhodTasksMap.get(dhod.employeeId) || [];
          arr.push(auditItem);
          dhodTasksMap.set(dhod.employeeId, arr);
        }
        if (hod) {
          const arr = hodTasksMap.get(hod.employeeId) || [];
          arr.push(auditItem);
          hodTasksMap.set(hod.employeeId, arr);
        }
      }
    });

    const userMetrics: Record<string, any> = {};
    const totalEnterprisePoints = verifiedTasksAudit.reduce((sum, item) => sum + item.verifiedPoints, 0);

    users.forEach(u => {
      const empId = u.employeeId;
      const name = u.name;
      const id = u.id;

      const personTasks = periodTasks.filter((t: any) => {
        if (t.assignedTo === empId || t.assignedTo === name || t.assignedTo === id) return true;
        if (t.workType === 'TEAM' && Array.isArray(t.assignedTechnicians) && t.assignedTechnicians.some((at: any) => at.employeeId === empId || at.name === name)) return true;
        if (t.createdBy === empId || t.createdBy === id || t.createdBy === name || t.assignedBy === empId) return true;
        if (u.role === 'ENGINEER') {
          if (t.approvedBy === empId || t.recommendedBy === empId || t.concernEngineerId === empId) return true;
        }
        if (u.role === 'IN_CHARGE') {
          if (u.section && t.details && t.details.includes(u.section)) return true;
          if (t.approvedBy === empId || t.recommendedBy === empId) return true;
        }
        if (u.role === 'MODEL_MANAGER') {
          if (u.section && t.model && t.model.toLowerCase() === u.section.toLowerCase()) return true;
        }
        if (u.role === 'DHOD' || u.role === 'HOD' || u.role === 'CBO' || u.role === 'DCBO' || u.role === 'SUPER_ADMIN') {
          return true;
        }
        return false;
      });

      const totalTasks = personTasks.length;
      const completed = personTasks.filter((t: any) => (t.status || '').toUpperCase() === 'COMPLETED').length;
      const running = personTasks.filter((t: any) => (t.status || '').toUpperCase() === 'RUNNING').length;
      const pending = personTasks.filter((t: any) => (t.status || '').toUpperCase() === 'PENDING').length;
      const hold = personTasks.filter((t: any) => (t.status || '').toUpperCase() === 'HOLD').length;
      const performancePercentage = totalTasks > 0 ? Math.round((completed / totalTasks) * 100 * 10) / 10 : 0;

      let personalPoints = 0;
      let managedPoints = 0;

      if (u.role === 'TECHNICIAN') {
        personTasks.forEach((t: any) => {
          const isComp = (t.status || '').toUpperCase() === 'COMPLETED';
          const tCreator = empMap.get(t.createdBy) || userMap.get(t.createdBy);
          const isOffCreated = tCreator?.role === 'OFFICER' || (!tCreator && t.responsibleOfficerId && (empMap.get(t.responsibleOfficerId)?.role === 'OFFICER' || userMap.get(t.responsibleOfficerId)?.role === 'OFFICER'));
          const isEligible = isOffCreated ? Boolean(t.engineerApproved) : t.requestStatus !== 'REJECTED';
          if (isComp && isEligible) {
            personalPoints += Number(t.points) || 1;
          }
        });
        managedPoints = 0;
      } else if (u.role === 'OFFICER') {
        const officerTasks = officerTasksMap.get(empId) || [];
        const pts = officerTasks.reduce((sum, item) => sum + item.verifiedPoints, 0);
        personalPoints = pts;
        managedPoints = pts;
      } else if (u.role === 'ENGINEER') {
        personalPoints = 0;
        const engTasks = engineerTasksMap.get(empId) || [];
        managedPoints = engTasks.reduce((sum, item) => sum + item.verifiedPoints, 0);
      } else if (u.role === 'MODEL_MANAGER') {
        personalPoints = 0;
        const mmTasks = modelManagerTasksMap.get(empId) || [];
        managedPoints = mmTasks.reduce((sum, item) => sum + item.verifiedPoints, 0);
      } else if (u.role === 'IN_CHARGE') {
        personalPoints = 0;
        const icTasks = inChargeTasksMap.get(empId) || [];
        managedPoints = icTasks.reduce((sum, item) => sum + item.verifiedPoints, 0);
      } else if (u.role === 'DHOD') {
        personalPoints = 0;
        const dhodTasks = dhodTasksMap.get(empId) || [];
        managedPoints = dhodTasks.reduce((sum, item) => sum + item.verifiedPoints, 0);
      } else if (u.role === 'HOD') {
        personalPoints = 0;
        const hodTasks = hodTasksMap.get(empId) || [];
        managedPoints = hodTasks.reduce((sum, item) => sum + item.verifiedPoints, 0);
      } else if (u.role === 'CBO' || u.role === 'DCBO') {
        personalPoints = 0;
        // Monitored Organizational Points only
        managedPoints = totalEnterprisePoints;
      } else {
        personalPoints = 0;
        managedPoints = totalEnterprisePoints;
      }

      userMetrics[empId] = {
        employeeId: empId,
        name: u.name,
        role: u.role,
        department: u.department,
        section: u.section,
        designation: u.designation,
        totalTasks,
        completed,
        running,
        pending,
        hold,
        performancePercentage,
        personalPoints,
        managedPoints
      };
    });

    return {
      month,
      year,
      totalVerifiedTasks: verifiedTasksAudit.length,
      totalVerifiedPoints: totalEnterprisePoints,
      userMetrics,
      auditTrail: verifiedTasksAudit
    };
  }

  let savePromise: Promise<void> = Promise.resolve();

  async function performDiskSave(): Promise<void> {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.mkdir(BACKUPS_DIR, { recursive: true });

      const dataToSave = {
        users,
        tasks,
        deletedTaskIds,
        attendanceRecords,
        notifications,
        pointTransactions,
        technicianPerformance,
        assignmentRequests,
        activityLogs,
        adminAuditLogs,
        userSessions,
        failedLoginAttempts,
        lockedDevices,
        shiftConfigurations,
        technicianShiftAssignments,
        taskTimeSessions,
        taskTimeExtensions,
        overtimeRequests,
        taskTimerAuditLogs,
        performanceConfig,
        autoBackupSettings,
        lastSavedAt: new Date().toISOString()
      };

      const jsonStr = JSON.stringify(dataToSave, null, 2);
      const uniqueSuffix = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;

      // 1-4. Ultra-fast parallel disk write to DATA_FILE, DB_FILE, bak, and permanent-staff
      const writeTasks: Promise<void>[] = [
        (async () => {
          const tmpDataFile = `${DATA_FILE}.${uniqueSuffix}.tmp`;
          await fs.writeFile(tmpDataFile, jsonStr, "utf-8");
          await fs.rename(tmpDataFile, DATA_FILE);
        })(),
        (async () => {
          const tmpDbFile = `${DB_FILE}.${uniqueSuffix}.tmp`;
          await fs.writeFile(tmpDbFile, jsonStr, "utf-8");
          await fs.rename(tmpDbFile, DB_FILE);
        })(),
        (async () => {
          const bakFile = DATA_FILE + ".bak";
          const tmpBakFile = `${bakFile}.${uniqueSuffix}.tmp`;
          await fs.writeFile(tmpBakFile, jsonStr, "utf-8");
          await fs.rename(tmpBakFile, bakFile);
        })()
      ];

      if (Array.isArray(users) && users.length > 0) {
        const staffJson = JSON.stringify(users, null, 2);
        writeTasks.push((async () => {
          const tmpStaffFile = `${PERMANENT_STAFF_FILE}.${uniqueSuffix}.tmp`;
          await fs.writeFile(tmpStaffFile, staffJson, "utf-8");
          await fs.rename(tmpStaffFile, PERMANENT_STAFF_FILE);
        })());
      }

      await Promise.all(writeTasks);

      // 5. Local MySQL Persistence: Triggered asynchronously in background without blocking API response
      triggerCloudSync();

    } catch (err) {
      console.error("[DATABASE ERROR] Failed to save data to disk:", err);
      throw err;
    }
  }

  // --- Background MySQL Synchronization Engine ---
  let isCloudSyncRunning = false;
  let hasPendingCloudSync = false;
  let cloudSyncTimer: NodeJS.Timeout | null = null;

  function triggerCloudSync() {
    if (!isMysqlEnabled()) {
      hasPendingCloudSync = false;
      return;
    }
    hasPendingCloudSync = true;
    if (cloudSyncTimer) return;
    
    // 100ms debounce consolidation for high throughput and zero UI stutter
    cloudSyncTimer = setTimeout(() => {
      cloudSyncTimer = null;
      runCloudSync().catch(err => {
        console.error("[MYSQL PERSISTENCE] Background sync failed:", err?.message || err);
      });
    }, 100);
  }

  async function runCloudSync() {
    if (isCloudSyncRunning) return;
    if (!isMysqlEnabled()) {
      hasPendingCloudSync = false;
      return;
    }
    if (!hasPendingCloudSync) return;

    isCloudSyncRunning = true;
    hasPendingCloudSync = false;

    try {
      await saveMysqlProductionData({
        users,
        tasks,
        deletedTaskIds,
        attendanceRecords,
        pointTransactions,
        technicianPerformance,
        assignmentRequests,
        notifications,
        activityLogs,
        adminAuditLogs,
        userSessions,
        failedLoginAttempts,
        lockedDevices,
        shiftConfigurations,
        technicianShiftAssignments,
        overtimeRequests,
        taskTimeExtensions,
        taskTimeSessions,
        taskTimerAuditLogs,
        performanceConfig,
        autoBackupSettings,
        lastSavedAt: new Date().toISOString()
      });
    } catch (dbSaveErr: any) {
      console.error("[MYSQL PERSISTENCE] Error saving to MySQL:", dbSaveErr?.message || dbSaveErr);
    } finally {
      isCloudSyncRunning = false;
      if (hasPendingCloudSync && isMysqlEnabled()) {
        triggerCloudSync();
      }
    }
  }

  async function flushCloudSync(): Promise<void> {
    if (!isMysqlEnabled()) return;
    if (cloudSyncTimer) {
      clearTimeout(cloudSyncTimer);
      cloudSyncTimer = null;
    }
    hasPendingCloudSync = true;
    while (isCloudSyncRunning || hasPendingCloudSync) {
      await runCloudSync();
      if (!hasPendingCloudSync && !isCloudSyncRunning) break;
      await new Promise(r => setTimeout(r, 50));
    }
  }

  function saveData(_allowEmpty?: boolean): Promise<void> {
    savePromise = savePromise.then(() => performDiskSave()).catch(err => {
      console.error("[DATABASE ERROR] Error in sequential save queue:", err);
    });
    return savePromise;
  }

  let lastAutoBackupHash = '';

  async function createHourlyBackup(
    isManualOrType: boolean | string = false,
    customType?: string,
    metaDetails?: Record<string, any>
  ) {
    try {
      const now = new Date();
      const currentDataHash = `${users.length}_${tasks.length}_${deletedTaskIds.length}_${attendanceRecords.length}_${pointTransactions.length}_${tasks.map(t => `${t.id}:${t.status}:${t.progress}:${t.completedAt || ''}`).join('|')}`;

      // If this is an automated timer backup and data is completely unchanged, skip redundant file generation and cloud writes
      if (!isManualOrType && lastAutoBackupHash && currentDataHash === lastAutoBackupHash) {
        autoBackupSettings.lastBackupTime = now.toISOString();
        autoBackupSettings.nextBackupTime = new Date(now.getTime() + (autoBackupSettings.intervalMinutes || 5) * 60 * 1000).toISOString();
        return {
          filename: 'latest-backup.json',
          timestamp: now.toISOString(),
          type: 'HOURLY_AUTO',
          size: 0,
          tasksCount: tasks.length,
          usersCount: users.length,
          details: { skipped: 'unchanged_dataset' },
          sourceFolder: 'backups/ (MySQL & Local Disk)'
        };
      }

      await fs.mkdir(BACKUPS_DIR, { recursive: true });
      await fs.mkdir(DATA_DIR, { recursive: true });

      lastAutoBackupHash = currentDataHash;
      const timeStr = now.toISOString().replace(/[:.]/g, '-');

      let backupType = 'HOURLY_AUTO';
      let filePrefix = 'db-backup-';

      if (typeof isManualOrType === 'string') {
        backupType = isManualOrType;
        if (isManualOrType === 'TASK_ENTRY') {
          filePrefix = 'db-backup-task-entry-';
        } else if (isManualOrType === 'TASK_DELETED') {
          filePrefix = 'db-backup-task-delete-';
        } else if (isManualOrType === 'MANUAL') {
          filePrefix = 'db-backup-manual-';
        } else {
          filePrefix = `db-backup-${isManualOrType.toLowerCase().replace(/_/g, '-')}-`;
        }
      } else if (isManualOrType === true) {
        backupType = customType || 'MANUAL';
        filePrefix = 'db-backup-manual-';
      }

      const filename = `${filePrefix}${timeStr}.json`;
      const filepath = path.join(BACKUPS_DIR, filename);

      const backupPayload = {
        users,
        tasks,
        deletedTaskIds,
        attendanceRecords,
        notifications,
        pointTransactions,
        technicianPerformance,
        assignmentRequests,
        activityLogs,
        adminAuditLogs,
        userSessions,
        failedLoginAttempts,
        lockedDevices,
        shiftConfigurations,
        technicianShiftAssignments,
        taskTimeSessions,
        taskTimeExtensions,
        overtimeRequests,
        taskTimerAuditLogs,
        performanceConfig,
        autoBackupSettings,
        lastSavedAt: now.toISOString(),
        backupMeta: {
          type: backupType,
          timestamp: now.toISOString(),
          tasksCount: tasks.length,
          usersCount: users.length,
          source: 'AUTO_BACKUP_SERVICE',
          sourceFolder: 'backups/',
          details: metaDetails || null
        }
      };

      const jsonStr = JSON.stringify(backupPayload, null, 2);
      const uniqueSuffix = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;

      // 1-2. Parallel backup file writes
      await Promise.all([
        (async () => {
          const tmpFile = `${filepath}.${uniqueSuffix}.tmp`;
          await fs.writeFile(tmpFile, jsonStr, 'utf-8');
          await fs.rename(tmpFile, filepath);
        })(),
        (async () => {
          const latestPath = path.join(BACKUPS_DIR, 'latest-hourly-db.json');
          const tmpLatest = `${latestPath}.${uniqueSuffix}.tmp`;
          await fs.writeFile(tmpLatest, jsonStr, 'utf-8');
          await fs.rename(tmpLatest, latestPath);
        })(),
        (async () => {
          const latestBackupPath = path.join(BACKUPS_DIR, 'latest-backup.json');
          const tmpLatestBackup = `${latestBackupPath}.${uniqueSuffix}.tmp`;
          await fs.writeFile(tmpLatestBackup, jsonStr, 'utf-8');
          await fs.rename(tmpLatestBackup, latestBackupPath);
        })()
      ]);

      // 3. Durable MySQL + Local Backup Snapshot (async in background)
      saveMysqlBackupSnapshot(backupPayload, backupType, metaDetails).catch((dbBackupErr: any) => {
        console.error("[MYSQL BACKUP] Error saving backup snapshot:", dbBackupErr?.message || dbBackupErr);
      });

      autoBackupSettings.lastBackupTime = now.toISOString();
      autoBackupSettings.nextBackupTime = new Date(now.getTime() + (autoBackupSettings.intervalMinutes || 5) * 60 * 1000).toISOString();

      await pruneOldBackups();

      console.log(`[BACKUP SUCCESS] [${backupType}] Backup created: ${filename} (Tasks: ${tasks.length}, Users: ${users.length}, Size: ${Buffer.byteLength(jsonStr)} bytes, Source: MySQL & backups/)`);

      return {
        filename,
        timestamp: now.toISOString(),
        type: backupType,
        size: Buffer.byteLength(jsonStr),
        tasksCount: tasks.length,
        usersCount: users.length,
        details: metaDetails || null,
        sourceFolder: isMysqlEnabled() ? 'backups/ (Local MySQL & Server Disk)' : 'backups/ (Local Server Disk)'
      };
    } catch (err) {
      console.error("[BACKUP ERROR] Failed to create backup:", err);
      throw err;
    }
  }

  async function pruneOldBackups() {
    try {
      // PERMANENT BACKUP POLICY: Never delete backup files automatically.
      // All historical database snapshots in backups/ are permanently preserved so user data is never lost.
      const files = await fs.readdir(BACKUPS_DIR);
      const backupFiles = files.filter(f => f.startsWith('db-backup-') && f.endsWith('.json'));
      console.log(`[BACKUP POLICY] Preserving all ${backupFiles.length} database backups. Auto-deletion is disabled.`);
    } catch (err) {
      console.error("Error inspecting backups:", err);
    }
  }

  let autoBackupInterval: NodeJS.Timeout | null = null;
  function startAutoBackupSchedule() {
    if (autoBackupInterval) clearInterval(autoBackupInterval);

    // Initial snapshot 5s after startup to guarantee a starting point
    setTimeout(async () => {
      try {
        await createHourlyBackup(false);
      } catch (e) {
        console.error("Initial auto-backup snapshot failed:", e);
      }
    }, 5000);

    const intervalMs = Math.max(5, autoBackupSettings.intervalMinutes || 5) * 60 * 1000;
    autoBackupInterval = setInterval(async () => {
      if (!autoBackupSettings.enabled) return;
      try {
        console.log(`[AUTO-BACKUP] Triggering scheduled backup (every ${autoBackupSettings.intervalMinutes || 5}m)...`);
        await createHourlyBackup(false);
      } catch (err) {
        console.error("[AUTO-BACKUP] Scheduled backup error:", err);
      }
    }, intervalMs);
    console.log(`[AUTO-BACKUP] Automated backup scheduler initialized (Every ${autoBackupSettings.intervalMinutes || 5}m).`);
  }

  function rebuildTechnicianStatuses() {
    const bdNow = getBangladeshDateTime();
    const todayIso = bdNow.dateStr;
    const todayLocal = new Date().toLocaleDateString('en-CA');
    const nowMinutes = bdNow.hours * 60 + bdNow.minutes;

    users.forEach((u: any) => {
      const empId = String(u.employeeId || '').trim();
      const todayAttendance = attendanceRecords.find((a: any) => 
        (String(a.technicianId || '').trim() === empId || String((a as any).employeeId || '').trim() === empId) && 
        (a.date === todayIso || a.date === todayLocal)
      );
      const hasActiveTasks = tasks.some((t: any) => 
        (t.status === 'RUNNING' || (t.status === 'PENDING' && t.requestStatus === 'RECOMMENDED')) && 
        (
          String(t.assignedTo || '').trim() === empId || 
          t.assignedTo === u.id || 
          (t.assignedTo && u.name && t.assignedTo.toLowerCase() === u.name.toLowerCase()) ||
          (t.assignedTechnicians && t.assignedTechnicians.some((at: any) => String(at.employeeId || '').trim() === empId))
        )
      );

      if (todayAttendance) {
        if (todayAttendance.status === 'PRESENT') {
          u.status = hasActiveTasks ? 'WORKING' : 'FREE';
        } else if (todayAttendance.status === 'LEAVE' || todayAttendance.status === 'ABSENT') {
          u.status = 'ON_LEAVE';
        } else if (todayAttendance.status === 'SHORT_LEAVE') {
          u.status = 'SHORT_LEAVE';
        } else if (todayAttendance.status === 'CHECKED_OUT') {
          u.status = 'SHIFT_OFF';
        } else if (todayAttendance.status === 'SHIFT_A' || todayAttendance.status === 'SHIFT_6_2') {
          const shiftA = shiftConfigurations.find(s => s.code === 'SHIFT_A') || DEFAULT_SHIFTS[0];
          const [sh, sm] = shiftA.startTime.split(':').map(Number);
          const [eh, em] = shiftA.endTime.split(':').map(Number);
          const isWorkingShift = nowMinutes >= (sh * 60 + sm) && nowMinutes < (eh * 60 + em);
          u.status = isWorkingShift ? (hasActiveTasks ? 'WORKING' : 'FREE') : 'SHIFT_OFF';
        } else if (todayAttendance.status === 'SHIFT_B' || todayAttendance.status === 'SHIFT_2_6') {
          const shiftB = shiftConfigurations.find(s => s.code === 'SHIFT_B') || DEFAULT_SHIFTS[1];
          const [sh, sm] = shiftB.startTime.split(':').map(Number);
          const [eh, em] = shiftB.endTime.split(':').map(Number);
          const isWorkingShift = nowMinutes >= (sh * 60 + sm) && nowMinutes < (eh * 60 + em);
          u.status = isWorkingShift ? (hasActiveTasks ? 'WORKING' : 'FREE') : 'SHIFT_OFF';
        }
      } else if (u.role === 'TECHNICIAN') {
        const { shift, isWeeklyOff } = getTechnicianShiftForDate(empId, todayIso, technicianShiftAssignments, shiftConfigurations);
        const [sh, sm] = shift.startTime.split(':').map(Number);
        const [eh, em] = shift.endTime.split(':').map(Number);
        const withinShift = !isWeeklyOff && nowMinutes >= (sh * 60 + sm) && nowMinutes < (eh * 60 + em);
        u.status = withinShift ? (hasActiveTasks ? 'WORKING' : 'FREE') : 'SHIFT_OFF';
      }
    });
  }

  const initialData = await loadData();
  console.log("Data loaded successfully.");
  if (!initialData.notifications) initialData.notifications = [];
  if (!initialData.pointTransactions) initialData.pointTransactions = [];
  if (!initialData.technicianPerformance) initialData.technicianPerformance = [];
  if (!initialData.assignmentRequests) initialData.assignmentRequests = [];
  if (!initialData.activityLogs) initialData.activityLogs = [];
  if (!initialData.adminAuditLogs) initialData.adminAuditLogs = [];
  if (!initialData.userSessions) initialData.userSessions = [];
  if (!initialData.failedLoginAttempts) initialData.failedLoginAttempts = [];
  if (!initialData.lockedDevices) initialData.lockedDevices = [];
  
  // Initialize users with defaults if empty or missing default admins
  const defaultUsers = [
    { employeeId: "jhfboss", name: "JHF Boss", password: "jhfboss", role: "SUPER_ADMIN" },
    { employeeId: "1007", name: "Chief Business Officer", password: "1007", role: "CBO", designation: "Chief Business Officer", department: "Executive Management" },
    { employeeId: "12467", name: "Deputy Chief Business Officer", password: "12467", role: "DCBO", designation: "Deputy Chief Business Officer", department: "Executive Management" },
    { employeeId: "17668", name: "Abdul Aowal", password: "3624", role: "DHOD", designation: "Deputy Head", department: "RAC R&I" },
    { employeeId: "19219", name: "Ariful Islam", password: "3624", role: "HOD", designation: "HOD", department: "RAC R&I" },
    { employeeId: "54589", name: "Md. Shofikul Islam", password: "3624", role: "IN_CHARGE", designation: "IN CHARGE", department: "Chemical & Polymer" },
    { employeeId: "58175", name: "Mohammad Alik Pramanik", password: "3624", role: "OFFICER", designation: "OFFICER" },
    { employeeId: "48566", name: "Mahmudul Hasan", password: "3624", role: "TECHNICIAN", designation: "TECHNICIAN" },
    { employeeId: "63195", name: "Bijoy Kumar Haolader", password: "3624", role: "TECHNICIAN", designation: "TECHNICIAN" }
  ];

  const excludedEmployeeIds = [
    "42274", "ADMIN001", "jhfadmin@jhf.com", "CBO001", "DCBO001",
    "admin", "65683", "45660",
    "1792817683237pvty5", "1774775811747ugmqy", "17923231674240mbok"
  ];

  if (!initialData.users) initialData.users = [];
  
  users = (initialData.users || []).filter((u: any) => 
    !excludedEmployeeIds.includes(String(u.employeeId || '').trim()) && 
    !excludedEmployeeIds.includes(String(u.id || '').trim()) && 
    !excludedEmployeeIds.includes(String(u.email || '').trim())
  );
  deletedTaskIds = Array.isArray(initialData.deletedTaskIds) 
    ? (Array.from(new Set(initialData.deletedTaskIds.map((id: any) => String(id).trim()))).filter(Boolean) as string[])
    : [];
  
  // Strictly filter tasks to ensure no deleted task ever resurrects
  tasks = (initialData.tasks || []).filter((t: any) => {
    if (!t) return false;
    const tId = String(t.id || '').trim();
    const tTaskId = String(t.taskId || '').trim();
    if (tId && deletedTaskIds.includes(tId)) return false;
    if (tTaskId && deletedTaskIds.includes(tTaskId)) return false;
    return true;
  });
  
  attendanceRecords = initialData.attendanceRecords || initialData.assignments || [];
  notifications = initialData.notifications || [];
  pointTransactions = initialData.pointTransactions || [];
  technicianPerformance = initialData.technicianPerformance || [];
  assignmentRequests = initialData.assignmentRequests || [];
  activityLogs = initialData.activityLogs || [];
  adminAuditLogs = initialData.adminAuditLogs || [];
  userSessions = initialData.userSessions || [];
  failedLoginAttempts = initialData.failedLoginAttempts || [];
  lockedDevices = initialData.lockedDevices || [];
  shiftConfigurations = Array.isArray(initialData.shiftConfigurations) && initialData.shiftConfigurations.length > 0
    ? initialData.shiftConfigurations
    : [...DEFAULT_SHIFTS];
  technicianShiftAssignments = Array.isArray(initialData.technicianShiftAssignments) ? initialData.technicianShiftAssignments : [];
  taskTimeSessions = Array.isArray(initialData.taskTimeSessions) ? initialData.taskTimeSessions : [];
  taskTimeExtensions = Array.isArray(initialData.taskTimeExtensions) ? initialData.taskTimeExtensions : [];
  overtimeRequests = Array.isArray(initialData.overtimeRequests) ? initialData.overtimeRequests : [];
  taskTimerAuditLogs = Array.isArray(initialData.taskTimerAuditLogs) ? initialData.taskTimerAuditLogs : [];
  performanceConfig = initialData.performanceConfig
    ? { ...DEFAULT_PERFORMANCE_CONFIG, ...initialData.performanceConfig }
    : { ...DEFAULT_PERFORMANCE_CONFIG };

  applyShiftingTechnicianLogic();

  let updated = false;
  for (const user of defaultUsers) {
    const existingUser = users.find((u: any) => u.employeeId.toLowerCase() === user.employeeId.toLowerCase());
    if (!existingUser) {
      console.log(`Initializing default user: ${user.employeeId}`);
      const hashedPassword = await bcrypt.hash(user.password, 10);
      users.push({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        employeeId: user.employeeId,
        name: user.name,
        password: hashedPassword,
        role: user.role as Role,
        designation: (user as any).designation || "",
        department: (user as any).department || "",
        supervisorId: "",
        assignedEngineers: []
      });
      updated = true;
    } else {
      // Ensure executive roles and DHOD designations are properly enforced
      if (['CBO', 'DCBO', 'SUPER_ADMIN', 'DHOD', 'HOD'].includes(user.role) && existingUser.role !== user.role) {
        console.log(`Updating role for ${user.employeeId} to ${user.role}`);
        existingUser.role = user.role as Role;
        existingUser.name = user.name || existingUser.name;
        existingUser.designation = (user as any).designation || existingUser.designation;
        existingUser.department = (user as any).department || existingUser.department;
        updated = true;
      }
      
      if (!existingUser.password || !existingUser.password.startsWith('$2')) {
        // If user exists but has no valid bcrypt password hash, set it
        console.log(`Setting missing/unhashed password for default user: ${user.employeeId}`);
        existingUser.password = await bcrypt.hash(user.password, 10);
        updated = true;
      }
    }
  }

  // Force rebuild technician statuses on startup to recover from any broken states
  rebuildTechnicianStatuses();

  // Initialize technician status if missing or needs update
  const todayDate = new Date().toISOString().split('T')[0];
  users.forEach((u: any) => {
    if (u.role === 'TECHNICIAN') {
      const techAttendance = attendanceRecords.find((a: any) => a.technicianId === u.employeeId && a.date === todayDate);
      const hasRunningTasks = tasks.some((t: any) => 
        t.status === 'RUNNING' && 
        (t.assignedTo === u.employeeId || t.assignedTo === u.name || t.assignedTo === u.id || (t.assignedTechnicians && t.assignedTechnicians.some((at: any) => at.employeeId === u.employeeId)))
      );

      if (techAttendance) {
        if (techAttendance.status === 'PRESENT') {
          u.status = hasRunningTasks ? 'WORKING' : 'FREE';
        } else if (techAttendance.status === 'LEAVE' || techAttendance.status === 'ABSENT') {
          u.status = 'ON_LEAVE';
        } else if (techAttendance.status === 'SHORT_LEAVE') {
          u.status = 'SHORT_LEAVE';
        } else if (techAttendance.status === 'SHIFT_A' || techAttendance.status === 'SHIFT_6_2') {
          const now = new Date();
          const currentHour = now.getHours();
          const isWorkingShift = currentHour >= 6 && currentHour < 14;
          u.status = isWorkingShift ? (hasRunningTasks ? 'WORKING' : 'FREE') : 'SHIFT_OFF';
        } else if (techAttendance.status === 'SHIFT_B' || techAttendance.status === 'SHIFT_2_6') {
          const now = new Date();
          const currentHour = now.getHours();
          const isWorkingShift = currentHour >= 14 && currentHour < 22;
          u.status = isWorkingShift ? (hasRunningTasks ? 'WORKING' : 'FREE') : 'SHIFT_OFF';
        }
      } else {
        // Default to FREE if no attendance yet, but check for running tasks
        u.status = hasRunningTasks ? 'WORKING' : 'FREE';
      }
      updated = true;
    }
  });

  recalculateAllPoints();

  // --- Helper Functions ---
  function getClientInfo(req: Request) {
    const userAgent = req.headers?.['user-agent'] || 'Unknown';
    
    // Better IP detection: check x-forwarded-for, x-real-ip, and then remoteAddress
    let ip = '0.0.0.0';
    const forwardedFor = req.headers?.['x-forwarded-for'] as string;
    const realIp = req.headers?.['x-real-ip'] as string;
    
    if (forwardedFor) {
      ip = forwardedFor.split(',')[0].trim();
    } else if (realIp) {
      ip = realIp.trim();
    } else if (req.socket?.remoteAddress) {
      ip = req.socket.remoteAddress;
    }
    
    // Clean up IPv6 mapped IPv4 addresses
    if (ip.startsWith('::ffff:')) {
      ip = ip.substring(7);
    }
    
    // Simple parsing for browser and OS
    let browser = 'Unknown';
    if (userAgent.includes('Firefox')) browser = 'Firefox';
    else if (userAgent.includes('Chrome')) browser = 'Chrome';
    else if (userAgent.includes('Safari')) browser = 'Safari';
    else if (userAgent.includes('Edge')) browser = 'Edge';
    
    let os = 'Unknown';
    if (userAgent.includes('Windows')) os = 'Windows';
    else if (userAgent.includes('Mac OS')) os = 'Mac OS';
    else if (userAgent.includes('Linux')) os = 'Linux';
    else if (userAgent.includes('Android')) os = 'Android';
    else if (userAgent.includes('iPhone')) os = 'iPhone';
    
    const deviceType = /Mobile|Android|iPhone/i.test(userAgent) ? 'Mobile' : 'Desktop';
    
    // Accept deviceName and platform from body if available (sent from frontend)
    const deviceName = req.body?.deviceName || 'Unknown Device';
    const platform = req.body?.platform || os;
    
    const deviceHash = Buffer.from(`${ip}-${userAgent}-${deviceName}`).toString('base64');
    
    return { ip, browser, os, deviceType, userAgent, deviceHash, deviceName, platform };
  }

  async function logAdminAction(admin: any, actionType: string, details: string, targetUser?: string, targetTask?: string) {
    const { ip } = getClientInfo({ headers: {} } as any); // Simplified for internal calls
    adminAuditLogs.push({
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      adminId: admin.id,
      adminName: admin.name,
      actionType,
      targetUser,
      targetTask,
      timestamp: new Date().toISOString(),
      ipAddress: ip,
      details
    });
    await saveData();
  }

  // --- Auth Middleware ---
  const authenticate = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(" ")[1];
    
    if (!token) {
      return res.status(401).json({ error: "Unauthorized: No token provided" });
    }
    
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      console.log(`Authenticating user: ${decoded.employeeId || decoded.id} for ${req.method} ${req.url}`);
      
      // Verify user exists in database
      const user = users.find(u => 
        (decoded.id && u.id === decoded.id) || 
        (decoded.employeeId && u.employeeId && u.employeeId.toLowerCase() === decoded.employeeId.toLowerCase())
      );
      if (!user) {
        return res.status(401).json({ error: "Invalid session: User no longer exists" });
      }

      // Check or recover session
      if (decoded.sessionId) {
        let session = userSessions.find(s => s.id === decoded.sessionId);
        if (!session) {
          console.log(`Auto-recovering session ${decoded.sessionId} for user ${user.name} (${user.employeeId})`);
          const clientInfo = getClientInfo(req);
          session = {
            id: decoded.sessionId,
            userId: user.id,
            employeeId: user.employeeId,
            loginTime: new Date().toISOString(),
            ipAddress: clientInfo.ip,
            browser: clientInfo.browser,
            os: clientInfo.os,
            deviceHash: clientInfo.deviceHash,
            deviceName: clientInfo.deviceName,
            platform: clientInfo.platform,
            active: true,
            lastActivity: new Date().toISOString()
          };
          userSessions.push(session);

          // Add activity log if missing
          if (!activityLogs.some(l => l.id === decoded.sessionId)) {
            activityLogs.push({
              id: decoded.sessionId,
              userId: user.id,
              employeeId: user.employeeId,
              name: user.name,
              role: user.role,
              loginTime: session.loginTime,
              ipAddress: clientInfo.ip,
              browser: clientInfo.browser,
              os: clientInfo.os,
              deviceType: clientInfo.deviceType,
              deviceName: clientInfo.deviceName,
              platform: clientInfo.platform,
              loginStatus: 'SUCCESS',
              createdAt: new Date().toISOString()
            });
          }
          saveData().catch(err => console.error("Error saving recovered session:", err));
        } else if (!session.active) {
          const isExplicitLogout = (session as any).logoutReason === 'ADMIN_FORCED' || (session as any).logoutReason === 'USER_LOGOUT';
          const logoutTime = session.logoutTime ? new Date(session.logoutTime).getTime() : 0;
          const now = Date.now();
          
          if (!isExplicitLogout || (logoutTime > 0 && (now - logoutTime) < 300000)) {
            console.log(`Reactivating session ${decoded.sessionId} for user ${user.employeeId}`);
            session.active = true;
            session.logoutTime = undefined;
            (session as any).logoutReason = undefined;
            saveData().catch(err => console.error("Error saving reactivated session:", err));
          } else {
            console.warn(`Auth failed: Session ${decoded.sessionId} is inactive (Logout time: ${session.logoutTime})`);
            return res.status(401).json({ error: "Session expired or logged out from another device" });
          }
        }
        
        // Update last activity
        session.lastActivity = new Date().toISOString();
      }

      // Synchronize req.user with up-to-date user details
      req.user = {
        ...decoded,
        id: user.id,
        role: user.role,
        name: user.name,
        employeeId: user.employeeId
      };
      next();
    } catch (err) {
      res.status(401).json({ error: "Invalid token" });
    }
  };

  const optionalAuth = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(" ")[1];
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        const user = users.find(u => 
          (decoded.id && u.id === decoded.id) || 
          (decoded.employeeId && u.employeeId && u.employeeId.toLowerCase() === decoded.employeeId.toLowerCase())
        );
        if (user) {
          req.user = {
            ...decoded,
            id: user.id,
            role: user.role,
            name: user.name,
            employeeId: user.employeeId
          };
        }
      } catch {
        // Continue silently without blocking if token is expired/invalid
      }
    }
    next();
  };

  // --- API Routes ---
  app.get("/api/ping", (req, res) => {
    res.json({ status: "pong", time: new Date().toISOString() });
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString(), users: users.length });
  });

  app.get("/api/test", (req, res) => {
    res.json({ status: "ok", usersCount: users.length });
  });

  // --- Real-time Server-Sent Events (SSE) Synchronization Engine ---
  const sseClients = new Set<Response>();

  function broadcastRealtimeUpdate(payload: { type: string; data?: any; taskId?: string; status?: string }) {
    const dataStr = `data: ${JSON.stringify({ ...payload, timestamp: new Date().toISOString() })}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(dataStr);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  // Periodic SSE keep-alive heartbeat (every 25 seconds)
  setInterval(() => {
    for (const client of sseClients) {
      try {
        client.write(': keepalive\n\n');
      } catch {
        sseClients.delete(client);
      }
    }
  }, 25000);

  app.get("/api/events", optionalAuth, (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    // Send immediate confirmation ping
    res.write(`data: ${JSON.stringify({ type: 'CONNECTED', timestamp: new Date().toISOString() })}\n\n`);
    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
      res.end();
    });
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const { employeeId, password } = req.body;
    const trimmedId = (employeeId || "").toString().trim();
    const cleanId = trimmedId.replace(/^0+/, '').toLowerCase();
    const passwordStr = (password || "").toString();
    const clientInfo = getClientInfo(req);
    const isSuperAdminLogin = trimmedId.toLowerCase() === 'admin' || trimmedId.toLowerCase() === 'jhfboss';
    
    // Check for device lock (exempt super admin)
    const isLocked = lockedDevices.some(d => 
      (d.ipAddress && d.ipAddress === clientInfo.ip) || 
      (d.deviceHash && d.deviceHash === clientInfo.deviceHash)
    );
    if (isLocked && !isSuperAdminLogin) {
      return res.status(403).json({ error: "Access denied from this device" });
    }

    // Check for account lock (exempt super admin)
    const failedAttempt = failedLoginAttempts.find(a => {
      const aId = String(a.employeeId || '').toLowerCase().trim();
      return aId === trimmedId.toLowerCase() || (cleanId && aId.replace(/^0+/, '') === cleanId);
    });
    if (failedAttempt && failedAttempt.isLocked) {
      if (!isSuperAdminLogin && failedAttempt.lockUntil && new Date(failedAttempt.lockUntil) > new Date()) {
        const remaining = Math.ceil((new Date(failedAttempt.lockUntil).getTime() - Date.now()) / 60000);
        return res.status(403).json({ error: `Account temporarily locked. Try again in ${remaining} minutes.` });
      } else {
        failedAttempt.isLocked = false;
        failedAttempt.attemptCount = 0;
        delete failedAttempt.lockUntil;
      }
    }

    // Find user by HRMS ID, stripped leading 0s, email, email prefix, or admin alias
    const user = users.find(u => {
      if (!u) return false;
      const uId = String(u.employeeId || '').toLowerCase().trim();
      const uCleanId = uId.replace(/^0+/, '');
      const uEmail = String(u.email || '').toLowerCase().trim();
      const uEmailPrefix = uEmail.split('@')[0];
      
      return (
        uId === trimmedId.toLowerCase() ||
        (cleanId && uCleanId === cleanId) ||
        uEmail === trimmedId.toLowerCase() ||
        (uEmailPrefix && uEmailPrefix === trimmedId.toLowerCase()) ||
        (trimmedId.toLowerCase() === 'admin' && (uId === 'jhfboss' || uId === 'admin' || u.role === 'SUPER_ADMIN')) ||
        (uId === '19348' && (trimmedId.toLowerCase() === 'jubaraj' || trimmedId.toLowerCase() === 'juboraj'))
      );
    });

    if (user) {
      let isMatch = false;
      if (user.password) {
        try {
          isMatch = await bcrypt.compare(passwordStr, user.password);
        } catch {
          isMatch = false;
        }
      }
      
      const isSuperAdmin = user.role === 'SUPER_ADMIN' || user.employeeId.toLowerCase() === 'jhfboss' || user.employeeId.toLowerCase() === 'admin';
      const uCleanId = String(user.employeeId || '').replace(/^0+/, '');
      
      // Robust fallbacks for credentials: ID matching, default 3624, or standard passwords
      if (!isMatch) {
        if (passwordStr === user.employeeId || (uCleanId && passwordStr === uCleanId) || passwordStr === "3624" || passwordStr === "123456") {
          isMatch = true;
        } else if (isSuperAdmin && (passwordStr === "admin" || passwordStr === "jhfboss" || passwordStr === "3624" || passwordStr === "123456")) {
          isMatch = true;
        } else if (user.employeeId.toLowerCase() === "1007" && (passwordStr === "1007" || passwordStr === "3624")) {
          isMatch = true;
        } else if (user.employeeId.toLowerCase() === "12467" && (passwordStr === "12467" || passwordStr === "3624")) {
          isMatch = true;
        } else if (user.employeeId.toLowerCase() === "19348" && (passwordStr === "19348" || passwordStr === "3624" || passwordStr === "123456")) {
          isMatch = true;
        }
        
        if (isMatch) {
          user.password = await bcrypt.hash(passwordStr, 10);
          backupAndSyncPermanentStaff('UPDATED', user.employeeId, user.name).catch(() => {});
          saveData().catch(err => console.error("Error saving updated password:", err));
        }
      }

      if (isMatch) {
        // Reset failed attempts on success
        const userEmpId = String(user.employeeId || '').toLowerCase().trim();
        const userCleanId = userEmpId.replace(/^0+/, '');
        failedLoginAttempts.forEach(a => {
          const aId = String(a.employeeId || '').toLowerCase().trim();
          if (aId === userEmpId || aId.replace(/^0+/, '') === userCleanId) {
            a.attemptCount = 0;
            a.isLocked = false;
            delete a.lockUntil;
            delete a.reason;
          }
        });

        const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 5);
        const token = jwt.sign({ 
          id: user.id, 
          role: user.role, 
          name: user.name, 
          employeeId: user.employeeId,
          sessionId 
        }, JWT_SECRET);

        // Create new session
        const newSession: UserSession = {
          id: sessionId,
          userId: user.id,
          employeeId: user.employeeId,
          loginTime: new Date().toISOString(),
          ipAddress: clientInfo.ip,
          browser: clientInfo.browser,
          os: clientInfo.os,
          deviceHash: clientInfo.deviceHash,
          deviceName: clientInfo.deviceName,
          platform: clientInfo.platform,
          active: true,
          lastActivity: new Date().toISOString()
        };
        userSessions.push(newSession);

        // Create activity log
        activityLogs.push({
          id: sessionId,
          userId: user.id,
          employeeId: user.employeeId,
          name: user.name,
          role: user.role,
          loginTime: newSession.loginTime,
          ipAddress: clientInfo.ip,
          browser: clientInfo.browser,
          os: clientInfo.os,
          deviceType: clientInfo.deviceType,
          deviceName: clientInfo.deviceName,
          platform: clientInfo.platform,
          loginStatus: 'SUCCESS',
          createdAt: new Date().toISOString()
        });

        // Save session in background asynchronously without blocking HTTP response
        saveData().catch(err => console.error("Error saving session on login:", err));

        const { password: _, ...userWithoutPassword } = user;
        return res.json({ token, user: userWithoutPassword });
      } else {
        // Track failed attempt
        if (failedAttempt) {
          failedAttempt.attemptCount++;
          failedAttempt.timestamp = new Date().toISOString();
          if (failedAttempt.attemptCount >= 5) {
            failedAttempt.isLocked = true;
            failedAttempt.lockUntil = new Date(Date.now() + 15 * 60000).toISOString();
          }
        } else {
          failedLoginAttempts.push({
            id: Date.now().toString(),
            employeeId: trimmedId,
            ipAddress: clientInfo.ip,
            browser: clientInfo.browser,
            os: clientInfo.os,
            timestamp: new Date().toISOString(),
            attemptCount: 1,
            isLocked: false
          });
        }

        // Log failed activity
        activityLogs.push({
          id: Date.now().toString(),
          userId: user.id,
          employeeId: user.employeeId,
          name: user.name,
          role: user.role,
          loginTime: new Date().toISOString(),
          ipAddress: clientInfo.ip,
          browser: clientInfo.browser,
          os: clientInfo.os,
          deviceType: clientInfo.deviceType,
          loginStatus: 'FAILED',
          failedAttemptCount: failedAttempt ? failedAttempt.attemptCount : 1,
          createdAt: new Date().toISOString()
        });
        saveData().catch(err => console.error("Error saving failed login log:", err));
        return res.status(401).json({ error: "Invalid credentials" });
      }
    } else {
      // Log failed attempt for non-existent user
      failedLoginAttempts.push({
        id: Date.now().toString(),
        employeeId: trimmedId,
        ipAddress: clientInfo.ip,
        browser: clientInfo.browser,
        os: clientInfo.os,
        timestamp: new Date().toISOString(),
        attemptCount: 1,
        isLocked: false
      });
      saveData().catch(err => console.error("Error saving unknown login log:", err));
      return res.status(401).json({ error: "Invalid credentials" });
    }
  });

  app.post("/api/auth/logout", authenticate, async (req: Request, res: Response) => {
    const session = userSessions.find(s => s.id === req.user.sessionId);
    if (session) {
      session.active = false;
      session.logoutTime = new Date().toISOString();
      (session as any).logoutReason = 'USER_LOGOUT';
      
      const log = activityLogs.find(l => l.id === session.id);
      if (log) {
        log.logoutTime = session.logoutTime;
        const durationMs = new Date(log.logoutTime).getTime() - new Date(log.loginTime).getTime();
        const minutes = Math.floor(durationMs / 60000);
        const seconds = Math.floor((durationMs % 60000) / 1000);
        log.sessionDuration = `${minutes}m ${seconds}s`;
      }
      await saveData();
    }
    res.json({ success: true });
  });

  app.post("/api/auth/change-password", authenticate, async (req: Request, res: Response) => {
    const { currentPassword, newPassword } = req.body;
    const user = users.find(u => u.id === req.user.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    let isMatch = false;
    try {
      isMatch = await bcrypt.compare(currentPassword, user.password);
    } catch {
      isMatch = false;
    }
    if (!isMatch && (currentPassword === user.employeeId || currentPassword === "3624" || currentPassword === "123456")) {
      isMatch = true;
    }
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid current password" });
    }
    user.password = await bcrypt.hash(newPassword, 10);
    
    // Clear any failed attempts / lockout
    const userEmpId = String(user.employeeId || '').toLowerCase().trim();
    const cleanEmpId = userEmpId.replace(/^0+/, '');
    failedLoginAttempts.forEach(a => {
      const aId = String(a.employeeId || '').toLowerCase().trim();
      if (aId === userEmpId || aId.replace(/^0+/, '') === cleanEmpId) {
        a.isLocked = false;
        a.attemptCount = 0;
        delete a.lockUntil;
        delete a.reason;
      }
    });

    await backupAndSyncPermanentStaff('UPDATED', user.employeeId, user.name);
    await saveData();
    res.json({ message: "Password changed successfully" });
  });

  app.post("/api/users/:id/reset-password", authenticate, async (req: Request, res: Response) => {
    const allowedRoles = ['SUPER_ADMIN', 'CBO', 'DCBO', 'HOD', 'DHOD'];
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { id } = req.params;
    const { newPassword } = req.body;
    const user = users.find(u => u.id === id || u.employeeId === id || String(u.employeeId).replace(/^0+/, '') === String(id).replace(/^0+/, ''));
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    user.password = await bcrypt.hash(newPassword, 10);
    
    // Clear any failed attempts / lockout for this user
    const userEmpId = String(user.employeeId || '').toLowerCase().trim();
    const cleanEmpId = userEmpId.replace(/^0+/, '');
    failedLoginAttempts.forEach(a => {
      const aId = String(a.employeeId || '').toLowerCase().trim();
      if (aId === userEmpId || aId.replace(/^0+/, '') === cleanEmpId) {
        a.isLocked = false;
        a.attemptCount = 0;
        delete a.lockUntil;
        delete a.reason;
      }
    });

    await logAdminAction(req.user, 'PASSWORD_RESET', `Reset password for user ${user.name} (${user.employeeId})`, user.id);
    await backupAndSyncPermanentStaff('UPDATED', user.employeeId, user.name);
    await saveData();
    res.json({ message: "Password reset successfully" });
  });

  app.get("/api/users", authenticate, (req: Request, res: Response) => {
    const allowedRoles = ['SUPER_ADMIN', 'CBO', 'DCBO', 'HOD', 'DHOD', 'IN_CHARGE', 'MODEL_MANAGER', 'ENGINEER', 'OFFICER'];
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    rebuildTechnicianStatuses();
    res.json(users.map(({ password, ...u }) => u));
  });

  app.post("/api/users", authenticate, async (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'HOD' && req.user.role !== 'DHOD' && req.user.role !== 'CBO' && req.user.role !== 'DCBO') {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { employeeId, name, role, password, avatar, supervisorId, phone, designation, email, department, section, assignedEngineers, supervisor_ids, cboId, dcboId, hodId, dhodId } = req.body;
    
    let formattedPhone = phone;
    if (formattedPhone && !formattedPhone.startsWith('0') && /^\d+$/.test(formattedPhone)) {
      formattedPhone = '0' + formattedPhone;
    }

    const newUser: User = {
      id: Date.now().toString(),
      employeeId,
      name,
      role,
      avatar,
      supervisorId,
      supervisor_ids: shiftingTechnicianIds.includes(employeeId) ? shiftingOfficerIds : supervisor_ids,
      phone: formattedPhone,
      designation,
      email,
      department: department || "RAC R&I",
      section: section || "",
      cboId: cboId || "",
      dcboId: dcboId || "",
      hodId: hodId || "",
      dhodId: dhodId || "",
      assignedEngineers: assignedEngineers || [],
      status: (role === 'TECHNICIAN' ? 'FREE' : undefined) as User['status'],
      password: await bcrypt.hash(password || "3624", 10)
    };
    users.push(newUser);
    await logAdminAction(req.user, 'USER_CREATED', `Created user ${newUser.name} (${newUser.employeeId})`, newUser.id);
    await backupAndSyncPermanentStaff('ADDED', newUser.employeeId, newUser.name);
    await saveData();
    const { password: _, ...userWithoutPassword } = newUser;
    res.status(201).json(userWithoutPassword);
  });

  app.put("/api/users/:id", authenticate, async (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'HOD' && req.user.role !== 'DHOD' && req.user.role !== 'CBO' && req.user.role !== 'DCBO') {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { id } = req.params;
    const { name, role, employeeId, password, avatar, supervisorId, phone, designation, email, department, section, assignedEngineers, supervisor_ids, cboId, dcboId, hodId, dhodId } = req.body;
    
    let formattedPhone = phone;
    if (formattedPhone && !formattedPhone.startsWith('0') && /^\d+$/.test(formattedPhone)) {
      formattedPhone = '0' + formattedPhone;
    }

    const index = users.findIndex(u => u.id === id);
    if (index !== -1) {
      const updatedUser = { 
        ...users[index], 
        name: name || users[index].name, 
        role: role || users[index].role, 
        employeeId: employeeId || users[index].employeeId, 
        avatar: avatar !== undefined ? avatar : users[index].avatar, 
        supervisorId: supervisorId !== undefined ? supervisorId : users[index].supervisorId, 
        supervisor_ids: shiftingTechnicianIds.includes(employeeId || users[index].employeeId) ? shiftingOfficerIds : (req.body.supervisor_ids !== undefined ? req.body.supervisor_ids : users[index].supervisor_ids),
        phone: formattedPhone !== undefined ? formattedPhone : users[index].phone, 
        designation: designation !== undefined ? designation : users[index].designation, 
        email: email !== undefined ? email : users[index].email, 
        department: department || users[index].department || "RAC R&I", 
        section: section !== undefined ? section : users[index].section,
        cboId: cboId !== undefined ? cboId : users[index].cboId,
        dcboId: dcboId !== undefined ? dcboId : users[index].dcboId,
        hodId: hodId !== undefined ? hodId : users[index].hodId,
        dhodId: dhodId !== undefined ? dhodId : users[index].dhodId,
        assignedEngineers: assignedEngineers || [] 
      };
      if (password) {
        updatedUser.password = await bcrypt.hash(password, 10);
      }
      users[index] = updatedUser;
      await logAdminAction(req.user, 'USER_EDITED', `Edited user ${updatedUser.name} (${updatedUser.employeeId})`, updatedUser.id);
      await backupAndSyncPermanentStaff('UPDATED', updatedUser.employeeId, updatedUser.name);
      await saveData();
      const { password: _, ...userWithoutPassword } = users[index];
      res.json(userWithoutPassword);
    } else {
      res.status(404).json({ error: "User not found" });
    }
  });

  app.delete("/api/users/:id", authenticate, async (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'HOD' && req.user.role !== 'DHOD' && req.user.role !== 'CBO' && req.user.role !== 'DCBO') {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { id } = req.params;
    const index = users.findIndex(u => u.id === id);
    if (index !== -1) {
      const deletedUser = users[index];
      users.splice(index, 1);
      await logAdminAction(req.user, 'USER_DELETED', `Deleted user ${deletedUser.name} (${deletedUser.employeeId})`, deletedUser.id);
      await backupAndSyncPermanentStaff('DELETED', deletedUser.employeeId, deletedUser.name);
      await saveData();
      res.status(204).send();
    } else {
      res.status(404).json({ error: "User not found" });
    }
  });

  // --- Notifications ---
  app.get("/api/notifications", authenticate, (req: Request, res: Response) => {
    const user = (req as any).user;
    const userNotifications = (notifications || []).filter((n: any) => n.userId === user.id);
    res.json(userNotifications);
  });

  app.put("/api/notifications/:id/read", authenticate, async (req: Request, res: Response) => {
    const user = (req as any).user;
    const index = (notifications || []).findIndex((n: any) => n.id === req.params.id && n.userId === user.id);
    if (index !== -1) {
      notifications[index].read = true;
      await saveData();
    }
    res.json({ success: true });
  });

  app.delete("/api/notifications", authenticate, async (req: Request, res: Response) => {
    const user = (req as any).user;
    const newNotifications = (notifications || []).filter((n: any) => n.userId !== user.id);
    notifications.length = 0;
    notifications.push(...newNotifications);
    await saveData();
    res.json({ success: true });
  });

  app.get("/api/points", authenticate, async (req: Request, res: Response) => {
    // Points are already recalculated on data changes
    res.json(pointTransactions);
  });

  app.get("/api/points/hierarchy", authenticate, async (req: Request, res: Response) => {
    const month = req.query.month ? Number(req.query.month) : undefined;
    const year = req.query.year ? Number(req.query.year) : undefined;
    const result = getHierarchicalPerformanceData(month, year);
    res.json(result);
  });

  // --- Centralized Authoritative Officer Points & Department Aggregates ---
  app.get("/api/analytics/central", authenticate, (req: Request, res: Response) => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const officerStats = users
      .filter((u: any) => u.role === 'OFFICER')
      .map((off: any) => {
        // Authoritative eligible completed tasks belonging to this officer
        const offTasks = tasks.filter((t: any) => {
          if ((t.status || '').toUpperCase() !== 'COMPLETED') return false;
          const isMyTask = (t.responsibleOfficerId && (t.responsibleOfficerId === off.employeeId || t.responsibleOfficerId === off.id)) ||
            (t.createdBy && (t.createdBy === off.employeeId || t.createdBy === off.id)) ||
            (t.assignedBy && (t.assignedBy === off.employeeId || t.assignedBy === off.id));
          if (!isMyTask) return false;

          const creator = users.find((u: any) => u.employeeId === t.createdBy || u.id === t.createdBy);
          const isOffCreated = creator?.role === 'OFFICER' || t.responsibleOfficerId;
          return isOffCreated ? Boolean(t.engineerApproved) : t.requestStatus !== 'REJECTED';
        });

        const thisMonthTasks = offTasks.filter((t: any) => {
          const d = new Date(t.completedAt || t.createdAt);
          return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
        });

        const points = Number(off.total_point || 0);
        const thisMonthPoints = thisMonthTasks.reduce((sum: number, t: any) => sum + (Number(t.points) || 1), 0);

        return {
          id: off.id,
          employeeId: off.employeeId,
          name: off.name,
          designation: off.designation || 'Officer',
          department: off.department || 'RAC R&I',
          points,
          thisMonthPoints,
          completedTasks: offTasks.length,
          thisMonthTasks: thisMonthTasks.length
        };
      })
      .sort((a: any, b: any) => b.points - a.points || b.completedTasks - a.completedTasks);

    const totalEligibleTasks = tasks.filter((t: any) => {
      if ((t.status || '').toUpperCase() !== 'COMPLETED') return false;
      const creator = users.find((u: any) => u.employeeId === t.createdBy || u.id === t.createdBy);
      const isOffCreated = creator?.role === 'OFFICER' || t.responsibleOfficerId;
      return isOffCreated ? Boolean(t.engineerApproved) : t.requestStatus !== 'REJECTED';
    });

    res.json({
      officers: officerStats,
      totalDepartmentPoints: officerStats.reduce((sum: number, o: any) => sum + o.points, 0),
      totalCompletedTasks: totalEligibleTasks.length
    });
  });

  // --- Engineer Performance Analytics (Strict Access: Engineers & Management Only) ---
  app.get("/api/analytics/engineer-performance", authenticate, (req: Request, res: Response) => {
    const user = (req as any).user;
    const authorizedRoles = ['ENGINEER', 'IN_CHARGE', 'MODEL_MANAGER', 'HOD', 'DHOD', 'CBO', 'DCBO', 'SUPER_ADMIN'];
    
    // Strict RBAC: Block Officer and Technician
    if (!authorizedRoles.includes(user.role)) {
      return res.status(403).json({
        error: "Access Denied: Engineer Performance Analytics is restricted to Engineers, In-Charges, Model Managers, and Executive Management."
      });
    }

    const { period = 'all', startDate, endDate } = req.query;
    const now = new Date();
    
    // Period filter evaluator
    const isDateInScope = (dateStr?: string): boolean => {
      if (!dateStr) return false;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return false;

      if (period === 'today') {
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        return d >= startOfToday;
      }
      if (period === 'week') {
        const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        return d >= startOfWeek;
      }
      if (period === 'month') {
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        return d >= startOfMonth;
      }
      if (period === 'custom' && startDate && endDate) {
        const start = new Date(startDate as string);
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        return d >= start && d <= end;
      }
      return true; // 'all'
    };

    // Scoped engineers determination based on user role
    let scopedEngineers: any[] = [];
    let scopeLabel = "Department-Wide";

    if (user.role === 'ENGINEER') {
      scopeLabel = "Personal Scope: Your Tasks & Points";
      scopedEngineers = users.filter((u: any) => u.role === 'ENGINEER' && (u.employeeId === user.employeeId || u.id === user.id));
    } else if (user.role === 'IN_CHARGE') {
      scopeLabel = "Section Scope: Assigned Engineering Team";
      const assigned = user.assignedEngineers || [];
      scopedEngineers = users.filter((u: any) => 
        u.role === 'ENGINEER' && (
          assigned.includes(u.employeeId) || 
          (u.section && user.section && u.section.toLowerCase() === user.section.toLowerCase()) ||
          u.employeeId === user.employeeId
        )
      );
      if (scopedEngineers.length === 0) {
        scopedEngineers = users.filter((u: any) => u.role === 'ENGINEER');
      }
    } else if (user.role === 'MODEL_MANAGER') {
      scopeLabel = "Model Scope: Model Engineering Team";
      const assigned = user.assignedEngineers || [];
      scopedEngineers = users.filter((u: any) => 
        u.role === 'ENGINEER' && (
          assigned.includes(u.employeeId) || 
          (u.section && user.section && u.section.toLowerCase() === user.section.toLowerCase())
        )
      );
      if (scopedEngineers.length === 0) {
        scopedEngineers = users.filter((u: any) => u.role === 'ENGINEER');
      }
    } else {
      // HOD, DHOD, CBO, DCBO, SUPER_ADMIN
      scopeLabel = "Full Department Scope: All Engineers";
      scopedEngineers = users.filter((u: any) => u.role === 'ENGINEER');
    }

    const scopedEmpIds = new Set(scopedEngineers.map((e: any) => e.employeeId));

    // Per-engineer metrics calculation
    const engineerStats = scopedEngineers.map((eng: any) => {
      // Tasks associated with this engineer
      const engTasks = tasks.filter((t: any) => 
        t.concernEngineerId === eng.employeeId ||
        t.approvedBy === eng.employeeId ||
        t.recommendedBy === eng.employeeId ||
        t.createdBy === eng.employeeId ||
        t.assignedBy === eng.employeeId
      );

      // 1. Eligible completed tasks in period
      const completedTasksInPeriod = engTasks.filter((t: any) => {
        if ((t.status || '').toUpperCase() !== 'COMPLETED') return false;
        if (!isDateInScope(t.completedAt || t.createdAt)) return false;
        const creator = users.find((u: any) => u.employeeId === t.createdBy || u.id === t.createdBy);
        const isOffCreated = creator?.role === 'OFFICER' || t.responsibleOfficerId;
        return isOffCreated ? Boolean(t.engineerApproved) : t.requestStatus !== 'REJECTED';
      });

      const earnedPoints = completedTasksInPeriod.reduce((sum: number, t: any) => sum + (Number(t.points) || 1), 0);

      // 2. Workloads (displayed separately from earned points)
      const runningWorkload = engTasks.filter((t: any) => (t.status || '').toUpperCase() === 'RUNNING').length;
      const pendingWorkload = engTasks.filter((t: any) => (t.status || '').toUpperCase() === 'PENDING' || (t.status || '').toUpperCase() === 'REQUESTED').length;
      const holdWorkload = engTasks.filter((t: any) => (t.status || '').toUpperCase() === 'HOLD').length;

      // 3. Awaiting recommendation queue (tasks created by officers that need this engineer's recommendation)
      const awaitingQueue = tasks.filter((t: any) => {
        const creator = users.find((u: any) => u.employeeId === t.createdBy || u.id === t.createdBy);
        if (creator?.role !== 'OFFICER' && !t.responsibleOfficerId) return false;
        if (Boolean(t.engineerApproved)) return false;
        if ((t.status || '').toUpperCase() === 'REJECTED' || (t.status || '').toUpperCase() === 'CANCELLED') return false;
        
        const isAssigned = (creator?.assignedEngineers || []).includes(eng.employeeId) ||
          creator?.supervisorId === eng.id || creator?.supervisorId === eng.employeeId ||
          t.concernEngineerId === eng.employeeId || t.assignedBy === eng.employeeId;
        return isAssigned;
      });

      // Model breakdown for this engineer
      const modelMap: { [key: string]: { completed: number; points: number } } = {};
      completedTasksInPeriod.forEach((t: any) => {
        const m = t.model || 'Other';
        if (!modelMap[m]) modelMap[m] = { completed: 0, points: 0 };
        modelMap[m].completed += 1;
        modelMap[m].points += (Number(t.points) || 1);
      });

      return {
        id: eng.id,
        employeeId: eng.employeeId,
        name: eng.name,
        section: eng.section || 'RAC R&I',
        designation: eng.designation || 'Engineer',
        earnedPoints,
        completedTasks: completedTasksInPeriod.length,
        runningWorkload,
        pendingWorkload,
        holdWorkload,
        awaitingRecommendations: awaitingQueue.length,
        modelBreakdown: Object.keys(modelMap).map(m => ({ model: m, ...modelMap[m] }))
      };
    }).sort((a: any, b: any) => b.earnedPoints - a.earnedPoints || b.completedTasks - a.completedTasks);

    // Global awaiting recommendation tasks across scoped engineers
    const awaitingTasksList = tasks.filter((t: any) => {
      const creator = users.find((u: any) => u.employeeId === t.createdBy || u.id === t.createdBy);
      if (creator?.role !== 'OFFICER' && !t.responsibleOfficerId) return false;
      if (Boolean(t.engineerApproved)) return false;
      if ((t.status || '').toUpperCase() === 'REJECTED' || (t.status || '').toUpperCase() === 'CANCELLED') return false;

      // Check if any scoped engineer is the target
      return scopedEngineers.some((eng: any) => 
        (creator?.assignedEngineers || []).includes(eng.employeeId) ||
        creator?.supervisorId === eng.id || creator?.supervisorId === eng.employeeId ||
        t.concernEngineerId === eng.employeeId || t.assignedBy === eng.employeeId
      );
    }).map((t: any) => {
      const creator = users.find((u: any) => u.employeeId === t.createdBy || u.id === t.createdBy);
      return {
        id: t.id,
        taskId: t.taskId,
        title: t.title,
        model: t.model,
        urgency: t.urgency,
        status: t.status,
        officerName: creator?.name || t.assignedBy || 'Officer',
        officerEmployeeId: creator?.employeeId || t.responsibleOfficerId || '',
        createdAt: t.createdAt,
        deadline: t.deadline
      };
    });

    // Model comparison for scoped engineers
    const overallModelMap: { [key: string]: { points: number; completed: number; running: number } } = {};
    tasks.forEach((t: any) => {
      const isScoped = scopedEngineers.some((eng: any) => 
        t.concernEngineerId === eng.employeeId ||
        t.approvedBy === eng.employeeId ||
        t.recommendedBy === eng.employeeId ||
        t.createdBy === eng.employeeId ||
        t.assignedBy === eng.employeeId
      );
      if (!isScoped) return;

      const m = t.model || 'Other';
      if (!overallModelMap[m]) overallModelMap[m] = { points: 0, completed: 0, running: 0 };

      const status = (t.status || '').toUpperCase();
      if (status === 'COMPLETED' && isDateInScope(t.completedAt || t.createdAt)) {
        const creator = users.find((u: any) => u.employeeId === t.createdBy || u.id === t.createdBy);
        const isOff = creator?.role === 'OFFICER' || t.responsibleOfficerId;
        const eligible = isOff ? Boolean(t.engineerApproved) : t.requestStatus !== 'REJECTED';
        if (eligible) {
          overallModelMap[m].completed += 1;
          overallModelMap[m].points += (Number(t.points) || 1);
        }
      } else if (status === 'RUNNING') {
        overallModelMap[m].running += 1;
      }
    });

    const modelDistribution = Object.keys(overallModelMap).map(m => ({
      name: m,
      points: overallModelMap[m].points,
      completed: overallModelMap[m].completed,
      running: overallModelMap[m].running
    })).filter(m => m.completed > 0 || m.running > 0);

    // Trend analysis over past 7 days / periods
    const trendDays: { [key: string]: { name: string; completed: number; points: number; running: number } } = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().split('T')[0];
      const name = d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
      trendDays[key] = { name, completed: 0, points: 0, running: 0 };
    }

    tasks.forEach((t: any) => {
      const isScoped = scopedEngineers.some((eng: any) => 
        t.concernEngineerId === eng.employeeId ||
        t.approvedBy === eng.employeeId ||
        t.recommendedBy === eng.employeeId ||
        t.createdBy === eng.employeeId ||
        t.assignedBy === eng.employeeId
      );
      if (!isScoped) return;

      if ((t.status || '').toUpperCase() === 'COMPLETED' && t.completedAt) {
        const dayKey = t.completedAt.split('T')[0];
        if (trendDays[dayKey]) {
          const creator = users.find((u: any) => u.employeeId === t.createdBy || u.id === t.createdBy);
          const isOff = creator?.role === 'OFFICER' || t.responsibleOfficerId;
          const eligible = isOff ? Boolean(t.engineerApproved) : t.requestStatus !== 'REJECTED';
          if (eligible) {
            trendDays[dayKey].completed += 1;
            trendDays[dayKey].points += (Number(t.points) || 1);
          }
        }
      }
    });

    const performanceTrend = Object.values(trendDays);

    res.json({
      scopeLabel,
      userRole: user.role,
      period,
      summary: {
        totalEarnedPoints: engineerStats.reduce((sum: number, e: any) => sum + e.earnedPoints, 0),
        totalCompletedTasks: engineerStats.reduce((sum: number, e: any) => sum + e.completedTasks, 0),
        totalRunningWorkload: engineerStats.reduce((sum: number, e: any) => sum + e.runningWorkload, 0),
        totalPendingWorkload: engineerStats.reduce((sum: number, e: any) => sum + e.pendingWorkload, 0),
        totalAwaitingRecommendations: awaitingTasksList.length,
        engineerCount: engineerStats.length
      },
      engineers: engineerStats,
      modelDistribution,
      performanceTrend,
      awaitingTasksList
    });
  });

  app.post("/api/admin/recalculate", authenticate, async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'HOD' && user.role !== 'DHOD' && user.role !== 'CBO' && user.role !== 'DCBO') {
      return res.status(403).json({ error: "Access Denied" });
    }
    recalculateAllPoints();
    await saveData();
    res.json({ success: true, message: "Points recalculated" });
  });

  app.get("/api/performance", authenticate, (req: Request, res: Response) => {
    res.json(technicianPerformance);
  });

  app.get("/api/assignment-requests", authenticate, (req: Request, res: Response) => {
    const user = (req as any).user;
    // Supervisors see requests for their technicians
    // Officers see requests they made
    const filtered = assignmentRequests.filter((r: any) => 
      r.supervisorId === user.id || r.requestingOfficerId === user.id
    );
    res.json(filtered);
  });

  app.post("/api/assignment-requests", authenticate, async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { taskId, targetTechnicianId, supervisorId, reason } = req.body;
    
    const newRequest = {
      id: Date.now().toString(),
      taskId,
      requestingOfficerId: user.id,
      targetTechnicianId,
      supervisorId,
      status: 'PENDING',
      reason,
      createdAt: new Date().toISOString()
    };
    
    assignmentRequests.push(newRequest);
    
    // Notify supervisor
    notifications.push({
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      userId: supervisorId,
      senderId: user.id,
      type: 'ASSIGNMENT_REQUEST',
      message: `Officer ${user.name} requested a technician for a task.`,
      read: false,
      timestamp: new Date().toISOString()
    });

    await saveData();
    res.status(201).json(newRequest);
  });

  // --- Security Dashboard Endpoints ---
  app.post("/api/admin/recalculate", authenticate, async (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: "Forbidden" });
    recalculateAllPoints();
    rebuildTechnicianStatuses();
    await saveData();
    res.json({ message: "Recalculation complete" });
  });

  app.get("/api/admin/activity-logs", authenticate, (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: "Forbidden" });
    res.json(activityLogs);
  });

  app.get("/api/admin/active-sessions", authenticate, (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: "Forbidden" });
    res.json(userSessions.filter(s => s.active));
  });

  app.post("/api/admin/sessions/force-logout", authenticate, async (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: "Forbidden" });
    const { sessionId } = req.body;
    const session = userSessions.find(s => s.id === sessionId);
    if (session) {
      session.active = false;
      session.logoutTime = new Date().toISOString();
      (session as any).logoutReason = 'ADMIN_FORCED';
      const log = activityLogs.find(l => l.id === sessionId);
      if (log) {
        log.logoutTime = session.logoutTime;
        log.sessionDuration = "Admin Forced Logout";
      }
      await logAdminAction(req.user, 'FORCE_LOGOUT', `Forced logout for session ${sessionId} (User: ${session.employeeId})`, session.userId);
      await saveData();
    }
    res.json({ success: true });
  });

  app.get("/api/admin/audit-logs", authenticate, (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: "Forbidden" });
    res.json(adminAuditLogs);
  });

  app.get("/api/admin/locked-devices", authenticate, (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: "Forbidden" });
    res.json(lockedDevices);
  });

  app.post("/api/admin/devices/lock", authenticate, async (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: "Forbidden" });
    const { ipAddress, deviceHash, reason } = req.body;
    const newLock: LockedDevice = {
      id: Date.now().toString(),
      ipAddress,
      deviceHash,
      reason,
      lockedBy: req.user.name,
      lockedAt: new Date().toISOString()
    };
    lockedDevices.push(newLock);
    await logAdminAction(req.user, 'DEVICE_LOCKED', `Locked device/IP: ${ipAddress || deviceHash}`, undefined);
    await saveData();
    res.status(201).json(newLock);
  });

  app.post("/api/admin/devices/unlock", authenticate, async (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: "Forbidden" });
    const { id } = req.body;
    const index = lockedDevices.findIndex(d => d.id === id);
    if (index !== -1) {
      const lock = lockedDevices[index];
      lockedDevices.splice(index, 1);
      await logAdminAction(req.user, 'DEVICE_UNLOCKED', `Unlocked device/IP: ${lock.ipAddress || lock.deviceHash}`, undefined);
      await saveData();
    }
    res.json({ success: true });
  });

  app.get("/api/admin/suspicious-logins", authenticate, (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: "Forbidden" });
    // Define suspicious as: same user from different IPs within 1 hour
    const suspicious: any[] = [];
    const oneHourAgo = new Date(Date.now() - 3600000);
    
    const recentLogs = activityLogs.filter(l => new Date(l.loginTime) > oneHourAgo && l.loginStatus === 'SUCCESS');
    const userGroups = recentLogs.reduce((acc: any, log) => {
      if (!acc[log.userId]) acc[log.userId] = [];
      acc[log.userId].push(log);
      return acc;
    }, {});

    for (const userId in userGroups) {
      const logs = userGroups[userId];
      const ips = new Set(logs.map((l: any) => l.ipAddress));
      if (ips.size > 1) {
        suspicious.push({
          userId,
          employeeId: logs[0].employeeId,
          name: logs[0].name,
          ips: Array.from(ips),
          logs: logs,
          reason: 'Multiple IPs in short time'
        });
      }
    }
    res.json(suspicious);
  });

  app.get("/api/admin/locked-accounts", authenticate, (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: "Forbidden" });
    const locked = failedLoginAttempts.filter(a => a.isLocked).map(a => {
      const targetEmpId = String(a.employeeId || '').trim().toLowerCase();
      const cleanEmpId = targetEmpId.replace(/^0+/, '');
      const u = users.find(user => {
        const uId = String(user.employeeId || '').trim().toLowerCase();
        return uId === targetEmpId || uId.replace(/^0+/, '') === cleanEmpId;
      });
      return {
        ...a,
        name: u ? u.name : 'Unknown Employee',
        role: u ? u.role : '-',
        designation: u ? u.designation : '-',
        department: u ? u.department : '-'
      };
    });
    res.json(locked);
  });

  app.post("/api/admin/lock-account", authenticate, async (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: "Forbidden" });
    const { employeeId, reason, lockDurationHours } = req.body;
    const trimmedId = String(employeeId || '').trim();
    if (!trimmedId) return res.status(400).json({ error: "Employee ID is required" });
    
    const cleanId = trimmedId.replace(/^0+/, '').toLowerCase();
    const user = users.find(u => {
      const uId = String(u.employeeId || '').trim().toLowerCase();
      return uId === trimmedId.toLowerCase() || uId.replace(/^0+/, '') === cleanId;
    });

    const duration = (Number(lockDurationHours) || 24) * 3600000;
    const lockUntil = new Date(Date.now() + duration).toISOString();
    
    let attempt = failedLoginAttempts.find(a => 
      a.employeeId.toLowerCase() === trimmedId.toLowerCase() ||
      a.employeeId.replace(/^0+/, '').toLowerCase() === cleanId
    );
    if (attempt) {
      attempt.isLocked = true;
      attempt.lockUntil = lockUntil;
      attempt.reason = reason || 'Locked by Super Admin';
      attempt.timestamp = new Date().toISOString();
      attempt.attemptCount = Math.max(attempt.attemptCount, 5);
    } else {
      failedLoginAttempts.push({
        id: Date.now().toString(),
        employeeId: user ? user.employeeId : trimmedId,
        ipAddress: 'Admin Console',
        browser: 'Admin Console',
        os: 'Security Center',
        timestamp: new Date().toISOString(),
        attemptCount: 5,
        isLocked: true,
        lockUntil: lockUntil,
        reason: reason || 'Locked by Super Admin'
      });
    }
    await logAdminAction(req.user, 'ACCOUNT_LOCKED', `Locked account for ${trimmedId}${user ? ` (${user.name})` : ''}: ${reason || 'Manual lock'}`, user?.id);
    await saveData();
    res.json({ success: true, message: `Account for ${trimmedId} has been locked.` });
  });

  app.post("/api/admin/unlock-account", authenticate, async (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: "Forbidden" });
    const { employeeId } = req.body;
    const trimmedId = String(employeeId || '').trim().toLowerCase();
    const cleanId = trimmedId.replace(/^0+/, '');
    
    let unlocked = false;
    failedLoginAttempts.forEach(a => {
      const aId = String(a.employeeId || '').trim().toLowerCase();
      if (aId === trimmedId || aId.replace(/^0+/, '') === cleanId) {
        a.isLocked = false;
        a.attemptCount = 0;
        delete a.lockUntil;
        delete a.reason;
        unlocked = true;
      }
    });

    await logAdminAction(req.user, 'ACCOUNT_UNLOCKED', `Manually unlocked account for ${employeeId}`, undefined);
    await saveData();
    res.json({ success: true, unlocked });
  });

  function filterTasksForUser(taskList: any[], currentUser: any, allUsers: any[]): any[] {
    if (!currentUser || !currentUser.role) return [];
    
    // 1. Enterprise overview roles see all tasks
    const isSuperAdmin = currentUser.role === 'SUPER_ADMIN' || currentUser.employeeId === 'jhfboss';
    if (isSuperAdmin || ['CBO', 'DCBO', 'HOD', 'DHOD'].includes(currentUser.role)) {
      return taskList;
    }

    const currentEmpId = String(currentUser.employeeId || '').trim();
    const currentUserId = String(currentUser.id || '').trim();
    const currentName = String(currentUser.name || '').trim().toLowerCase();

    // 2. IN_CHARGE: authorized team workload
    if (currentUser.role === 'IN_CHARGE') {
      const myEngineers = allUsers.filter(u => 
        u.role === 'ENGINEER' && (
          (currentUser.assignedEngineers || []).includes(u.employeeId) || 
          u.supervisorId === currentUserId || 
          u.supervisorId === currentEmpId
        )
      );
      const myEngineerEmpIds = new Set(myEngineers.map(e => e.employeeId));
      
      const myOfficers = allUsers.filter(u => 
        u.role === 'OFFICER' && (
          (u.assignedEngineers || []).some(engId => myEngineerEmpIds.has(engId)) ||
          u.supervisorId === currentUserId ||
          u.supervisorId === currentEmpId ||
          myEngineers.some(e => u.supervisorId === e.id || u.supervisorId === e.employeeId) ||
          (currentUser.assignedEngineers || []).includes(u.employeeId)
        )
      );
      const myOfficerEmpIds = new Set(myOfficers.map(o => o.employeeId));
      const myOfficerIds = new Set(myOfficers.map(o => o.id));

      const myTechnicians = allUsers.filter(u => 
        u.role === 'TECHNICIAN' && (
          myOfficers.some(o => u.supervisorId === o.id || u.supervisorId === o.employeeId || (u.supervisor_ids || []).includes(o.employeeId))
        )
      );
      const myTechEmpIds = new Set(myTechnicians.map(t => t.employeeId));
      const myTechNames = new Set(myTechnicians.map(t => (t.name || '').toLowerCase()));

      return taskList.filter((t: any) => {
        if (!t) return false;
        if (t.inChargeId === currentEmpId || t.inChargeId === currentUserId || t.createdBy === currentEmpId || t.assignedBy === currentEmpId) return true;
        
        if (myEngineerEmpIds.has(t.createdBy) || myEngineerEmpIds.has(t.concernEngineerId || '') || myEngineerEmpIds.has(t.assignedBy) || myEngineerEmpIds.has(t.assignedTo) || myEngineerEmpIds.has(t.approvedBy || '') || myEngineerEmpIds.has(t.recommendedBy || '')) return true;
        
        if (myOfficerEmpIds.has(t.createdBy) || myOfficerIds.has(t.createdBy) || myOfficerEmpIds.has(t.responsibleOfficerId || '') || myOfficerEmpIds.has(t.assignedBy) || myOfficerEmpIds.has(t.assignedTo) || myOfficers.some(o => o.name && o.name.toLowerCase() === (t.assignedTo || '').toLowerCase())) return true;
        
        if (myTechEmpIds.has(t.assignedTo) || myTechNames.has((t.assignedTo || '').toLowerCase())) return true;
        if (t.workType === 'TEAM' && Array.isArray(t.assignedTechnicians)) {
          if (t.assignedTechnicians.some((at: any) => myTechEmpIds.has(at.employeeId) || myTechNames.has((at.name || '').toLowerCase()))) return true;
        }

        if (t.teamApprovals && Array.isArray(t.teamApprovals)) {
          if (t.teamApprovals.some((a: any) => myOfficerEmpIds.has(a.officerId) || myOfficerIds.has(a.officerId))) return true;
        }
        return false;
      });
    }

    // 3. MODEL_MANAGER: authorized model/section or engineers
    if (currentUser.role === 'MODEL_MANAGER') {
      const myEngineers = allUsers.filter(u => 
        u.role === 'ENGINEER' && (currentUser.assignedEngineers || []).includes(u.employeeId)
      );
      const myEngineerEmpIds = new Set(myEngineers.map(e => e.employeeId));

      return taskList.filter((t: any) => {
        if (!t) return false;
        if (t.modelManagerId === currentEmpId || t.modelManagerId === currentUserId || t.createdBy === currentEmpId || t.assignedBy === currentEmpId) return true;
        if (currentUser.section && t.model && currentUser.section.toLowerCase() === String(t.model).toLowerCase()) return true;
        if (myEngineerEmpIds.has(t.createdBy) || myEngineerEmpIds.has(t.concernEngineerId || '')) return true;
        return false;
      });
    }

    // 4. ENGINEER: authorized team workload (their supervised officers & technicians, or created/assigned by them)
    if (currentUser.role === 'ENGINEER') {
      const myOfficers = allUsers.filter(u => 
        u.role === 'OFFICER' && (
          (u.assignedEngineers || []).includes(currentEmpId) || 
          u.supervisorId === currentUserId || 
          u.supervisorId === currentEmpId
        )
      );
      const myOfficerEmpIds = new Set(myOfficers.map(o => o.employeeId));
      const myOfficerIds = new Set(myOfficers.map(o => o.id));

      const myTechnicians = allUsers.filter(u => 
        u.role === 'TECHNICIAN' && (
          myOfficers.some(o => u.supervisorId === o.id || u.supervisorId === o.employeeId || (u.supervisor_ids || []).includes(o.employeeId))
        )
      );
      const myTechEmpIds = new Set(myTechnicians.map(t => t.employeeId));
      const myTechNames = new Set(myTechnicians.map(t => (t.name || '').toLowerCase()));

      return taskList.filter((t: any) => {
        if (!t) return false;
        if (t.createdBy === currentEmpId || t.createdBy === currentUserId || t.assignedBy === currentEmpId || t.assignedTo === currentEmpId || t.assignedTo === currentUserId || (t.assignedTo && t.assignedTo.toLowerCase() === currentName)) return true;
        
        if (t.concernEngineerId === currentEmpId || t.concernEngineerId === currentUserId || t.approvedBy === currentEmpId || t.recommendedBy === currentEmpId) return true;

        if (myOfficerEmpIds.has(t.createdBy) || myOfficerIds.has(t.createdBy) || myOfficerEmpIds.has(t.responsibleOfficerId || '') || myOfficerEmpIds.has(t.assignedBy) || myOfficerEmpIds.has(t.assignedTo) || myOfficers.some(o => o.name && o.name.toLowerCase() === (t.assignedTo || '').toLowerCase())) return true;

        if (myTechEmpIds.has(t.assignedTo) || myTechNames.has((t.assignedTo || '').toLowerCase())) return true;
        if (t.workType === 'TEAM' && Array.isArray(t.assignedTechnicians)) {
          if (t.assignedTechnicians.some((at: any) => myTechEmpIds.has(at.employeeId) || myTechNames.has((at.name || '').toLowerCase()))) return true;
        }

        if (t.teamApprovals && Array.isArray(t.teamApprovals)) {
          if (t.teamApprovals.some((a: any) => myOfficerEmpIds.has(a.officerId) || myOfficerIds.has(a.officerId))) return true;
        }

        return false;
      });
    }

    // 5. OFFICER: Personal tasks only (strictly isolated from other officers' tasks)
    if (currentUser.role === 'OFFICER') {
      const myTechnicians = allUsers.filter(u => 
        u.role === 'TECHNICIAN' && isTechnicianSupervisedByOfficer(u, currentUser)
      );
      const myTechEmpIds = new Set(myTechnicians.map(t => t.employeeId));
      const myTechNames = new Set(myTechnicians.map(t => (t.name || '').toLowerCase()));

      return taskList.filter((t: any) => {
        if (!t) return false;
        // A. Tasks personally created by this Officer
        if (t.createdBy === currentEmpId || t.createdBy === currentUserId || (t.createdBy && t.createdBy.toLowerCase() === currentName)) return true;

        // B. Tasks assigned by this Officer
        if (t.assignedBy === currentEmpId || t.assignedBy === currentUserId) return true;

        // C. Tasks explicitly assigned to this Officer (e.g. by Engineer/Manager)
        if (t.assignedTo === currentEmpId || t.assignedTo === currentUserId || (t.assignedTo && t.assignedTo.toLowerCase() === currentName)) return true;
        if (t.responsibleOfficerId === currentEmpId || t.responsibleOfficerId === currentUserId) return true;

        // D. Tasks involving this Officer's supervised technicians
        if (myTechEmpIds.has(t.assignedTo) || myTechNames.has((t.assignedTo || '').toLowerCase())) return true;
        if (t.workType === 'TEAM' && Array.isArray(t.assignedTechnicians)) {
          if (t.assignedTechnicians.some((at: any) => myTechEmpIds.has(at.employeeId) || myTechNames.has((at.name || '').toLowerCase()))) return true;
        }

        // E. Cross-team borrowing requests for this Officer's technicians
        if (t.teamApprovals && Array.isArray(t.teamApprovals)) {
          if (t.teamApprovals.some((a: any) => a.officerId === currentEmpId || a.officerId === currentUserId || (a.officerName && a.officerName.toLowerCase() === currentName))) return true;
        }

        return false;
      });
    }

    // 6. TECHNICIAN: Tasks assigned to this technician
    if (currentUser.role === 'TECHNICIAN') {
      return taskList.filter((t: any) => {
        if (!t) return false;
        if (t.assignedTo === currentEmpId || t.assignedTo === currentUserId || (t.assignedTo && t.assignedTo.toLowerCase() === currentName)) return true;
        if (t.workType === 'TEAM' && Array.isArray(t.assignedTechnicians)) {
          return t.assignedTechnicians.some((at: any) => at.employeeId === currentEmpId || at.id === currentUserId || (at.name && at.name.toLowerCase() === currentName));
        }
        return false;
      });
    }

    return [];
  }

  function buildOrUpdateTeamApprovals(
    existingTask: any,
    assignedTechnicians: any[] | undefined,
    assignedToName: string | undefined,
    workType: string | undefined,
    creatorUser: any,
    allUsers: any[]
  ): any[] | undefined {
    const isTeam = workType === 'TEAM';
    const techList: any[] = [];

    if (isTeam && Array.isArray(assignedTechnicians)) {
      assignedTechnicians.forEach(at => {
        const tech = allUsers.find(u => 
          u.employeeId === at.employeeId || 
          u.id === at.employeeId || 
          u.id === at.id || 
          (u.name && at.name && u.name.toLowerCase() === at.name.toLowerCase())
        );
        if (tech && tech.role === 'TECHNICIAN') {
          techList.push(tech);
        }
      });
    } else if (assignedToName) {
      const tech = allUsers.find(u => 
        u.id === assignedToName || 
        u.employeeId === assignedToName || 
        (u.name && u.name.toLowerCase() === assignedToName.toLowerCase())
      );
      if (tech && tech.role === 'TECHNICIAN') {
        techList.push(tech);
      }
    }

    if (techList.length === 0) {
      return undefined;
    }

    // Identify home officers for borrowed technicians
    const approvalsMap = new Map<string, { officer: any; techIds: string[] }>();

    techList.forEach(tech => {
      // Find home officer
      const homeOfficer = allUsers.find(u => 
        u.role === 'OFFICER' && (
          u.id === tech.supervisorId || 
          u.employeeId === tech.supervisorId || 
          (tech.supervisor_ids || []).includes(u.employeeId)
        )
      );

      if (homeOfficer) {
        const isMyOwnTech = creatorUser.role === 'OFFICER' && (
          homeOfficer.id === creatorUser.id || 
          homeOfficer.employeeId === creatorUser.employeeId
        );

        if (!isMyOwnTech && creatorUser.role === 'OFFICER') {
          const offKey = homeOfficer.employeeId || homeOfficer.id;
          if (!approvalsMap.has(offKey)) {
            approvalsMap.set(offKey, { officer: homeOfficer, techIds: [] });
          }
          if (!approvalsMap.get(offKey)!.techIds.includes(tech.employeeId)) {
            approvalsMap.get(offKey)!.techIds.push(tech.employeeId);
          }
        }
      }
    });

    if (approvalsMap.size === 0) {
      return undefined;
    }

    const existingApprovals: any[] = Array.isArray(existingTask?.teamApprovals) ? existingTask.teamApprovals : [];
    const result: any[] = [];

    approvalsMap.forEach(({ officer, techIds }, offKey) => {
      const existing = existingApprovals.find(a => 
        a.officerId === offKey || 
        a.officerId === officer.id || 
        a.officerId === officer.employeeId
      );
      if (existing) {
        result.push({
          ...existing,
          technicianIds: techIds,
          officerName: officer.name
        });
      } else {
        result.push({
          officerId: officer.employeeId || officer.id,
          officerName: officer.name,
          technicianIds: techIds,
          status: 'PENDING'
        });
      }
    });

    return result;
  }

  app.get("/api/tasks", authenticate, (req: Request, res: Response) => {
    const { month, year, all } = req.query;
    const user = (req as any).user;
    
    // Filter tasks based on authenticated user's authorized role and relationships
    const userTasks = filterTasksForUser(tasks, user, users).map(decorateTaskWithTiming);

    // Default to all user-authorized tasks
    if (all === 'true' || !month || !year) {
      return res.json(userTasks);
    }

    const currentMonth = parseInt(month as string);
    const currentYear = parseInt(year as string);

    const filteredTasks = userTasks.filter((t: any) => {
      const taskDate = t.createdAt ? new Date(t.createdAt) : null;
      const completedDate = t.completedAt ? new Date(t.completedAt) : null;
      const deadlineDate = t.deadline ? new Date(t.deadline) : null;
      
      const isCreatedInMonth = taskDate && (taskDate.getMonth() + 1 === currentMonth && taskDate.getFullYear() === currentYear);
      const isCompletedInMonth = completedDate && (completedDate.getMonth() + 1 === currentMonth && completedDate.getFullYear() === currentYear);
      const isDeadlineInMonth = deadlineDate && (deadlineDate.getMonth() + 1 === currentMonth && deadlineDate.getFullYear() === currentYear);
      const isNotCompleted = t.status !== 'COMPLETED';

      return isCreatedInMonth || isCompletedInMonth || isDeadlineInMonth || isNotCompleted;
    });

    res.json(filteredTasks);
  });

  app.get("/api/tasks/:id", authenticate, (req: Request, res: Response) => {
    const { id } = req.params;
    const user = (req as any).user;
    const task = tasks.find(t => t.id === id || t.taskId === id);
    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }
    const visibleTasks = filterTasksForUser([task], user, users);
    if (visibleTasks.length === 0) {
      return res.status(403).json({ error: "Access Denied: You are not authorized to view this task." });
    }
    res.json(decorateTaskWithTiming(task));
  });

  app.get("/api/tasks/:id/timing", authenticate, (req: Request, res: Response) => {
    const { id } = req.params;
    const task = tasks.find(t => t.id === id || t.taskId === id);
    if (!task) return res.status(404).json({ error: "Task not found" });
    const timing = computeTaskTiming(task);
    res.json({
      taskId: task.id,
      timing,
      sessions: taskTimeSessions.filter(s => s.taskId === task.id),
      overtimeRequests: overtimeRequests.filter(o => o.taskId === task.id),
      extensionHistory: task.extensionHistory || [],
      auditLogs: taskTimerAuditLogs.filter(l => l.taskId === task.id)
    });
  });

  app.get("/api/tasks/:id/sessions", authenticate, (req: Request, res: Response) => {
    const { id } = req.params;
    const task = tasks.find(t => t.id === id || t.taskId === id);
    if (!task) return res.status(404).json({ error: "Task not found" });
    const timing = computeTaskTiming(task);
    res.json({
      taskId: task.id,
      sessions: taskTimeSessions.filter(s => s.taskId === task.id),
      breakdown: timing.breakdown,
      auditLogs: taskTimerAuditLogs.filter(l => l.taskId === task.id)
    });
  });

  app.post("/api/system/process-employees", authenticate, async (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: "Forbidden" });
    }
    try {
      let filePath = path.join(process.cwd(), "employee data.xlsx");
      if (!fsSync.existsSync(filePath)) {
        filePath = path.join(__dirname, "employee data.xlsx");
      }
      if (!fsSync.existsSync(filePath)) {
        return res.status(404).json({ error: "employee data.xlsx file not found on server" });
      }
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet);
      console.log(`Processing ${data.length} employees from Excel. First row keys:`, data.length > 0 ? Object.keys(data[0]) : 'None');

      let createdCount = 0;
      let updatedCount = 0;
      const hashCache = new Map<string, string>();
      const getHashed = async (id: string) => {
        if (hashCache.has(id)) return hashCache.get(id)!;
        const h = await bcrypt.hash(id, 8);
        hashCache.set(id, h);
        return h;
      };

      for (const row of data as any[]) {
        // Try multiple common column names for ID and Name
        const employeeId = (row.ID || row["Employee ID"] || row.employeeId || row["HRMS ID"] || "").toString().trim();
        const name = (row.Name || row["Employee Name"] || row.name || row["Name of Employee"] || "Unknown").toString().trim();
        const rawRole = (row.Role || row.role || row.Designation || row.designation || "TECHNICIAN").toString().trim().toUpperCase();
        
        // Extract additional fields
        let phone = (row.Phone || row["Phone Number"] || row.phone || row.Mobile || row.mobile || row["Mobile No"] || row["Mobile Number"] || row.Contact || row["Contact No"] || row["Phone No"] || row.Cell || row["Cell No"] || row["Cell Number"] || "").toString().trim();
        
        // Add leading zero if missing (common Excel issue)
        if (phone && !phone.startsWith('0') && /^\d+$/.test(phone)) {
          phone = '0' + phone;
        }

        const designation = (row.Designation || row.designation || row.Role || row.role || "").toString().trim();
        const email = (row.Email || row["Email Address"] || row.email || row["Email ID"] || row["E-mail"] || "").toString().trim();
        const department = (row.Department || row.department || row.Dept || row.dept || "RAC R&I").toString().trim();

        // Map common role names to system roles
        let role: string = "TECHNICIAN";
        const upperRole = rawRole.toUpperCase();
        
        if (employeeId === '17668') role = 'DHOD';
        else if (employeeId === '19219') role = 'HOD';
        else if (upperRole.includes('SUPER ADMIN') || upperRole === 'ADMIN') role = 'SUPER_ADMIN';
        else if (upperRole === 'CBO' || upperRole.includes('CHIEF BUSINESS OFFICER')) role = 'CBO';
        else if (upperRole === 'DCBO' || upperRole.includes('DEPUTY CHIEF BUSINESS OFFICER')) role = 'DCBO';
        else if (upperRole.includes('DHOD') || upperRole.includes('DEPUTY HEAD') || upperRole.includes('DEPUTY HOD')) role = 'DHOD';
        else if (upperRole.includes('HOD')) role = 'HOD';
        else if (upperRole.includes('INCHARGE') || upperRole.includes('IN-CHARGE') || upperRole === 'IN_CHARGE') role = 'IN_CHARGE';
        else if (upperRole.includes('MODEL MANAGER') || upperRole.includes('MODEL-MANAGER')) role = 'MODEL_MANAGER';
        else if (upperRole.includes('ENGINEER')) role = 'ENGINEER';
        else if (upperRole.includes('OFFICER')) role = 'OFFICER';
        else if (upperRole.includes('TECHNICIAN')) role = 'TECHNICIAN';
        else if (upperRole.includes('MANAGER')) role = 'MODEL_MANAGER';
        else if (upperRole.includes('SUPERVISOR')) role = 'IN_CHARGE';
        else {
          // Fallback mapping based on common titles if Role column is actually a Designation column
          if (upperRole.includes('MANAGER')) role = 'MODEL_MANAGER';
          else if (upperRole.includes('DHOD') || upperRole.includes('DEPUTY HEAD')) role = 'DHOD';
          else if (upperRole.includes('HOD')) role = 'HOD';
          else if (upperRole.includes('ENGINEER')) role = 'ENGINEER';
          else if (upperRole.includes('OFFICER')) role = 'OFFICER';
          else role = 'TECHNICIAN';
        }

        if (!employeeId) continue;
        if (excludedEmployeeIds.includes(employeeId) || excludedEmployeeIds.includes(email)) continue;

        const existingUser = users.find(u => u.employeeId.toString().toLowerCase() === employeeId.toLowerCase());
        const hashedPassword = (!existingUser || !existingUser.password) ? await getHashed(employeeId) : existingUser.password;

        if (existingUser) {
          // Keep existing password or set hashed
          if (!existingUser.password) existingUser.password = hashedPassword;
          // Also update other fields
          existingUser.name = name;
          existingUser.role = role as any;
          existingUser.phone = phone;
          existingUser.designation = designation;
          existingUser.email = email;
          existingUser.department = department;
          updatedCount++;
        } else {
          users.push({
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            employeeId,
            name,
            role: role as any,
            password: hashedPassword,
            supervisorId: "",
            assignedEngineers: [],
            phone,
            designation,
            email,
            department
          });
          createdCount++;
        }
      }

      await saveData();
      res.json({ message: "Employee data processed successfully", createdCount, updatedCount });
    } catch (err) {
      console.error("Error processing employee data:", err);
      res.status(500).json({ error: "Failed to process employee data: " + err.message });
    }
  });

  app.post("/api/system/backfill-points", authenticate, async (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: "Forbidden" });
    }
    recalculateAllPoints();
    await saveData();
    res.json({ message: `Points recalculated and backfilled.` });
  });

  app.post("/api/system/clear-tasks", authenticate, async (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: "Forbidden" });
    }
    tasks.forEach((t: any) => {
      if (t.id && !deletedTaskIds.includes(String(t.id).trim())) deletedTaskIds.push(String(t.id).trim());
      if (t.taskId && !deletedTaskIds.includes(String(t.taskId).trim())) deletedTaskIds.push(String(t.taskId).trim());
    });
    tasks.length = 0;
    attendanceRecords.length = 0;
    pointTransactions.length = 0;
    technicianPerformance.length = 0;
    assignmentRequests.length = 0;
    notifications.length = 0;
    adminAuditLogs.length = 0;
    
    // Reset points and task counts on all users, keep user and employee data intact
    users.forEach((u: any) => {
      u.total_point = 0;
      u.completedTask = 0;
      if (u.role === 'TECHNICIAN') {
        u.status = 'FREE';
      }
    });

    await saveData(true);
    await logAdminAction(req.user, 'CLEAR_TASKS', 'Cleared all dummy tasks and operational data, preserving employee and user records');
    res.json({ message: "All tasks and operational data cleared successfully. All employee and user accounts preserved.", userCount: users.length });
  });

  app.get("/api/system/backup", authenticate, (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: "Forbidden" });
    }
    const backupData = {
      users,
      tasks,
      attendanceRecords,
      notifications,
      pointTransactions,
      technicianPerformance,
      assignmentRequests,
      activityLogs,
      adminAuditLogs,
      userSessions,
      failedLoginAttempts,
      lockedDevices,
      shiftConfigurations,
      technicianShiftAssignments,
      taskTimeSessions,
      taskTimeExtensions,
      overtimeRequests,
      taskTimerAuditLogs,
      performanceConfig,
      autoBackupSettings,
      timestamp: new Date().toISOString()
    };
    res.json(backupData);
  });

  // --- Auto-Backup & Database Management Endpoints ---
  app.get("/api/system/backup-settings", authenticate, async (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: "Forbidden" });
    try {
      await fs.mkdir(BACKUPS_DIR, { recursive: true });
      const persistentBackups = await getPersistentBackupList();

      const backupsWithMeta = persistentBackups.slice(0, 100).map(b => ({
        filename: b.filename,
        timestamp: b.timestamp,
        size: b.sizeBytes,
        tasksCount: b.totalTasks,
        usersCount: b.totalUsers,
        type: b.type,
        details: b.metaDetails || null,
        verified: b.verified,
        sourceFolder: isMysqlEnabled() ? 'backups/ (Local MySQL & Server Disk)' : 'backups/ (Local Server Disk)'
      }));

      res.json({
        autoBackupEnabled: autoBackupSettings.enabled,
        intervalMinutes: autoBackupSettings.intervalMinutes,
        lastBackupTime: autoBackupSettings.lastBackupTime,
        nextBackupTime: autoBackupSettings.nextBackupTime,
        sourceFolder: isMysqlEnabled() ? 'backups/ (Local MySQL & Server Disk)' : 'backups/ (Local Server Disk)',
        liveStats: {
          tasksCount: tasks.length,
          usersCount: users.length,
          attendanceCount: attendanceRecords.length
        },
        cloudQuota: getLocalDbStatus(),
        backups: backupsWithMeta
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to fetch backup settings: " + err.message });
    }
  });

  app.get("/api/system/cloud-status", async (req: Request, res: Response) => {
    const health = await checkMysqlDbHealth();
    res.json({ ...getLocalDbStatus(), health });
  });

  app.get("/api/system/db-status", async (req: Request, res: Response) => {
    const health = await checkMysqlDbHealth();
    res.json({ ...getLocalDbStatus(), health });
  });

  app.post("/api/system/backup-settings", authenticate, async (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: "Forbidden" });
    const { enabled, intervalMinutes } = req.body;
    if (typeof enabled === 'boolean') {
      autoBackupSettings.enabled = enabled;
    }
    if (typeof intervalMinutes === 'number' && intervalMinutes >= 5) {
      autoBackupSettings.intervalMinutes = intervalMinutes;
    }
    startAutoBackupSchedule();
    await saveData();
    await logAdminAction(req.user, 'UPDATE_BACKUP_SETTINGS', `Updated auto-backup configuration: enabled=${autoBackupSettings.enabled}, interval=${autoBackupSettings.intervalMinutes}m`);
    res.json({ success: true, settings: autoBackupSettings });
  });

  app.post("/api/system/backup-now", authenticate, async (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: "Forbidden" });
    try {
      const backupInfo = await createHourlyBackup(true);
      await logAdminAction(req.user, 'MANUAL_BACKUP', `Manual DB snapshot created: ${backupInfo.filename} with ${tasks.length} tasks, ${users.length} users`);
      res.json({ message: "Database snapshot created successfully!", backup: backupInfo });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to create database snapshot: " + err.message });
    }
  });

  app.get("/api/system/download-db", authenticate, async (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: "Forbidden" });
    try {
      await saveData();
      const filePath = fsSync.existsSync(DB_FILE) ? DB_FILE : DATA_FILE;
      res.download(filePath, `rac-ri-daily-work-db-${new Date().toISOString().slice(0, 10)}.json`);
    } catch (err: any) {
      res.status(500).json({ error: "Failed to download database file: " + err.message });
    }
  });

  app.get("/api/system/backups/:filename", authenticate, async (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: "Forbidden" });
    const filename = path.basename(req.params.filename);
    const filePath = path.join(BACKUPS_DIR, filename);
    if (fsSync.existsSync(filePath)) {
      return res.download(filePath, filename);
    }
    // Fallback to durable MySQL backup snapshots table
    const cloudData = await getPersistentBackupData(filename);
    if (!cloudData) {
      return res.status(404).json({ error: "Backup snapshot file not found on disk or MySQL" });
    }
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(cloudData, null, 2));
  });

  app.post("/api/system/restore-backup", authenticate, async (req: Request, res: Response) => {
    if (req.user.role !== 'SUPER_ADMIN') return res.status(403).json({ error: "Forbidden" });
    const { filename } = req.body;
    if (!filename) return res.status(400).json({ error: "Filename is required" });

    const safeName = path.basename(filename);
    const filePath = path.join(BACKUPS_DIR, safeName);

    try {
      let data: any = null;
      if (fsSync.existsSync(filePath)) {
        const content = await fs.readFile(filePath, "utf-8");
        data = JSON.parse(content);
      } else {
        data = await getPersistentBackupData(safeName);
      }

      if (!data) {
        return res.status(404).json({ error: "Backup snapshot file not found on disk or cloud" });
      }
      
      const replaceArray = (target: any[], source: any) => {
        if (Array.isArray(source)) {
          target.length = 0;
          for (const item of source) target.push(item);
          return true;
        }
        return false;
      };

      if (Array.isArray(data.deletedTaskIds)) {
        data.deletedTaskIds.forEach((id: any) => {
          const sId = String(id).trim();
          if (sId && !deletedTaskIds.includes(sId)) deletedTaskIds.push(sId);
        });
      }

      const safeTasksSnapshot = (Array.isArray(data.tasks) ? data.tasks : []).filter((t: any) => {
        if (!t) return false;
        const tId = String(t.id || '').trim();
        const tTaskId = String(t.taskId || '').trim();
        return (!tId || !deletedTaskIds.includes(tId)) && (!tTaskId || !deletedTaskIds.includes(tTaskId));
      });

      replaceArray(users, data.users);
      replaceArray(tasks, safeTasksSnapshot);
      replaceArray(attendanceRecords, data.attendanceRecords);
      replaceArray(notifications, data.notifications);
      replaceArray(pointTransactions, data.pointTransactions);
      replaceArray(technicianPerformance, data.technicianPerformance);
      replaceArray(assignmentRequests, data.assignmentRequests);
      replaceArray(activityLogs, data.activityLogs);
      replaceArray(adminAuditLogs, data.adminAuditLogs);
      replaceArray(failedLoginAttempts, data.failedLoginAttempts);
      replaceArray(lockedDevices, data.lockedDevices);
      if (Array.isArray(data.shiftConfigurations) && data.shiftConfigurations.length > 0) {
        replaceArray(shiftConfigurations, data.shiftConfigurations);
      }
      replaceArray(technicianShiftAssignments, data.technicianShiftAssignments);
      replaceArray(taskTimeSessions, data.taskTimeSessions);
      replaceArray(taskTimeExtensions, data.taskTimeExtensions);
      replaceArray(overtimeRequests, data.overtimeRequests);
      replaceArray(taskTimerAuditLogs, data.taskTimerAuditLogs);
      if (data.performanceConfig) {
        performanceConfig = { ...DEFAULT_PERFORMANCE_CONFIG, ...data.performanceConfig };
      }

      recalculateAllPoints();
      rebuildTechnicianStatuses();
      await saveData(true);

      await logAdminAction(req.user, 'RESTORE_BACKUP', `Restored system from backup snapshot: ${safeName} (${tasks.length} tasks, ${users.length} users)`);
      res.json({
        message: `System successfully restored from ${safeName}!`,
        tasksCount: tasks.length,
        usersCount: users.length
      });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to restore backup snapshot: " + err.message });
    }
  });

  app.post("/api/system/restore", authenticate, async (req: Request, res: Response) => {
    console.log(`Full system restore request received from user: ${req.user.name} (${req.user.role})`);
    if (req.user.role !== 'SUPER_ADMIN') {
      console.warn(`Unauthorized restore attempt by user: ${req.user.name}`);
      return res.status(403).json({ error: "Forbidden" });
    }
    
    const data = req.body;
    
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: "Invalid backup data" });
    }

    try {
      // Helper to safely replace array content without stack overflow
      const replaceArray = (target: any[], source: any) => {
        if (Array.isArray(source)) {
          target.length = 0;
          // Use a loop instead of spread operator to avoid stack overflow on large arrays
          for (const item of source) {
            target.push(item);
          }
          return true;
        }
        return false;
      };

      // Restore all major data arrays
      if (Array.isArray(data.deletedTaskIds)) {
        data.deletedTaskIds.forEach((id: any) => {
          const sId = String(id).trim();
          if (sId && !deletedTaskIds.includes(sId)) deletedTaskIds.push(sId);
        });
      }

      const safeTasksRestore = (Array.isArray(data.tasks) ? data.tasks : []).filter((t: any) => {
        if (!t) return false;
        const tId = String(t.id || '').trim();
        const tTaskId = String(t.taskId || '').trim();
        return (!tId || !deletedTaskIds.includes(tId)) && (!tTaskId || !deletedTaskIds.includes(tTaskId));
      });

      replaceArray(users, data.users);
      replaceArray(tasks, safeTasksRestore);
      replaceArray(attendanceRecords, data.attendanceRecords);
      replaceArray(notifications, data.notifications);
      replaceArray(pointTransactions, data.pointTransactions);
      replaceArray(technicianPerformance, data.technicianPerformance);
      replaceArray(assignmentRequests, data.assignmentRequests);
      replaceArray(activityLogs, data.activityLogs);
      replaceArray(adminAuditLogs, data.adminAuditLogs);
      replaceArray(failedLoginAttempts, data.failedLoginAttempts);
      replaceArray(lockedDevices, data.lockedDevices);
      if (Array.isArray(data.shiftConfigurations) && data.shiftConfigurations.length > 0) {
        replaceArray(shiftConfigurations, data.shiftConfigurations);
      }
      replaceArray(technicianShiftAssignments, data.technicianShiftAssignments);
      replaceArray(taskTimeSessions, data.taskTimeSessions);
      replaceArray(taskTimeExtensions, data.taskTimeExtensions);
      replaceArray(overtimeRequests, data.overtimeRequests);
      replaceArray(taskTimerAuditLogs, data.taskTimerAuditLogs);
      if (data.performanceConfig) {
        performanceConfig = { ...DEFAULT_PERFORMANCE_CONFIG, ...data.performanceConfig };
      }
      
      // Special handling for userSessions: 
      // We want to keep the current session active if possible, 
      // but also restore other sessions if they are in the backup.
      if (Array.isArray(data.userSessions)) {
        const currentSessionId = req.user.sessionId;
        const currentSession = userSessions.find(s => s.id === currentSessionId);
        
        userSessions.length = 0;
        for (const session of data.userSessions) {
          userSessions.push(session);
        }
        
        // Ensure current session is in the list and active
        const sessionInRestored = userSessions.find(s => s.id === currentSessionId);
        if (sessionInRestored) {
          sessionInRestored.active = true;
          sessionInRestored.logoutTime = undefined;
        } else if (currentSession) {
          currentSession.active = true;
          userSessions.push(currentSession);
        }
      }

      recalculateAllPoints();
      rebuildTechnicianStatuses();
      await saveData(true);
      console.log('System fully restored successfully');
      res.json({ 
        message: "System restored successfully", 
        userCount: users.length, 
        taskCount: tasks.length, 
        attendanceCount: attendanceRecords.length 
      });
    } catch (err) {
      console.error('Error during system restore:', err);
      res.status(500).json({ error: "Internal server error during restore" });
    }
  });

  app.post("/api/tasks", authenticate, async (req: Request, res: Response) => {
    const user = (req as any).user;
    
    // Task Creation Restriction (STRICT RULE)
    const allowedCreators = ['SUPER_ADMIN', 'CBO', 'DCBO', 'HOD', 'DHOD', 'IN_CHARGE', 'MODEL_MANAGER', 'ENGINEER', 'OFFICER'];
    if (!allowedCreators.includes(user.role)) {
      return res.status(403).json({ error: "Access Denied: Your role is not authorized to create tasks." });
    }

    // Strict Assignment Rule for Officers
    const { urgency, points, assignedTechnicians } = req.body;
    const assignedToName = req.body.assignedTo || (req.body.workType === 'TEAM' && Array.isArray(assignedTechnicians) && assignedTechnicians.length > 0 ? assignedTechnicians[0].name : '');
    const workType = req.body.workType;
    
    if (user.role === 'OFFICER') {
      if (!assignedToName && workType !== 'TEAM') {
        return res.status(400).json({ error: "Task must be assigned to a Technician." });
      }
      if (assignedToName && assignedToName !== 'Team Work') {
        const targetUser = users.find(u => u.id === assignedToName || u.name === assignedToName || u.employeeId === assignedToName);
        if (!targetUser || targetUser.role !== 'TECHNICIAN') {
          return res.status(403).json({ error: "Access Denied: Officers can only assign tasks to Technicians." });
        }
      }
      if (workType === 'TEAM' && Array.isArray(assignedTechnicians)) {
        for (const at of assignedTechnicians) {
          const tech = users.find(u => u.employeeId === at.employeeId || u.id === at.id || u.name === at.name);
          if (!tech || tech.role !== 'TECHNICIAN') {
            return res.status(403).json({ error: `Access Denied: ${at.name || 'Technician'} is not a valid technician.` });
          }
        }
      }
    }
    
    // Point Validation
    if (urgency === 'REGULAR' && points > 1) {
      return res.status(400).json({ error: "Regular work cannot exceed 1 point." });
    }
    if (urgency === 'URGENT' && points > 2) {
      return res.status(400).json({ error: "Urgent work cannot exceed 2 points." });
    }
    if (urgency === 'MOST_URGENT') {
      if (user.role !== 'ENGINEER' && user.role !== 'SUPER_ADMIN' && user.role !== 'CBO' && user.role !== 'DCBO' && user.role !== 'HOD' && user.role !== 'DHOD') {
        return res.status(403).json({ error: "Only Engineers or higher can assign Most Urgent tasks." });
      }
      if (points > 3) {
        return res.status(400).json({ error: "Most Urgent work cannot exceed 3 points." });
      }
    }

    const targetUser = users.find(u => u.id === assignedToName || u.name === assignedToName || u.employeeId === assignedToName);

    let status: TaskStatus = "PENDING";
    let requestStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'RECOMMENDED' | undefined = undefined;

    const teamApprovals = buildOrUpdateTeamApprovals(undefined, assignedTechnicians, assignedToName, workType, user, users);
    const hasOtherTeamTech = teamApprovals && teamApprovals.some((a: any) => a.status === 'PENDING');

    if (user.role === 'OFFICER') {
      // Officer creates task -> goes to Recommendation Panel
      // Officer can ONLY create tasks for Technicians
      const targetTechs = workType === 'TEAM' ? assignedTechnicians : [targetUser];
      const allTechs = targetTechs.every((t: any) => {
        const u = users.find(usr => usr.employeeId === (t?.employeeId || t?.name) || usr.name === (t?.name || t?.employeeId) || usr.id === (t?.id || t?.employeeId));
        return u && u.role === 'TECHNICIAN';
      });

      if (!allTechs) {
        return res.status(403).json({ error: "Officers can only create tasks for Technicians." });
      }

      if (hasOtherTeamTech) {
        // STRICT FLOW: Officer -> Request -> Technician Supervisor
        status = "REQUESTED";
        requestStatus = "PENDING";
      } else {
        // Own Technician -> Direct Assign
        status = "RUNNING";
        requestStatus = "RECOMMENDED";
      }
    } else if (workType === 'TEAM') {
      if (!assignedTechnicians || assignedTechnicians.length < 2) {
        return res.status(400).json({ error: "Team work requires at least 2 technicians." });
      }
      
      if (hasOtherTeamTech) {
        status = "REQUESTED";
        requestStatus = "PENDING";
      } else {
        status = "RUNNING";
      }
    } else if (targetUser && targetUser.role === 'TECHNICIAN') {
      if (user.role !== 'ENGINEER' && targetUser.supervisorId !== user.id) {
        status = "REQUESTED";
        requestStatus = "PENDING";
      } else {
        status = "RUNNING";
      }
    } else if (targetUser && (targetUser.role === 'HOD' || targetUser.role === 'DHOD' || targetUser.role === 'DCBO' || targetUser.role === 'IN_CHARGE' || targetUser.role === 'MODEL_MANAGER' || targetUser.role === 'ENGINEER' || targetUser.role === 'OFFICER')) {
      // Executive / Manager task assignment (e.g. CBO/DCBO -> HOD/DHOD, Engineer -> Officer)
      status = "PENDING";
      requestStatus = "APPROVED";
    }

    // Populate traceable hierarchy fields on creation
    const responsibleOfficerId = user.role === 'OFFICER' ? user.employeeId : (targetUser?.role === 'OFFICER' ? targetUser.employeeId : req.body.responsibleOfficerId);
    const concernEngineerId = user.role === 'ENGINEER'
      ? user.employeeId
      : (targetUser?.role === 'ENGINEER' ? targetUser.employeeId : req.body.concernEngineerId);
    const dhodObj = users.find(u => u.role === 'DHOD' || u.employeeId === '17668');
    const hodObj = users.find(u => u.role === 'HOD' || u.employeeId === '19219');

    const resolvedAssignedTo = targetUser ? targetUser.name : assignedToName;
    const normalizedCustomStart = req.body.customStartTime
      ? (!isNaN(parseTaskDate(req.body.customStartTime).getTime()) ? parseTaskDate(req.body.customStartTime).toISOString() : req.body.customStartTime)
      : '';

    const newTask: Task = {
      ...req.body,
      assignedTo: resolvedAssignedTo,
      id: Date.now().toString(),
      taskId: `${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${new Date().getHours()}${new Date().getMinutes()}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`,
      createdAt: new Date().toISOString(),
      createdBy: user.employeeId,
      assignedBy: user.employeeId,
      responsibleOfficerId,
      concernEngineerId,
      dhodId: dhodObj?.employeeId || '17668',
      hodId: hodObj?.employeeId || '19219',
      status: status,
      requestStatus: requestStatus as any,
      startedAt: user.role === 'OFFICER' ? (normalizedCustomStart || new Date().toISOString()) : (normalizedCustomStart || undefined),
      progress: req.body.progress || 0,
      points: user.role === 'OFFICER' ? 0 : (req.body.points || 1),
      engineerApproved: user.role === 'OFFICER' ? false : true,
      teamApprovals: teamApprovals,
      customStartTime: normalizedCustomStart,
      estimatedDuration: req.body.estimatedDuration || '',
      originalEstimatedDuration: req.body.originalEstimatedDuration || req.body.estimatedDuration || '',
      revisedEstimatedDuration: req.body.revisedEstimatedDuration || req.body.estimatedDuration || '',
      workType: workType || 'SINGLE',
      assignedTechnicians: workType === 'TEAM' && Array.isArray(assignedTechnicians) ? assignedTechnicians.map((t: any) => ({
        ...t,
        progress: 0,
        status: status === 'RUNNING' ? 'RUNNING' : 'PENDING',
        startedAt: status === 'RUNNING' ? (normalizedCustomStart || new Date().toISOString()) : undefined
      })) : undefined,
      logs: [{
        id: Date.now().toString(),
        action: user.role === 'OFFICER' ? (hasOtherTeamTech ? "Task Requested (Cross-Team Technicians)" : "Task Created (Sent for Engineer Recommendation)") : (status === "REQUESTED" ? "Task Requested (Cross-Team)" : "Task Created"),
        timestamp: new Date().toISOString(),
        user: user.name
      }]
    };

    if (status === "RUNNING") {
      newTask.startedAt = normalizedCustomStart || new Date().toISOString();
      if (workType !== 'TEAM') {
        newTask.logs.push({
          id: (Date.now() + 1).toString(),
          action: `Task assigned to ${targetUser?.name} - Started`,
          timestamp: new Date().toISOString(),
          user: "System"
        });
      }
    }

    tasks.push(newTask);
    
    // Update Technician Status to WORKING
    if (status === "RUNNING" || (user.role === 'OFFICER' && status === 'PENDING' && requestStatus === 'RECOMMENDED')) {
      if (workType === 'TEAM' && Array.isArray(assignedTechnicians)) {
        assignedTechnicians.forEach((at: any) => {
          const tech = users.find(u => u.employeeId === at.employeeId);
          if (tech) tech.status = 'WORKING';
        });
      } else if (assignedToName) {
        const tech = users.find(u => u.id === assignedToName || u.name === assignedToName || u.employeeId === assignedToName);
        if (tech && tech.role === 'TECHNICIAN') tech.status = 'WORKING';
      }
    }

    // Add notification for the assignee (if not recommended)
    if (assignedToName && status !== 'PENDING') {
      const targetUser = users.find(u => u.id === assignedToName || u.name === assignedToName || u.employeeId === assignedToName);
      if (targetUser) {
        notifications.push({
          id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
          userId: targetUser.id,
          senderId: user.id,
          taskId: newTask.id,
          type: 'TASK_ASSIGNED',
          message: `${user.role} ${user.name} assigned you a task: ${req.body.title}`,
          read: false,
          timestamp: new Date().toISOString()
        });
      }
    }

    // Add notification for Engineers if recommended
    if (status === 'PENDING' && requestStatus === 'RECOMMENDED') {
      const assignedEngIds = user.assignedEngineers || [];
      assignedEngIds.forEach((engId: string) => {
        const eng = users.find(u => u.employeeId === engId);
        if (eng) {
          notifications.push({
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            userId: eng.id,
            senderId: user.id,
            taskId: newTask.id,
            type: 'TASK_RECOMMENDATION',
            message: `Officer ${user.name} created a task for recommendation: ${req.body.title}`,
            read: false,
            timestamp: new Date().toISOString()
          });
        }
      });
    }

    // Add notification for team members
    if (workType === 'TEAM' && Array.isArray(assignedTechnicians)) {
      assignedTechnicians.forEach((at: any) => {
        const targetUser = users.find(u => u.employeeId === at.employeeId);
        if (targetUser) {
          notifications.push({
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            userId: targetUser.id,
            senderId: user.id,
            taskId: newTask.id,
            type: 'TASK_ASSIGNED',
            message: `${user.role} ${user.name} assigned you a team task: ${req.body.title}`,
            read: false,
            timestamp: new Date().toISOString()
          });
        }
      });
    }

    recalculateAllPoints();
    await saveData();
    saveSingleMysqlTask(newTask).catch(err => console.error("[MYSQL SYNC ERROR] Task create sync:", err?.message || err));

    // Auto-backup triggered immediately on new task entry
    createHourlyBackup('TASK_ENTRY', undefined, {
      taskId: newTask.taskId || newTask.id,
      title: newTask.title,
      createdBy: newTask.createdBy || user.employeeId,
      assignedTo: newTask.assignedTo,
      workType: newTask.workType
    }).catch(err => console.error("[AUTO-BACKUP ERROR] Task entry backup failed:", err));

    broadcastRealtimeUpdate({ type: 'TASK_CREATED', taskId: newTask.id });
    res.status(201).json(newTask);
  });

  // Recommendation Handler function for In-Charge, HOD, DHOD, Super Admin, and Concern Engineers
  async function handleEngineerRecommendation(task: any, user: any, points: any, engineer_deadline: any, res: Response, selectedConcernEngId?: string) {
    const creator = users.find(u => u.employeeId === task.createdBy || u.id === task.createdBy);
    const isLeadership = ['SUPER_ADMIN', 'HOD', 'DHOD', 'IN_CHARGE', 'CBO', 'DCBO'].includes(user.role);
    
    // Leadership roles (In-Charge, HOD, DHOD, Super Admin) or authorized Concern Engineer can recommend points
    const isAuthorized = isLeadership || (user.role === 'ENGINEER' && creator && (
      (creator.assignedEngineers || []).includes(user.employeeId) ||
      creator.supervisorId === user.id ||
      creator.supervisorId === user.employeeId ||
      task.concernEngineerId === user.employeeId
    ));

    if (!isAuthorized) {
      return res.status(403).json({ error: "Access Denied: Only In-Charge, HOD, DHOD, and authorized Concern Engineers can recommend this Officer's tasks." });
    }

    // Determine the Concern Engineer who will receive the task points
    let targetConcernEngineer: any = null;
    if (selectedConcernEngId) {
      targetConcernEngineer = users.find(u => (u.employeeId === selectedConcernEngId || u.id === selectedConcernEngId) && u.role === 'ENGINEER');
    }
    if (!targetConcernEngineer && task.concernEngineerId) {
      targetConcernEngineer = users.find(u => (u.employeeId === task.concernEngineerId || u.id === task.concernEngineerId) && u.role === 'ENGINEER');
    }
    if (!targetConcernEngineer && user.role === 'ENGINEER') {
      targetConcernEngineer = user;
    }
    if (!targetConcernEngineer && creator) {
      if (Array.isArray(creator.assignedEngineers) && creator.assignedEngineers.length > 0) {
        targetConcernEngineer = users.find(u => creator.assignedEngineers.includes(u.employeeId) && u.role === 'ENGINEER');
      }
      if (!targetConcernEngineer && creator.supervisorId) {
        const sup = users.find(u => (u.id === creator.supervisorId || u.employeeId === creator.supervisorId) && u.role === 'ENGINEER');
        if (sup) targetConcernEngineer = sup;
      }
    }
    if (!targetConcernEngineer) {
      targetConcernEngineer = users.find(u => u.role === 'ENGINEER');
    }

    const assignedPoints = Math.max(1, Math.min(3, Number(points) || Number(task.points) || 1));
    task.points = assignedPoints;
    task.recommendedPoints = assignedPoints;
    task.engineerApproved = true;
    task.recommendedBy = user.employeeId;
    task.recommendedRole = user.role;
    task.recommendedByName = user.name;
    task.recommendedAt = new Date().toISOString();
    task.approvedBy = user.employeeId;

    if (targetConcernEngineer) {
      task.concernEngineerId = targetConcernEngineer.employeeId;
    }

    if (engineer_deadline) {
      task.engineer_deadline = engineer_deadline;
    }

    if (task.status === 'PENDING' && (task.requestStatus === 'RECOMMENDED' || task.requestStatus === 'PENDING')) {
      task.status = "RUNNING";
      task.requestStatus = "APPROVED";
      task.startedAt = task.startedAt || new Date().toISOString();
    } else if (task.requestStatus === 'RECOMMENDED' || !task.requestStatus || task.requestStatus === 'PENDING') {
      task.requestStatus = "APPROVED";
    }

    const roleTitle = user.role === 'IN_CHARGE' ? 'In-Charge' : user.role === 'HOD' ? 'HOD' : user.role === 'DHOD' ? 'DHOD' : user.role === 'ENGINEER' ? 'Engineer' : user.role;
    const engineerNote = targetConcernEngineer ? ` (Points credited to Concern Engineer ${targetConcernEngineer.name} [${targetConcernEngineer.employeeId}])` : '';

    task.logs.push({
      id: Date.now().toString(),
      action: `Task Recommended & ${assignedPoints} Points Approved by ${roleTitle} ${user.name}${engineerNote}`,
      timestamp: new Date().toISOString(),
      user: user.name
    });

    if (creator) {
      notifications.push({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        userId: creator.id,
        message: `${roleTitle} ${user.name} recommended and assigned ${assignedPoints} points for your task "${task.title}".`,
        read: false,
        timestamp: new Date().toISOString()
      });
    }

    if (targetConcernEngineer && targetConcernEngineer.id !== user.id) {
      notifications.push({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        userId: targetConcernEngineer.id,
        message: `${roleTitle} ${user.name} recommended Officer task "${task.title}" and awarded +${assignedPoints} points to your profile!`,
        read: false,
        timestamp: new Date().toISOString()
      });
    }

    recalculateAllPoints();
    await saveData();
    saveSingleMysqlTask(task).catch(err => console.error("[MYSQL SYNC ERROR] Recommendation sync:", err?.message || err));
    broadcastRealtimeUpdate({ type: 'POINTS_UPDATED', taskId: task.id });
    return res.json(task);
  }

  app.put("/api/tasks/:id/recommend", authenticate, async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { id } = req.params;
    const { points, engineer_deadline, concernEngineerId } = req.body;
    const taskIndex = tasks.findIndex(t => t.id === id || t.taskId === id);
    if (taskIndex === -1) return res.status(404).json({ error: "Task not found" });
    const task = tasks[taskIndex];

    if (!['IN_CHARGE', 'HOD', 'DHOD', 'SUPER_ADMIN', 'CBO', 'DCBO', 'ENGINEER'].includes(user.role)) {
      return res.status(403).json({ error: "Access Denied: Only In-Charge, HOD, DHOD, and authorized personnel can recommend tasks." });
    }
    return handleEngineerRecommendation(task, user, points, engineer_deadline, res, concernEngineerId);
  });

  app.post("/api/tasks/:id/recommend", authenticate, async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { id } = req.params;
    const { points, engineer_deadline, concernEngineerId } = req.body;
    const taskIndex = tasks.findIndex(t => t.id === id || t.taskId === id);
    if (taskIndex === -1) return res.status(404).json({ error: "Task not found" });
    const task = tasks[taskIndex];

    if (!['IN_CHARGE', 'HOD', 'DHOD', 'SUPER_ADMIN', 'CBO', 'DCBO', 'ENGINEER'].includes(user.role)) {
      return res.status(403).json({ error: "Access Denied: Only In-Charge, HOD, DHOD, and authorized personnel can recommend tasks." });
    }
    return handleEngineerRecommendation(task, user, points, engineer_deadline, res, concernEngineerId);
  });

  app.put("/api/tasks/:id/approve", authenticate, async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { id } = req.params;
    const { points, engineer_deadline, concernEngineerId } = req.body;
    const taskIndex = tasks.findIndex(t => t.id === id || t.taskId === id);

    if (taskIndex === -1) return res.status(404).json({ error: "Task not found" });
    const task = tasks[taskIndex];

    // Branch A: Recommendation & Point Approval by In-Charge, HOD, DHOD, Super Admin, or Concern Engineer
    if (['IN_CHARGE', 'HOD', 'DHOD', 'SUPER_ADMIN', 'CBO', 'DCBO', 'ENGINEER'].includes(user.role)) {
      return handleEngineerRecommendation(task, user, points, engineer_deadline, res, concernEngineerId);
    }

    // Branch B: Supervisor / Officer Team Request Approval
    if (user.role === 'OFFICER') {
      // 1. Requesting Officer CANNOT approve requests on behalf of other teams
      if (task.createdBy === user.employeeId || task.createdBy === user.id) {
        return res.status(403).json({ error: "Access Denied: The requesting Officer cannot approve requests on behalf of other teams." });
      }

      // 2. Identify the home team approval for this Officer
      let matchingApproval = null;
      if (task.teamApprovals && Array.isArray(task.teamApprovals)) {
        matchingApproval = task.teamApprovals.find((a: any) => 
          (a.officerId === user.employeeId || a.officerId === user.id || (a.officerName && a.officerName.toLowerCase() === user.name.toLowerCase())) &&
          a.status === 'PENDING'
        );
      }

      // Check legacy single-work technician supervisor
      const isTargetTechSupervisor = () => {
        const targetTech = users.find(u => u.employeeId === task.assignedTo || u.id === task.assignedTo || (u.name && u.name.toLowerCase() === (task.assignedTo || '').toLowerCase()));
        return targetTech && (targetTech.supervisorId === user.id || targetTech.supervisorId === user.employeeId || (targetTech.supervisor_ids || []).includes(user.employeeId));
      };

      if (!matchingApproval && !isTargetTechSupervisor()) {
        return res.status(403).json({ error: "Access Denied: Only the authorized concern Officer responsible for the technician's team can approve this request." });
      }

      // 3. Approve this team's portion
      if (matchingApproval) {
        matchingApproval.status = 'APPROVED';
        matchingApproval.approvedBy = user.employeeId;
        matchingApproval.approvedAt = new Date().toISOString();

        if (Array.isArray(task.assignedTechnicians)) {
          task.assignedTechnicians.forEach((at: any) => {
            if (matchingApproval.technicianIds.includes(at.employeeId)) {
              at.status = 'RUNNING';
            }
          });
        }
      }

      task.logs.push({
        id: Date.now().toString(),
        action: `Team Request Approved by Officer ${user.name} for team technicians`,
        timestamp: new Date().toISOString(),
        user: user.name
      });

      // 4. Multi-team validation: Does the task still have other pending team approvals?
      const remainingPending = (task.teamApprovals || []).filter((a: any) => a.status === 'PENDING');
      
      if (remainingPending.length > 0) {
        // Overall task remains PENDING / REQUESTED and cannot start yet
        task.status = "REQUESTED";
        task.requestStatus = "PENDING";
      } else {
        // All required team approvals have now been approved!
        task.status = "RUNNING";
        task.requestStatus = "APPROVED";
        task.startedAt = task.startedAt || new Date().toISOString();

        if (Array.isArray(task.assignedTechnicians)) {
          task.assignedTechnicians.forEach((at: any) => {
            at.status = 'RUNNING';
            const techObj = users.find(u => u.employeeId === at.employeeId);
            if (techObj) techObj.status = 'WORKING';
          });
        } else if (task.assignedTo) {
          const techObj = users.find(u => u.employeeId === task.assignedTo || u.id === task.assignedTo || u.name === task.assignedTo);
          if (techObj) techObj.status = 'WORKING';
        }
      }

      // CRITICAL: Team request approval grants ONLY permission to use technicians, NOT performance points!
      // Do NOT set engineerApproved = true here. Points remain unconfirmed until Engineer recommends.

      // Notify requester
      const requester = users.find(u => u.employeeId === task.createdBy || u.employeeId === task.assignedBy);
      if (requester) {
        notifications.push({
          id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
          userId: requester.id,
          message: `Officer ${user.name} approved the technician borrowing request for task "${task.title}".`,
          read: false,
          timestamp: new Date().toISOString()
        });
      }

      await saveData();
      saveSingleMysqlTask(task).catch(err => console.error("[MYSQL SYNC ERROR] Team approval sync:", err?.message || err));
      return res.json(task);
    }

    // Branch C: Super Admin / HOD / Executive
    const isExecutive = user.role === 'SUPER_ADMIN' || user.role === 'HOD' || user.role === 'DHOD' || user.role === 'CBO' || user.role === 'DCBO';
    if (isExecutive) {
      task.status = "RUNNING";
      task.requestStatus = "APPROVED";
      task.startedAt = task.startedAt || new Date().toISOString();
      if (task.teamApprovals) {
        task.teamApprovals.forEach((a: any) => { a.status = 'APPROVED'; });
      }
      task.logs.push({
        id: Date.now().toString(),
        action: `Task Request Approved by Admin ${user.name}`,
        timestamp: new Date().toISOString(),
        user: user.name
      });
      recalculateAllPoints();
      await saveData();
      saveSingleMysqlTask(task).catch(err => console.error("[MYSQL SYNC ERROR] Admin approval sync:", err?.message || err));
      return res.json(task);
    }

    return res.status(403).json({ error: "Access Denied: You do not have permission to approve this task." });
  });

  app.post("/api/tasks/:id/reject", authenticate, async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { id } = req.params;
    const { remarks } = req.body;

    if (!remarks) return res.status(400).json({ error: "Reject remarks are required" });

    const taskIndex = tasks.findIndex(t => t.id === id || t.taskId === id);
    if (taskIndex === -1) return res.status(404).json({ error: "Task not found" });
    const task = tasks[taskIndex];

    const isExecutive = user.role === 'SUPER_ADMIN' || user.role === 'HOD' || user.role === 'DHOD' || user.role === 'CBO' || user.role === 'DCBO';

    // Verify authorized Officer or Engineer
    let isAuthorized = isExecutive;
    let matchingApproval: any = null;

    if (user.role === 'OFFICER') {
      // Requesting Officer cannot reject on behalf of other teams
      if (task.createdBy === user.employeeId || task.createdBy === user.id) {
        return res.status(403).json({ error: "Access Denied: The requesting Officer cannot reject requests on behalf of other teams." });
      }

      if (task.teamApprovals && Array.isArray(task.teamApprovals)) {
        matchingApproval = task.teamApprovals.find((a: any) => 
          (a.officerId === user.employeeId || a.officerId === user.id || (a.officerName && a.officerName.toLowerCase() === user.name.toLowerCase()))
        );
        if (matchingApproval) isAuthorized = true;
      }

      if (!isAuthorized) {
        const targetTech = users.find(u => u.employeeId === task.assignedTo || u.id === task.assignedTo || (u.name && u.name.toLowerCase() === (task.assignedTo || '').toLowerCase()));
        if (targetTech && (targetTech.supervisorId === user.id || targetTech.supervisorId === user.employeeId || (targetTech.supervisor_ids || []).includes(user.employeeId))) {
          isAuthorized = true;
        }
      }
    } else if (user.role === 'ENGINEER') {
      const creator = users.find(u => u.employeeId === task.createdBy);
      if (creator && ((creator.assignedEngineers || []).includes(user.employeeId) || creator.supervisorId === user.id || task.concernEngineerId === user.employeeId)) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return res.status(403).json({ error: "Access Denied: Only the authorized concern Officer responsible for this technician's team can reject this request." });
    }

    if (matchingApproval) {
      matchingApproval.status = 'REJECTED';
      matchingApproval.remarks = remarks;
      matchingApproval.approvedBy = user.employeeId;
      matchingApproval.approvedAt = new Date().toISOString();
    }

    task.status = "REJECTED";
    task.requestStatus = "REJECTED";
    task.requestRemarks = remarks;
    task.logs.push({
      id: Date.now().toString(),
      action: `Request Rejected by ${user.name}: ${remarks}`,
      timestamp: new Date().toISOString(),
      user: user.name
    });

    // Notify requester
    const requester = users.find(u => u.employeeId === task.createdBy || u.employeeId === task.assignedBy);
    if (requester) {
      notifications.push({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        userId: requester.id,
        message: `Your request for task "${task.title}" has been REJECTED by ${user.name}. Reason: ${remarks}`,
        read: false,
        timestamp: new Date().toISOString()
      });
    }

    recalculateAllPoints();
    await saveData();
    saveSingleMysqlTask(task).catch(err => console.error("[MYSQL SYNC ERROR] Reject sync:", err?.message || err));
    res.json(task);
  });

  app.post("/api/user/theme", authenticate, upload.single('background') as any, async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { theme, customBackground, removeBg } = req.body;
    const userIndex = users.findIndex(u => u.id === user.id);
    if (userIndex === -1) return res.status(404).json({ error: "User not found" });

    if (theme) users[userIndex].theme = theme;
    
    if (req.file) {
      // If a file was uploaded, use its path
      users[userIndex].customBackground = `/uploads/${req.file.filename}`;
    } else if (customBackground) {
      users[userIndex].customBackground = customBackground;
    }

    if (removeBg) users[userIndex].customBackground = undefined;

    await saveData();
    res.json(users[userIndex]);
  });

  app.get("/api/attendance", authenticate, async (req: Request, res: Response) => {
    const todayIso = new Date().toISOString().split('T')[0];
    const todayLocal = new Date().toLocaleDateString('en-CA');
    const trackableStaff = users.filter(u => u.role !== 'SUPER_ADMIN');
    
    let updated = false;
    trackableStaff.forEach(staff => {
      const empId = String(staff.employeeId || '').trim();
      if (!empId) return;
      const existingRecord = attendanceRecords.find(r => 
        (String(r.technicianId || '').trim() === empId || String((r as any).employeeId || '').trim() === empId) && 
        (r.date === todayIso || r.date === todayLocal)
      );
      if (!existingRecord) {
        const newRecord = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
          technicianId: empId,
          status: 'PRESENT' as const,
          date: todayIso
        };
        attendanceRecords.push(newRecord);
        updated = true;
      }
    });
    
    if (updated) {
      await saveData();
    }
    
    // Return all attendance records so frontend has both today's status and historical counts
    res.json(attendanceRecords);
  });

  app.post("/api/attendance", authenticate, async (req: Request, res: Response) => {
    const { technicianId, employeeId, status, date, checkInTime, checkOutTime, shiftCode, notes } = req.body;
    const targetEmpId = String(technicianId || employeeId || '').trim();
    if (!targetEmpId) {
      return res.status(400).json({ error: "technicianId or employeeId is required" });
    }

    const bdNow = getBangladeshDateTime();
    const todayIso = bdNow.dateStr;
    const todayLocal = new Date().toLocaleDateString('en-CA');
    const targetDate = date || todayIso;

    // Normalize status
    let normalizedStatus = status as Attendance['status'];
    if (status === 'SHIFT_6_2') normalizedStatus = 'SHIFT_A';
    if (status === 'SHIFT_2_6') normalizedStatus = 'SHIFT_B';

    // Find existing record matching target date or today
    const existingIdx = attendanceRecords.findIndex(r => 
      (String(r.technicianId || '').trim() === targetEmpId || String((r as any).employeeId || '').trim() === targetEmpId) && 
      (r.date === targetDate || r.date === todayIso || r.date === todayLocal)
    );

    const effectiveCheckIn = checkInTime || (normalizedStatus === 'PRESENT' ? bdNow.timeStr : undefined);
    const effectiveCheckOut = checkOutTime || (normalizedStatus === 'CHECKED_OUT' ? bdNow.timeStr : undefined);

    let updatedRecord: Attendance;
    if (existingIdx !== -1) {
      attendanceRecords[existingIdx].status = normalizedStatus;
      attendanceRecords[existingIdx].date = targetDate;
      if (effectiveCheckIn) attendanceRecords[existingIdx].checkInTime = effectiveCheckIn;
      if (effectiveCheckOut) attendanceRecords[existingIdx].checkOutTime = effectiveCheckOut;
      if (shiftCode) attendanceRecords[existingIdx].shiftCode = shiftCode;
      if (notes !== undefined) attendanceRecords[existingIdx].notes = notes;
      updatedRecord = attendanceRecords[existingIdx];
    } else {
      updatedRecord = { 
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5), 
        technicianId: targetEmpId, 
        status: normalizedStatus, 
        date: targetDate,
        checkInTime: effectiveCheckIn,
        checkOutTime: effectiveCheckOut,
        shiftCode,
        notes
      };
      attendanceRecords.unshift(updatedRecord);
    }

    // Clean up any extra duplicates for targetDate / today
    for (let i = attendanceRecords.length - 1; i >= 0; i--) {
      const rec = attendanceRecords[i];
      if (rec !== updatedRecord && 
          (String(rec.technicianId || '').trim() === targetEmpId || String((rec as any).employeeId || '').trim() === targetEmpId) && 
          (rec.date === targetDate || rec.date === todayIso || rec.date === todayLocal)) {
        attendanceRecords.splice(i, 1);
      }
    }

    // Update Staff Status & Trigger Attendance-Based Timer Audit Events
    const staffMember = users.find(u => String(u.employeeId || '').trim() === targetEmpId || u.id === targetEmpId);
    const activeTasks = tasks.filter(t => 
      (t.status === 'RUNNING' || (t.status === 'PENDING' && t.requestStatus === 'RECOMMENDED')) && 
      (String(t.assignedTo || '').trim() === targetEmpId ||
       t.assignedTo === staffMember?.name ||
       t.assignedTo === staffMember?.id ||
       (t.assignedTechnicians && t.assignedTechnicians.some((at: any) => String(at.employeeId || '').trim() === targetEmpId)))
    );

    if (staffMember) {
      const hasRunningTasks = activeTasks.length > 0;
      if (normalizedStatus === 'PRESENT') {
        staffMember.status = hasRunningTasks ? 'WORKING' : 'FREE';
      } else if (normalizedStatus === 'LEAVE' || normalizedStatus === 'ABSENT') {
        staffMember.status = 'ON_LEAVE';
      } else if (normalizedStatus === 'SHORT_LEAVE') {
        staffMember.status = 'SHORT_LEAVE';
      } else if (normalizedStatus === 'CHECKED_OUT') {
        staffMember.status = 'SHIFT_OFF';
      } else {
        rebuildTechnicianStatuses();
      }
    }

    for (const activeTask of activeTasks) {
      const isPausing = ['ABSENT', 'LEAVE', 'CHECKED_OUT'].includes(normalizedStatus);
      addTaskTimerAuditLog({
        taskId: activeTask.id,
        technicianId: targetEmpId,
        event: isPausing ? 'AUTO_PAUSED_CHECKOUT' : 'AUTO_RESUMED_CHECKIN',
        details: isPausing
          ? `Attendance updated to ${normalizedStatus} (${bdNow.dateStr} ${bdNow.timeStr} BST) — working timer paused.`
          : `Technician checked in (${normalizedStatus} at ${effectiveCheckIn || bdNow.timeStr} BST) — working timer resumed.`,
        actor: (req as any).user?.name || 'System',
        actorId: (req as any).user?.employeeId
      });
    }

    await saveData();
    broadcastRealtimeUpdate({ type: 'ATTENDANCE_UPDATED', data: { technicianId: targetEmpId, status: normalizedStatus, date: targetDate } });
    res.json({ success: true, record: updatedRecord, technicianId: targetEmpId, status: normalizedStatus, date: targetDate, staffStatus: staffMember?.status });
  });

  app.put("/api/tasks/:id", authenticate, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
    const { id } = req.params;
    const index = tasks.findIndex(t => t.id === id);
    
    if (index === -1) {
      return res.status(404).json({ error: "Task not found" });
    }

    const oldTask = tasks[index];
    const isSuperAdmin = user.role === 'SUPER_ADMIN' || user.employeeId === 'jhfboss';
    const isExecutive = ['SUPER_ADMIN', 'CBO', 'DCBO', 'HOD', 'DHOD'].includes(user.role) || isSuperAdmin;

    // Completed task locking:
    // Once COMPLETED, ordinary Officers and non-executives cannot edit the task.
    if ((oldTask.status || '').toUpperCase() === 'COMPLETED' && !isExecutive) {
      return res.status(403).json({ error: "Access Denied: Completed tasks are locked and cannot be edited." });
    }

    // Role-based authorization
    if (user.role === 'OFFICER') {
      const empIdStr = String(user.employeeId || '').trim();
      const userIdStr = String(user.id || '').trim();
      const nameStr = String(user.name || '').trim().toLowerCase();

      // Check operational scope:
      const myTechnicians = users.filter(u => u.role === 'TECHNICIAN' && isTechnicianSupervisedByOfficer(u, user));
      const myTechEmpIds = new Set(myTechnicians.map(t => String(t.employeeId || '').trim()));
      const myTechNames = new Set(myTechnicians.map(t => String(t.name || '').trim().toLowerCase()));
      const myTechIds = new Set(myTechnicians.map(t => String(t.id || '').trim()));

      const createdByStr = String(oldTask.createdBy || '').trim();
      const assignedToStr = String(oldTask.assignedTo || '').trim();
      const respOffStr = String(oldTask.responsibleOfficerId || '').trim();
      const assignedByStr = String(oldTask.assignedBy || '').trim();

      const isCreator = createdByStr === empIdStr || createdByStr === userIdStr || (createdByStr.length > 0 && createdByStr.toLowerCase() === nameStr);
      const isAssignedToOfficer = assignedToStr === empIdStr || assignedToStr === userIdStr || (assignedToStr.length > 0 && assignedToStr.toLowerCase() === nameStr);
      const isResponsibleOfficer = respOffStr === empIdStr || respOffStr === userIdStr || (respOffStr.length > 0 && respOffStr.toLowerCase() === nameStr);
      const isAssigner = assignedByStr === empIdStr || assignedByStr === userIdStr || (assignedByStr.length > 0 && assignedByStr.toLowerCase() === nameStr);
      
      const hasMyTechAssigned = myTechEmpIds.has(assignedToStr) || myTechNames.has(assignedToStr.toLowerCase()) || myTechIds.has(assignedToStr) ||
        (oldTask.workType === 'TEAM' && Array.isArray(oldTask.assignedTechnicians) && oldTask.assignedTechnicians.some((at: any) => 
          myTechEmpIds.has(String(at.employeeId || '').trim()) || 
          myTechNames.has(String(at.name || '').trim().toLowerCase()) ||
          myTechIds.has(String(at.id || '').trim())
        ));
      const hasTeamApproval = Array.isArray(oldTask.teamApprovals) && oldTask.teamApprovals.some((a: any) => 
        String(a.officerId || '').trim() === empIdStr || 
        String(a.officerId || '').trim() === userIdStr || 
        (a.officerName && String(a.officerName).trim().toLowerCase() === nameStr)
      );

      const isInScope = isCreator || isAssignedToOfficer || isResponsibleOfficer || isAssigner || hasMyTechAssigned || hasTeamApproval;

      if (!isInScope && !isExecutive) {
        return res.status(403).json({ error: "Access Denied: You do not have permission to update or assign this task." });
      }

      // Check if trying to edit core definition fields on tasks NOT created by this Officer:
      const definitionFields = ['title', 'model', 'details', 'urgency', 'deadline', 'points'];
      const isModifyingDefinition = definitionFields.some(field => {
        if (req.body[field] === undefined) return false;
        return String(req.body[field] || '').trim() !== String((oldTask as any)[field] || '').trim();
      });

      if (isModifyingDefinition && !isCreator && !isExecutive) {
        return res.status(403).json({ error: "Access Denied: Officers can only edit task details (title, model, details, deadline, urgency, points) for tasks they entered/created." });
      }

      // Officers can only assign tasks to Technicians
      const assignedToName = req.body.assignedTo;
      const isTeam = req.body.workType === 'TEAM' || oldTask.workType === 'TEAM';
      
      if (assignedToName && assignedToName !== oldTask.assignedTo && !isTeam && assignedToName !== 'Team Work') {
        const targetUser = users.find(u => 
          u.id === assignedToName || 
          u.name === assignedToName || 
          u.employeeId === assignedToName
        );
        if (!targetUser || targetUser.role !== 'TECHNICIAN') {
          return res.status(403).json({ error: "Access Denied: Officers can only assign tasks to Technicians." });
        }
      }

      // If it's a team task, validate assignedTechnicians if provided
      if (req.body.assignedTechnicians && Array.isArray(req.body.assignedTechnicians)) {
        for (const at of req.body.assignedTechnicians) {
          const tech = users.find(u => u.employeeId === at.employeeId || u.id === at.id || u.name === at.name);
          if (!tech || tech.role !== 'TECHNICIAN') {
            return res.status(403).json({ error: `Access Denied: ${at.name || 'Technician'} is not a valid technician.` });
          }
        }
      }
    } else if (user.role === 'TECHNICIAN') {
      // Technicians can only update tasks assigned to them
      if (oldTask.assignedTo !== user.id && oldTask.assignedTo !== user.name && oldTask.assignedTo !== user.employeeId) {
        return res.status(403).json({ error: "Access Denied: You can only update tasks assigned to you." });
      }
      // Technicians can only update specific fields
      const allowedFields = [
        'status', 'progress', 'remarks', 'logs', 'startedAt', 'completedAt',
        'actualCompletionTime', 'currentHoldStartTime', 'totalHoldMs', 'totalHoldMinutes', 'holdHistory'
      ];
      const updates = req.body;
      const requestedFields = Object.keys(updates);
      const isAllowed = requestedFields.every(field => allowedFields.includes(field));
      
      if (!isAllowed) {
        return res.status(403).json({ error: "Access Denied: Technicians can only update status, progress, remarks, logs, startedAt, and completedAt." });
      }
    } else if (user.role === 'ENGINEER') {
      // Strict Assignment Rule for Engineers on Update
      const assignedToName = req.body.assignedTo;
      if (assignedToName && assignedToName !== oldTask.assignedTo) {
        const targetUser = users.find(u => u.id === assignedToName || u.name === assignedToName || u.employeeId === assignedToName);
        if (!targetUser || targetUser.role !== 'OFFICER') {
          return res.status(403).json({ error: "Access Denied: Engineers can only assign tasks to Officers." });
        }
        // Ensure the Engineer is authorized for this Officer
        if (!(targetUser.assignedEngineers || []).includes(user.employeeId)) {
          return res.status(403).json({ error: "Access Denied: You are not authorized to assign tasks to this Officer." });
        }
        req.body.concernEngineerId = user.employeeId;
        req.body.assignedBy = user.employeeId;
        req.body.responsibleOfficerId = targetUser.employeeId;
      }
      
      // Engineers shouldn't be able to update points or quality unless they created the task
      if (req.body.points !== undefined || req.body.quality !== undefined) {
        if (oldTask.createdBy !== user.employeeId && user.role !== 'SUPER_ADMIN' && user.role !== 'CBO' && user.role !== 'DCBO' && user.role !== 'HOD' && user.role !== 'DHOD') {
          return res.status(403).json({ error: "Access Denied: Only the creator or executive admin can update points and quality." });
        }
      }
    }

    const updatedData = { ...req.body };

    // Mandatory remarks for every update (except when assigning a task or editing task details)
    if (!updatedData.remarks && user.role !== 'SUPER_ADMIN' && !updatedData.assignedTo && !updatedData.title && !updatedData.assignedTechnicians) {
      return res.status(400).json({ error: "Remarks are mandatory for every update" });
    }
      
    // Handle Team Work Assignment
    if (updatedData.workType === 'TEAM' && updatedData.assignedTechnicians) {
      // Check if any technician is not in my team
      const hasOtherTeamTech = updatedData.assignedTechnicians.some((at: any) => {
        const tech = users.find(u => u.employeeId === at.employeeId || u.id === at.id || u.name === at.name);
        return tech && !isTechnicianSupervisedByOfficer(tech, user);
      });

      if (hasOtherTeamTech && user.role === 'OFFICER') {
        updatedData.status = 'REQUESTED';
        updatedData.requestStatus = 'PENDING';
      } else {
        updatedData.status = 'RUNNING';
        updatedData.startedAt = new Date().toISOString();
      }

      updatedData.assignedBy = user.employeeId;
      updatedData.assignedTechnicians = updatedData.assignedTechnicians.map((t: any) => ({
        ...t,
        progress: t.progress || 0,
        status: t.status || (updatedData.status === 'REQUESTED' ? 'PENDING' : 'RUNNING'),
        startedAt: t.startedAt || (updatedData.status === 'REQUESTED' ? undefined : new Date().toISOString())
      }));
      
      if (!updatedData.logs) updatedData.logs = [...(oldTask.logs || [])];
      updatedData.logs.push({
        id: Date.now().toString(),
        action: updatedData.status === 'REQUESTED' ? `Team task requested (${updatedData.assignedTechnicians.length} technicians)` : `Task assigned to Team (${updatedData.assignedTechnicians.length} technicians) - Started`,
        timestamp: new Date().toISOString(),
        user: user.name
      });

      // Notify supervisors if requested
      if (updatedData.status === 'REQUESTED') {
        const supervisorsToNotify = new Set();
        updatedData.assignedTechnicians.forEach((at: any) => {
          const tech = users.find(u => u.employeeId === at.employeeId || u.id === at.id || u.name === at.name);
          if (tech && tech.supervisorId && !isTechnicianSupervisedByOfficer(tech, user)) {
            supervisorsToNotify.add(tech.supervisorId);
          }
        });
        supervisorsToNotify.forEach(supId => {
          notifications.push({
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            userId: supId,
            message: `Officer ${user.name} requested your technician for a team task: ${oldTask.title}`,
            read: false,
            timestamp: new Date().toISOString()
          });
        });
      }
    }

    // Auto-start system: If assigned to a technician, status becomes RUNNING
    if (updatedData.assignedTo && updatedData.assignedTo !== oldTask.assignedTo && updatedData.workType !== 'TEAM' && updatedData.assignedTo !== 'Team Work') {
      const assignedUser = users.find(u => u.id === updatedData.assignedTo || u.employeeId === updatedData.assignedTo || u.name === updatedData.assignedTo);
      if (assignedUser && assignedUser.role === 'TECHNICIAN') {
        // Check for cross-team
        if (user.role === 'OFFICER' && !isTechnicianSupervisedByOfficer(assignedUser, user)) {
          updatedData.status = 'REQUESTED';
          updatedData.requestStatus = 'PENDING';
        } else {
          updatedData.status = 'RUNNING';
          updatedData.startedAt = new Date().toISOString();
        }
        updatedData.assignedBy = user.employeeId; 
        if (!updatedData.logs) updatedData.logs = [...(oldTask.logs || [])];
        updatedData.logs.push({
          id: Date.now().toString(),
          action: updatedData.status === 'REQUESTED' ? `Task requested for ${assignedUser.name}` : `Task assigned to ${assignedUser.name} - Started`,
          timestamp: new Date().toISOString(),
          user: user.name
        });

        // Notify supervisor if requested
        if (updatedData.status === 'REQUESTED' && assignedUser.supervisorId) {
          notifications.push({
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            userId: assignedUser.supervisorId,
            message: `Officer ${user.name} requested your technician ${assignedUser.name} for task: ${oldTask.title}`,
            read: false,
            timestamp: new Date().toISOString()
          });
        }
      }
    }

    // Handle Approval/Rejection
    // Handle Approval/Rejection (Strict Authorization)
    if (updatedData.requestStatus === 'APPROVED' && oldTask.requestStatus === 'PENDING') {
      // Only Supervisor can approve PENDING requests
      const targetTechnician = users.find(u => u.employeeId === oldTask.assignedTo || u.name === oldTask.assignedTo || u.id === oldTask.assignedTo);
      const isTeamMemberSupervisor = oldTask.workType === 'TEAM' && oldTask.assignedTechnicians?.some((at: any) => {
        const tech = users.find(u => u.employeeId === at.employeeId);
        return tech && tech.supervisorId === user.id;
      });

      if ((!targetTechnician || targetTechnician.supervisorId !== user.id) && !isTeamMemberSupervisor) {
        return res.status(403).json({ error: "Only the technician's supervisor can approve this request" });
      }

      const creator = users.find(u => u.employeeId === oldTask.createdBy);
      if (creator && creator.role === 'OFFICER') {
        updatedData.requestStatus = 'RECOMMENDED';
        updatedData.status = 'PENDING';
        
        if (!updatedData.logs) updatedData.logs = [...(oldTask.logs || [])];
        updatedData.logs.push({
          id: Date.now().toString(),
          action: `Request Approved by Supervisor ${user.name} (Sent for Engineer Recommendation)`,
          timestamp: new Date().toISOString(),
          user: user.name
        });

        // Notify Engineer
        const assignedEngineers = creator.assignedEngineers || [];
        assignedEngineers.forEach(engId => {
          const eng = users.find(u => u.employeeId === engId || u.id === engId);
          if (eng) {
            notifications.push({
              id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
              userId: eng.id,
              message: `New task recommendation request from Officer ${creator.name} (Approved by Supervisor)`,
              read: false,
              timestamp: new Date().toISOString()
            });
          }
        });
      } else {
        updatedData.status = 'RUNNING';
        updatedData.requestStatus = 'APPROVED';
        updatedData.startedAt = oldTask.customStartTime || oldTask.startedAt || new Date().toISOString();
        
        if (oldTask.workType === 'TEAM' && oldTask.assignedTechnicians) {
          updatedData.assignedTechnicians = oldTask.assignedTechnicians.map(at => ({
            ...at,
            status: 'RUNNING',
            startedAt: new Date().toISOString()
          }));
        }
        
        if (!updatedData.logs) updatedData.logs = [...(oldTask.logs || [])];
        updatedData.logs.push({
          id: Date.now().toString(),
          action: `Request Approved by Supervisor ${user.name}`,
          timestamp: new Date().toISOString(),
          user: user.name
        });

        // Update Technician Status to WORKING
        if (oldTask.workType === 'TEAM' && oldTask.assignedTechnicians) {
          oldTask.assignedTechnicians.forEach((at: any) => {
            const tech = users.find(u => u.employeeId === at.employeeId);
            if (tech) tech.status = 'WORKING';
          });
        } else if (oldTask.assignedTo) {
          const tech = users.find(u => u.name === oldTask.assignedTo || u.employeeId === oldTask.assignedTo || u.id === oldTask.assignedTo);
          if (tech && tech.role === 'TECHNICIAN') tech.status = 'WORKING';
        }
      }
    } else if (updatedData.requestStatus === 'REJECTED' && oldTask.requestStatus === 'PENDING') {
      // Only Supervisor can reject PENDING requests
      const targetTechnician = users.find(u => u.employeeId === oldTask.assignedTo || u.name === oldTask.assignedTo || u.id === oldTask.assignedTo);
      const isTeamMemberSupervisor = oldTask.workType === 'TEAM' && oldTask.assignedTechnicians?.some((at: any) => {
        const tech = users.find(u => u.employeeId === at.employeeId);
        return tech && tech.supervisorId === user.id;
      });

      if ((!targetTechnician || targetTechnician.supervisorId !== user.id) && !isTeamMemberSupervisor) {
        return res.status(403).json({ error: "Only the technician's supervisor can reject this request" });
      }

      updatedData.status = 'REJECTED';
      
      if (!updatedData.logs) updatedData.logs = [...(oldTask.logs || [])];
      updatedData.logs.push({
        id: Date.now().toString(),
        action: `Request Rejected by Supervisor ${user.name}: ${updatedData.requestRemarks || 'No reason provided'}`,
        timestamp: new Date().toISOString(),
        user: user.name
      });
    } else if (updatedData.requestStatus === 'APPROVED' && oldTask.requestStatus === 'RECOMMENDED') {
      // Only Engineer can approve RECOMMENDED requests
      const creator = users.find(u => u.employeeId === oldTask.createdBy);
      const isMyOfficer = creator && creator.role === 'OFFICER' && (creator.assignedEngineers || []).includes(user.employeeId);
      
      if (user.role !== 'ENGINEER' || !isMyOfficer) {
        return res.status(403).json({ error: "Only the assigned Engineer can approve this recommendation" });
      }

      updatedData.status = 'RUNNING';
      updatedData.requestStatus = 'APPROVED';
      updatedData.startedAt = oldTask.customStartTime || oldTask.startedAt || new Date().toISOString();
      updatedData.approvedBy = user.employeeId;
      updatedData.concernEngineerId = user.employeeId;

      if (!updatedData.logs) updatedData.logs = [...(oldTask.logs || [])];
      updatedData.logs.push({
        id: Date.now().toString(),
        action: `Task Recommended & Approved by Engineer ${user.name}`,
        timestamp: new Date().toISOString(),
        user: user.name
      });

      // Update Technician Status to WORKING
      if (oldTask.workType === 'TEAM' && oldTask.assignedTechnicians) {
        oldTask.assignedTechnicians.forEach((at: any) => {
          const tech = users.find(u => u.employeeId === at.employeeId);
          if (tech) tech.status = 'WORKING';
        });
      } else if (oldTask.assignedTo) {
        const tech = users.find(u => u.name === oldTask.assignedTo || u.employeeId === oldTask.assignedTo || u.id === oldTask.assignedTo);
        if (tech && tech.role === 'TECHNICIAN') tech.status = 'WORKING';
      }
    }

    // Handle Team Progress Updates
    if (oldTask.workType === 'TEAM' && updatedData.assignedTechnicians) {
      const totalProgress = updatedData.assignedTechnicians.reduce((sum: number, t: any) => sum + (t.progress || 0), 0);
      updatedData.totalTeamProgress = Math.round(totalProgress / updatedData.assignedTechnicians.length);
      updatedData.progress = updatedData.totalTeamProgress;
      
      if (updatedData.assignedTechnicians.every((t: any) => t.status === 'COMPLETED')) {
        updatedData.status = 'COMPLETED';
        updatedData.completedAt = new Date().toISOString();
        
        // Update Technician Status to FREE if no other running tasks
        updatedData.assignedTechnicians.forEach((at: any) => {
          const techId = at.employeeId;
          const hasOtherRunningTasks = tasks.some(t => 
            t.id !== oldTask.id && 
            t.status === 'RUNNING' && 
            (t.assignedTo === techId || (t.assignedTechnicians && t.assignedTechnicians.some((at2: any) => at2.employeeId === techId)))
          );
          if (!hasOtherRunningTasks) {
            const tech = users.find(u => u.employeeId === techId);
            if (tech) tech.status = 'FREE';
          }
        });
      }
    }

    if (updatedData.assignedTo) {
      const matchedUser = users.find(u => u.id === updatedData.assignedTo);
      if (matchedUser && matchedUser.name) {
        updatedData.assignedTo = matchedUser.name;
      }
    }

    if (updatedData.customStartTime) {
      const parsedStart = parseTaskDate(updatedData.customStartTime);
      if (!isNaN(parsedStart.getTime())) {
        updatedData.customStartTime = parsedStart.toISOString();
      }
    }

    // Handle Completion Logic
    if (updatedData.status === 'COMPLETED' && oldTask.status !== 'COMPLETED') {
      updatedData.progress = 100;
      const rawCompletedAt = updatedData.actualCompletionTime || new Date().toISOString();
      const parsedCompleted = parseTaskDate(rawCompletedAt);
      const completedAt = !isNaN(parsedCompleted.getTime()) ? parsedCompleted.toISOString() : rawCompletedAt;
      updatedData.completedAt = completedAt;
      if (updatedData.actualCompletionTime) {
        updatedData.actualCompletionTime = completedAt;
      }

      // Update Technician Status to FREE if no other running tasks
      if (oldTask.workType !== 'TEAM' && oldTask.assignedTo) {
        const tech = users.find(u => u.id === oldTask.assignedTo || u.name === oldTask.assignedTo || u.employeeId === oldTask.assignedTo);
        if (tech && tech.role === 'TECHNICIAN') {
          const techId = tech.employeeId;
          const hasOtherRunningTasks = tasks.some(t => 
            t.id !== oldTask.id && 
            t.status === 'RUNNING' && 
            (t.assignedTo === techId || (t.assignedTechnicians && t.assignedTechnicians.some((at: any) => at.employeeId === techId)))
          );
          if (!hasOtherRunningTasks) {
            tech.status = 'FREE';
          }
        }
      }

      // Point transactions and user totals are authoritatively maintained by recalculateAllPoints() below.
      
      // Calculate Task Taken Time, Remaining Time, and Over Time
      const timing = computeTaskTiming({ ...oldTask, ...updatedData, completedAt });
      updatedData.taskTakenTime = timing.taskTakenTime;
      updatedData.remainingTime = timing.remainingTime;
      updatedData.overTime = timing.overTime;
      const estimatedMinutes = timing.estimatedMinutes;
      const actualMinutes = timing.actualMinutes;
      const end = timing.end;

      // 2. Technician Performance & Status Update
      const techniciansToUpdate = [];
      if (oldTask.workType === 'TEAM' && oldTask.assignedTechnicians) {
        techniciansToUpdate.push(...oldTask.assignedTechnicians.map(at => at.employeeId));
      } else if (oldTask.assignedTo) {
        const tech = users.find(u => u.id === oldTask.assignedTo || u.employeeId === oldTask.assignedTo || u.name === oldTask.assignedTo);
        if (tech && tech.role === 'TECHNICIAN') {
          techniciansToUpdate.push(tech.employeeId);
        }
      }

      for (const techId of techniciansToUpdate) {
        const deadline = parseTaskDate(oldTask.deadline);
        const remainingMs = deadline.getTime() - end.getTime();
        const remainingMinutes = Math.floor(remainingMs / (1000 * 60));
        
        const efficiency = actualMinutes > 0 ? (estimatedMinutes / actualMinutes) * 100 : 100;
        
        let completionSpeedScore = 10;
        if (efficiency > 120) completionSpeedScore = 15;
        else if (efficiency < 80) completionSpeedScore = 5;

        technicianPerformance.push({
          id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
          technicianId: techId,
          taskId: oldTask.id,
          date: completedAt.split('T')[0],
          totalWorkMinutes: actualMinutes,
          estimatedMinutes: estimatedMinutes,
          remainingMinutes,
          completionSpeedScore,
          attendanceScore: 10,
          efficiencyScore: Math.min(Math.round(efficiency / 2), 50), // Max 50 points for efficiency
          finalDailyScore: Math.min(Math.round(efficiency / 2) + 10 + completionSpeedScore, 100)
        });

        // Update technician status to FREE if no other running tasks
        const runningTasks = tasks.filter(t => 
          t.id !== oldTask.id && 
          t.status === 'RUNNING' && 
          (t.assignedTo === techId || (t.assignedTechnicians && t.assignedTechnicians.some(at => at.employeeId === techId)))
        );
        if (runningTasks.length === 0) {
          const techUser = users.find(u => u.employeeId === techId);
          if (techUser) techUser.status = 'FREE';
        }
      }
    } else if ((updatedData.status === 'COMPLETED' || oldTask.status === 'COMPLETED') && (updatedData.customStartTime || updatedData.actualCompletionTime || updatedData.estimatedDuration)) {
      if (updatedData.actualCompletionTime) {
        const parsedComp = parseTaskDate(updatedData.actualCompletionTime);
        if (!isNaN(parsedComp.getTime())) {
          updatedData.actualCompletionTime = parsedComp.toISOString();
          updatedData.completedAt = parsedComp.toISOString();
        }
      }
      const timing = computeTaskTiming({ ...oldTask, ...updatedData });
      updatedData.taskTakenTime = timing.taskTakenTime;
      updatedData.remainingTime = timing.remainingTime;
      updatedData.overTime = timing.overTime;
    }

      // Handle HOLD status transitions and accurate hold time tracking
      if (updatedData.status === 'HOLD') {
        if (!updatedData.remarks && !oldTask.remarks) {
          return res.status(400).json({ error: "Remarks are required for Temporary Hold" });
        }
        if (oldTask.status !== 'HOLD') {
          // Transition into HOLD: record hold start timestamp and freeze work timer
          const nowIso = updatedData.currentHoldStartTime || new Date().toISOString();
          updatedData.currentHoldStartTime = nowIso;
          const currentHistory = Array.isArray(oldTask.holdHistory) ? [...oldTask.holdHistory] : [];
          currentHistory.push({
            holdStart: nowIso,
            reason: updatedData.remarks || oldTask.remarks || 'Temporary Hold'
          });
          updatedData.holdHistory = currentHistory;
        } else if (!oldTask.currentHoldStartTime && !updatedData.currentHoldStartTime) {
          // Self-heal: task was already HOLD but missed currentHoldStartTime
          const nowIso = new Date().toISOString();
          updatedData.currentHoldStartTime = nowIso;
        }
      }

      // If status changes FROM HOLD to RUNNING, COMPLETED, or any other status
      if (oldTask.status === 'HOLD' && updatedData.status && updatedData.status !== 'HOLD') {
        const nowMs = Date.now();
        let holdDurationMs = 0;
        let holdStartMs = 0;

        if (oldTask.currentHoldStartTime) {
          const hStart = new Date(oldTask.currentHoldStartTime).getTime();
          if (!isNaN(hStart)) holdStartMs = hStart;
        }
        if (!holdStartMs && Array.isArray(oldTask.holdHistory) && oldTask.holdHistory.length > 0) {
          const lastH = oldTask.holdHistory[oldTask.holdHistory.length - 1];
          if (lastH?.holdStart) {
            const hStart = new Date(lastH.holdStart).getTime();
            if (!isNaN(hStart)) holdStartMs = hStart;
          }
        }
        if (!holdStartMs && Array.isArray(oldTask.logs)) {
          const holdLog = [...oldTask.logs].reverse().find((l: any) =>
            l.action && String(l.action).toLowerCase().includes('hold')
          );
          if (holdLog?.timestamp) {
            const hStart = new Date(holdLog.timestamp).getTime();
            if (!isNaN(hStart)) holdStartMs = hStart;
          }
        }

        if (holdStartMs) {
          holdDurationMs = Math.max(0, nowMs - holdStartMs);
        }

        const prevHoldMs = Number(oldTask.totalHoldMs) || ((Number(oldTask.totalHoldMinutes) || 0) * 60 * 1000);
        const newTotalHoldMs = prevHoldMs + holdDurationMs;
        updatedData.totalHoldMs = newTotalHoldMs;
        updatedData.totalHoldMinutes = Math.floor(newTotalHoldMs / (1000 * 60));
        updatedData.currentHoldStartTime = null;

        // Close out last history item with holdEnd
        if (Array.isArray(oldTask.holdHistory) && oldTask.holdHistory.length > 0) {
          const updatedHistory = [...oldTask.holdHistory];
          const lastIdx = updatedHistory.length - 1;
          if (!updatedHistory[lastIdx].holdEnd) {
            updatedHistory[lastIdx] = {
              ...updatedHistory[lastIdx],
              holdEnd: new Date(nowMs).toISOString()
            };
          }
          updatedData.holdHistory = updatedHistory;
        }

        // Preserve original task startedAt (do NOT overwrite with current time)
        if (!updatedData.startedAt && oldTask.startedAt) {
          updatedData.startedAt = oldTask.startedAt;
        }
      }

      // Recompute timing accounting for hold periods
      const timingWithHold = computeTaskTiming({ ...oldTask, ...updatedData });
      updatedData.taskTakenTime = timingWithHold.taskTakenTime;
      updatedData.remainingTime = timingWithHold.remainingTime;
      updatedData.overTime = timingWithHold.overTime;

      // Ensure logs are appended if not already handled by the logic above or the request body
      if (!updatedData.logs) {
        updatedData.logs = [
          ...(oldTask.logs || []),
          {
            id: Date.now().toString(),
            action: `Task updated by ${user.name}`,
            timestamp: new Date().toISOString(),
            user: user.name
          }
        ];
      }

      tasks[index] = { ...oldTask, ...updatedData };
      recalculateAllPoints();
      rebuildTechnicianStatuses(); // Ensure statuses are consistent after update
      await saveData();
      saveSingleMysqlTask(tasks[index]).catch(err => console.error("[MYSQL SYNC ERROR] Task update sync:", err?.message || err));
      broadcastRealtimeUpdate({ type: 'TASK_UPDATED', taskId: tasks[index].id, status: tasks[index].status });
      res.json(decorateTaskWithTiming(tasks[index]));
    } catch (error) {
      console.error("Error updating task:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  // --- Task File Attachments & Comments (Local Disk + MySQL Storage) ---
  app.get("/api/tasks/:id/attachments", authenticate, (req: Request, res: Response) => {
    const id = decodeURIComponent(String(req.params.id || '')).trim();
    const task = tasks.find(t => String(t.id).trim() === id || String(t.taskId).trim() === id);
    if (!task) return res.status(404).json({ error: "Task not found" });
    res.json(task.attachments || []);
  });

  app.post("/api/tasks/:id/attachments", authenticate, attachmentUpload.array('files', 10) as any, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const id = decodeURIComponent(String(req.params.id || '')).trim();
      const idx = tasks.findIndex(t => String(t.id).trim() === id || String(t.taskId).trim() === id);
      if (idx === -1) return res.status(404).json({ error: "Task not found" });

      const uploadedFiles = (req.files as Express.Multer.File[]) || [];
      if (uploadedFiles.length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
      }

      const task = tasks[idx];
      if (!Array.isArray(task.attachments)) task.attachments = [];
      const added: any[] = [];

      for (const file of uploadedFiles) {
        const att = {
          id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          taskId: task.id,
          filename: file.filename,
          originalName: file.originalname,
          mimeType: file.mimetype || 'application/octet-stream',
          sizeBytes: file.size || 0,
          url: `/uploads/attachments/${file.filename}`,
          uploadedBy: user.employeeId || user.id,
          uploadedByName: user.name,
          uploadedAt: new Date().toISOString()
        };
        task.attachments.push(att);
        added.push(att);
      }

      if (!Array.isArray(task.logs)) task.logs = [];
      task.logs.push({
        id: Date.now().toString(),
        action: `Attached ${added.length} file(s): ${added.map(a => a.originalName).join(', ')}`,
        timestamp: new Date().toISOString(),
        user: user.name
      });

      await saveData();
      saveSingleMysqlTask(task).catch(err => console.error("[MYSQL SYNC ERROR] Attachment upload sync:", err?.message || err));
      broadcastRealtimeUpdate({ type: 'TASK_UPDATED', taskId: task.id, status: task.status });
      res.status(201).json({ attachments: task.attachments, added, task: decorateTaskWithTiming(task) });
    } catch (err: any) {
      console.error("Attachment upload error:", err);
      res.status(500).json({ error: err.message || "Failed to upload attachment" });
    }
  });

  app.delete("/api/tasks/:id/attachments/:attId", authenticate, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const id = decodeURIComponent(String(req.params.id || '')).trim();
      const attId = decodeURIComponent(String(req.params.attId || '')).trim();
      const idx = tasks.findIndex(t => String(t.id).trim() === id || String(t.taskId).trim() === id);
      if (idx === -1) return res.status(404).json({ error: "Task not found" });

      const task = tasks[idx];
      if (!Array.isArray(task.attachments)) task.attachments = [];
      const attIndex = task.attachments.findIndex(a => a.id === attId);
      if (attIndex === -1) return res.status(404).json({ error: "Attachment not found" });

      const [removed] = task.attachments.splice(attIndex, 1);
      if (removed?.filename) {
        const localFile = path.join(ATTACHMENTS_DIR, path.basename(removed.filename));
        if (fsSync.existsSync(localFile)) {
          await fs.unlink(localFile).catch(() => {});
        }
      }

      if (!Array.isArray(task.logs)) task.logs = [];
      task.logs.push({
        id: Date.now().toString(),
        action: `Removed attachment: ${removed?.originalName || attId}`,
        timestamp: new Date().toISOString(),
        user: user.name
      });

      await saveData();
      saveSingleMysqlTask(task).catch(err => console.error("[MYSQL SYNC ERROR] Attachment delete sync:", err?.message || err));
      broadcastRealtimeUpdate({ type: 'TASK_UPDATED', taskId: task.id, status: task.status });
      res.json({ success: true, attachments: task.attachments, task: decorateTaskWithTiming(task) });
    } catch (err: any) {
      console.error("Attachment delete error:", err);
      res.status(500).json({ error: err.message || "Failed to delete attachment" });
    }
  });

  app.post("/api/tasks/:id/comments", authenticate, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const id = decodeURIComponent(String(req.params.id || '')).trim();
      const { comment } = req.body;
      if (!comment || !String(comment).trim()) {
        return res.status(400).json({ error: "Comment text is required" });
      }
      const idx = tasks.findIndex(t => String(t.id).trim() === id || String(t.taskId).trim() === id);
      if (idx === -1) return res.status(404).json({ error: "Task not found" });

      const task = tasks[idx];
      if (!Array.isArray(task.comments)) task.comments = [];
      const newComment = {
        id: `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        taskId: task.id,
        userId: user.id,
        employeeId: user.employeeId,
        userName: user.name,
        comment: String(comment).trim(),
        createdAt: new Date().toISOString()
      };
      task.comments.push(newComment);

      if (!Array.isArray(task.logs)) task.logs = [];
      task.logs.push({
        id: Date.now().toString(),
        action: `Commented: ${newComment.comment}`,
        timestamp: newComment.createdAt,
        user: user.name
      });

      await saveData();
      saveSingleMysqlTask(task).catch(err => console.error("[MYSQL SYNC ERROR] Comment sync:", err?.message || err));
      broadcastRealtimeUpdate({ type: 'TASK_UPDATED', taskId: task.id, status: task.status });
      res.status(201).json({ comment: newComment, comments: task.comments, task: decorateTaskWithTiming(task) });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to add comment" });
    }
  });

  app.get("/api/departments", authenticate, (req: Request, res: Response) => {
    const depts = new Set<string>(['RAC R&I']);
    users.forEach(u => { if (u.department) depts.add(String(u.department).trim()); });
    tasks.forEach(t => { if (t.department) depts.add(String(t.department).trim()); });
    res.json(Array.from(depts).map(name => ({
      id: `dept_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      name
    })));
  });

  app.get("/api/projects", authenticate, (req: Request, res: Response) => {
    const models = new Set<string>();
    tasks.forEach(t => {
      if (t.project) models.add(String(t.project).trim());
      if (t.model) models.add(String(t.model).trim());
    });
    res.json(Array.from(models).map(name => ({
      id: `proj_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      name,
      status: 'ACTIVE'
    })));
  });

  app.put("/api/users/theme", authenticate, async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { theme, customBackground } = req.body;
    const userIndex = users.findIndex(u => u.employeeId === user.employeeId);
    if (userIndex !== -1) {
      users[userIndex].theme = theme;
      users[userIndex].customBackground = customBackground;
      await saveData();
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "User not found" });
    }
  });

  app.delete("/api/tasks/:id", authenticate, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { id } = req.params;
      const rawId = String(id || '').trim();
      const cleanId = decodeURIComponent(rawId).trim();
      console.log(`Delete task request for ID: "${cleanId}" from user: ${user.name} (${user.role})`);
      
      const index = tasks.findIndex(t => 
        String(t.id).trim() === cleanId || 
        String(t.taskId).trim() === cleanId ||
        String(t.id).trim() === rawId ||
        String(t.taskId).trim() === rawId ||
        (t.id && cleanId && String(t.id) == cleanId) ||
        (t.taskId && cleanId && String(t.taskId) == cleanId)
      );
      if (index === -1) {
        console.warn(`Task "${cleanId}" not found for deletion. Available task IDs: ${tasks.map(t => `${t.id}/${t.taskId}`).join(', ')}`);
        return res.status(404).json({ error: "Task not found" });
      }

      const task = tasks[index];
      if (user.role === 'OFFICER') {
        return res.status(403).json({ error: "Access Denied: Officers are not permitted to delete tasks." });
      }

      const isSuperAdmin = user.role === 'SUPER_ADMIN' || user.employeeId === 'jhfboss';
      const isCbo = user.role === 'CBO';
      const isDcbo = user.role === 'DCBO';
      const isHod = user.role === 'HOD';
      const isDhod = user.role === 'DHOD';

      if (!isSuperAdmin && !isCbo && !isDcbo && !isHod && !isDhod) {
        console.warn(`Unauthorized delete attempt by user: ${user.name}`);
        return res.status(403).json({ error: "Access Denied: You are not authorized to delete this task" });
      }

      const targetId = String(task.id || '').trim();
      const targetTaskId = String(task.taskId || '').trim();

      // Record in deletedTaskIds tombstone so it can NEVER resurrect
      if (targetId && !deletedTaskIds.includes(targetId)) deletedTaskIds.push(targetId);
      if (targetTaskId && !deletedTaskIds.includes(targetTaskId)) deletedTaskIds.push(targetTaskId);

      // Immediately delete from MySQL tasks table + tombstone
      if (targetId) deleteMysqlTask(targetId);
      if (targetTaskId) deleteMysqlTask(targetTaskId);

      // Remove task from memory
      tasks.splice(index, 1);

      // Clean up point transactions associated with this task
      for (let i = pointTransactions.length - 1; i >= 0; i--) {
        const pt = pointTransactions[i];
        const ptTaskId = String(pt.taskId || '').trim();
        if (
          ptTaskId === targetId || 
          ptTaskId === targetTaskId ||
          ptTaskId === cleanId ||
          ptTaskId === rawId
        ) {
          pointTransactions.splice(i, 1);
        }
      }

      // Clean up assignment requests associated with this task
      for (let i = assignmentRequests.length - 1; i >= 0; i--) {
        const ar = assignmentRequests[i];
        const arTaskId = String(ar.taskId || '').trim();
        if (arTaskId === targetId || arTaskId === targetTaskId || arTaskId === cleanId) {
          assignmentRequests.splice(i, 1);
        }
      }

      // Clean up notifications associated with this task
      for (let i = notifications.length - 1; i >= 0; i--) {
        const notif = notifications[i];
        const nTaskId = String(notif.taskId || '').trim();
        if (nTaskId === targetId || nTaskId === targetTaskId || nTaskId === cleanId) {
          notifications.splice(i, 1);
        }
      }

      recalculateAllPoints();
      rebuildTechnicianStatuses();

      await logAdminAction(user, 'TASK_DELETED', `Deleted task ${task.title} (${task.taskId || task.id})`, undefined, task.id);
      await saveData();

      // Auto-backup triggered immediately on task deletion
      createHourlyBackup('TASK_DELETED', undefined, {
        taskId: task.taskId || task.id,
        title: task.title,
        deletedBy: user.employeeId || user.name
      }).catch(err => console.error("[AUTO-BACKUP ERROR] Task delete backup failed:", err));

      console.log(`Task ${cleanId} deleted successfully. Remaining tasks in memory: ${tasks.length}`);
      broadcastRealtimeUpdate({ type: 'TASK_DELETED', taskId: task.id });
      res.json({ success: true, message: "Task deleted successfully", taskId: task.id });
    } catch (err: any) {
      console.error("Error deleting task:", err);
      res.status(500).json({ error: err.message || "Failed to delete task" });
    }
  });

  app.post("/api/ai/insights", optionalAuth, async (req: Request, res: Response) => {
    try {
      const incomingTasks: any[] = Array.isArray(req.body?.tasks) && req.body.tasks.length > 0 
        ? req.body.tasks 
        : tasks;

      const criticalTasks = incomingTasks.filter((t: any) => t.urgency === 'CRITICAL' && t.status !== 'COMPLETED');
      const urgentTasks = incomingTasks.filter((t: any) => t.urgency === 'URGENT' && t.status !== 'COMPLETED');
      const runningTasks = incomingTasks.filter((t: any) => t.status === 'RUNNING');
      const pendingTasks = incomingTasks.filter((t: any) => t.status === 'PENDING');
      const completedTasks = incomingTasks.filter((t: any) => t.status === 'COMPLETED');

      const todayStr = new Date().toISOString().split('T')[0];
      const overdueTasks = incomingTasks.filter((t: any) => t.status !== 'COMPLETED' && t.deadline && t.deadline < todayStr);

      let heuristicUrgency: 'REGULAR' | 'URGENT' | 'CRITICAL' = 'REGULAR';
      let heuristicReason = 'Tasks are progressing steadily with balanced distribution across teams.';
      let delayProbability = 12;

      if (criticalTasks.length > 0 || overdueTasks.length > 0) {
        heuristicUrgency = 'CRITICAL';
        heuristicReason = `${criticalTasks.length > 0 ? `${criticalTasks.length} critical task(s) active.` : ''} ${overdueTasks.length > 0 ? `${overdueTasks.length} task(s) overdue.` : ''} Immediate intervention recommended.`.trim();
        delayProbability = Math.min(88, 45 + (criticalTasks.length * 15) + (overdueTasks.length * 10));
      } else if (urgentTasks.length > 0 || (pendingTasks.length > runningTasks.length * 2 && pendingTasks.length > 3)) {
        heuristicUrgency = 'URGENT';
        heuristicReason = `${urgentTasks.length} urgent task(s) in queue. Prioritize dispatch to maintain scheduled turnaround.`;
        delayProbability = Math.min(65, 25 + (urgentTasks.length * 10));
      } else if (completedTasks.length > 0 && pendingTasks.length === 0 && runningTasks.length === 0) {
        heuristicUrgency = 'REGULAR';
        heuristicReason = 'All assigned tasks for today have been completed or are on schedule.';
        delayProbability = 5;
      }

      const heuristicTip = criticalTasks.length > 0 
        ? "Reassign secondary duties to focus senior technicians on critical repairs."
        : urgentTasks.length > 0
        ? "Pair technicians on complex urgent tasks to accelerate turnaround time."
        : "Workload distribution is balanced. Maintain current workflow pace.";

      const fallbackResult = {
        urgency: heuristicUrgency,
        reason: heuristicReason,
        delayPrediction: {
          isLikelyDelayed: delayProbability > 40,
          probability: delayProbability
        },
        efficiencyTip: heuristicTip
      };

      // Try Gemini API if key is available
      if (process.env.GEMINI_API_KEY) {
        try {
          const ai = getGenAI();
          if (ai) {
            const sampleTasks = incomingTasks.slice(0, 15).map((t: any) => ({
              title: t.title,
              urgency: t.urgency,
              status: t.status,
              deadline: t.deadline
            }));

            const prompt = `Analyze these daily maintenance tasks and output a concise JSON assessment:
Tasks: ${JSON.stringify(sampleTasks)}
Output JSON format:
{
  "urgency": "REGULAR" | "URGENT" | "CRITICAL",
  "reason": "concise 1-sentence assessment",
  "delayPrediction": {
    "isLikelyDelayed": boolean,
    "probability": number between 0 and 100
  },
  "efficiencyTip": "actionable 1-sentence recommendation"
}`;

            const responsePromise = ai.models.generateContent({
              model: "gemini-3.8-flash",
              contents: prompt,
              config: {
                responseMimeType: "application/json",
              }
            });

            // 4-second timeout to prevent any slow responses
            const timeoutPromise = new Promise((_, reject) => 
              setTimeout(() => reject(new Error("AI timeout")), 4000)
            );

            const result: any = await Promise.race([responsePromise, timeoutPromise]);
            if (result && result.text) {
              const parsed = JSON.parse(result.text);
              if (parsed.urgency && parsed.reason) {
                return res.json({
                  urgency: parsed.urgency,
                  reason: parsed.reason,
                  delayPrediction: parsed.delayPrediction || fallbackResult.delayPrediction,
                  efficiencyTip: parsed.efficiencyTip || fallbackResult.efficiencyTip
                });
              }
            }
          }
        } catch (aiErr: any) {
          // Gemini temporary 503/429/timeout handled silently with smart fallback
          console.warn("AI Insights served via fallback:", aiErr?.status || aiErr?.message || "unavailable");
        }
      }

      return res.json(fallbackResult);
    } catch (err: any) {
      console.error("AI Insights route error:", err);
      res.json({
        urgency: "REGULAR",
        reason: "Tasks are proceeding normally. Work distribution is optimal.",
        delayPrediction: { isLikelyDelayed: false, probability: 10 },
        efficiencyTip: "Keep monitoring task progress throughout the shift."
      });
    }
  });

  app.get("/api/backup/:role/:type", authenticate, async (req: Request, res: Response) => {
    const { role, type } = req.params;
    const { format } = req.query;

    if (req.user.role !== role) {
      return res.status(403).json({ error: "Forbidden: Role mismatch" });
    }

    // Define scope based on role
    const myScope = {
      id: req.user.id,
      employeeId: req.user.employeeId,
      role: req.user.role,
      assignedEngineers: req.user.assignedEngineers || []
    };

    const isTaskInScope = (task: any) => {
      if (myScope.role === 'SUPER_ADMIN' || myScope.role === 'CBO' || myScope.role === 'DCBO' || myScope.role === 'HOD' || myScope.role === 'DHOD') return true;
      if (myScope.role === 'IN_CHARGE' || myScope.role === 'MODEL_MANAGER') {
        // Created by them or assigned to someone they manage
        return task.createdBy === myScope.employeeId || myScope.assignedEngineers.includes(task.assignedToEmployeeId);
      }
      if (myScope.role === 'ENGINEER') {
        // Assigned to them or created by them
        return task.assignedTo === req.user.name || task.createdBy === myScope.employeeId;
      }
      if (myScope.role === 'OFFICER') {
        // Assigned to them or created by them
        return task.assignedTo === req.user.name || task.createdBy === myScope.employeeId;
      }
      return false;
    };

    const scopedTasks = tasks.filter(isTaskInScope);
    let backupData: any = {
      role: myScope.role,
      type,
      timestamp: new Date().toISOString(),
      tasks: scopedTasks
    };

    if (type === 'full') {
      // Include users in scope
      const scopedUsers = users.filter((u: any) => {
        if (myScope.role === 'SUPER_ADMIN' || myScope.role === 'CBO' || myScope.role === 'DCBO' || myScope.role === 'HOD' || myScope.role === 'DHOD') return true;
        if (myScope.role === 'IN_CHARGE' || myScope.role === 'MODEL_MANAGER') {
          return myScope.assignedEngineers.includes(u.employeeId) || u.supervisorId === myScope.id;
        }
        if (myScope.role === 'ENGINEER') {
          return u.supervisorId === myScope.id || (u.assignedEngineers || []).includes(myScope.employeeId);
        }
        return u.id === myScope.id;
      });

      backupData.users = scopedUsers;
      backupData.mapping = users.filter((u: any) => u.assignedEngineers && u.assignedEngineers.length > 0).map((u: any) => ({
        employeeId: u.employeeId,
        assignedEngineers: u.assignedEngineers
      }));
      // Performance data (simplified)
      backupData.performance = scopedTasks.map(t => ({
        taskId: t.taskId,
        points: t.points,
        status: t.status,
        completedAt: t.completedAt
      }));
    }

    if (format === 'excel') {
      const wb = XLSX.utils.book_new();
      const wsTasks = XLSX.utils.json_to_sheet(scopedTasks);
      XLSX.utils.book_append_sheet(wb, wsTasks, "Tasks");
      
      if (type === 'full') {
        const wsUsers = XLSX.utils.json_to_sheet(backupData.users);
        XLSX.utils.book_append_sheet(wb, wsUsers, "Users");
        const wsMapping = XLSX.utils.json_to_sheet(backupData.mapping);
        XLSX.utils.book_append_sheet(wb, wsMapping, "Mapping");
        const wsPerformance = XLSX.utils.json_to_sheet(backupData.performance);
        XLSX.utils.book_append_sheet(wb, wsPerformance, "Performance");
      }

      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Disposition', `attachment; filename=backup_${role.toLowerCase()}_${type}.xlsx`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      return res.send(buf);
    }

    res.json(backupData);
  });

  app.post("/api/restore/:role", authenticate, upload.single('backup') as any, async (req: Request, res: Response) => {
    const { role } = req.params;
    if (req.user.role !== role) {
      if (req.file) await fs.unlink(req.file.path).catch(() => {});
      return res.status(403).json({ error: "Forbidden: Role mismatch" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No backup file uploaded" });
    }

    try {
      let restoredData: any;
      if (req.file.originalname.endsWith('.json')) {
        const content = await fs.readFile(req.file.path, 'utf-8');
        restoredData = JSON.parse(content);
      } else if (req.file.originalname.endsWith('.xlsx')) {
        const workbook = XLSX.readFile(req.file.path);
        const tasksSheet = workbook.Sheets['Tasks'];
        const usersSheet = workbook.Sheets['Users'];

        restoredData = {
          tasks: tasksSheet ? XLSX.utils.sheet_to_json(tasksSheet) : [],
          users: usersSheet ? XLSX.utils.sheet_to_json(usersSheet) : []
        };
      } else {
        await fs.unlink(req.file.path);
        return res.status(400).json({ error: "Unsupported file format" });
      }

      // Validation and scoped restore logic
      if (restoredData.role && restoredData.role !== role) {
        await fs.unlink(req.file.path);
        return res.status(400).json({ error: "Backup file role mismatch" });
      }

      // Get current user's scope
      const myScope = {
        id: req.user.id,
        employeeId: req.user.employeeId,
        role: req.user.role,
        assignedEngineers: req.user.assignedEngineers || []
      };

      const isTaskInScope = (task: any) => {
        if (myScope.role === 'SUPER_ADMIN' || myScope.role === 'CBO' || myScope.role === 'DCBO' || myScope.role === 'HOD') return true;
        if (myScope.role === 'IN_CHARGE' || myScope.role === 'MODEL_MANAGER') {
          return task.createdBy === myScope.employeeId || myScope.assignedEngineers.includes(task.assignedToEmployeeId);
        }
        if (myScope.role === 'ENGINEER') {
          return task.assignedTo === req.user.name || task.createdBy === myScope.employeeId;
        }
        if (myScope.role === 'OFFICER') {
          return task.assignedTo === req.user.name || task.createdBy === myScope.employeeId;
        }
        return false;
      };

      // Restore tasks
      if (Array.isArray(restoredData.tasks)) {
        restoredData.tasks.forEach((restoredTask: any) => {
          if (isTaskInScope(restoredTask)) {
            const rId = String(restoredTask.id || '').trim();
            const rTaskId = String(restoredTask.taskId || '').trim();
            if ((rId && deletedTaskIds.includes(rId)) || (rTaskId && deletedTaskIds.includes(rTaskId))) {
              return;
            }
            const index = tasks.findIndex(t => t.id === restoredTask.id);
            if (index !== -1) {
              tasks[index] = { ...tasks[index], ...restoredTask };
            } else {
              tasks.push(restoredTask);
            }
          }
        });
      }

      // Restore users (only for SUPER_ADMIN/CBO/DCBO/HOD)
      if ((myScope.role === 'SUPER_ADMIN' || myScope.role === 'CBO' || myScope.role === 'DCBO' || myScope.role === 'HOD') && Array.isArray(restoredData.users)) {
        restoredData.users.forEach((restoredUser: any) => {
          const index = users.findIndex(u => u.employeeId === restoredUser.employeeId);
          if (index !== -1) {
            users[index] = { ...users[index], ...restoredUser };
          } else {
            users.push(restoredUser);
          }
        });
      }

      await saveData();
      await fs.unlink(req.file.path); // Clean up uploaded file
      res.json({ message: "Data restored successfully within your scope" });
    } catch (err) {
      console.error("Restore error:", err);
      if (req.file) await fs.unlink(req.file.path).catch(() => {});
      res.status(500).json({ error: "Failed to restore data" });
    }
  });

  app.post("/api/admin/adjust-points", authenticate, async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: "Only Super Admin can adjust points" });
    }

    const { officerId, newPoints, actionType, reason } = req.body;
    const officer = users.find(u => u.id === officerId);
    if (!officer || officer.role !== 'OFFICER') {
      return res.status(404).json({ error: "Officer not found" });
    }

    // Calculate current points from all sources
    const currentPoints = pointTransactions
      .filter(pt => pt.officerId === officerId)
      .reduce((sum, pt) => sum + pt.pointValue, 0);

    if (actionType === 'EDIT') {
      // Direct set: Calculate adjustment needed to reach newPoints
      const adjustment = (Number(newPoints) || 0) - currentPoints;
      
      if (adjustment !== 0) {
        pointTransactions.push({
          id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
          taskId: 'MANUAL_ADJUSTMENT',
          officerId: officerId,
          engineerId: user.employeeId,
          pointValue: adjustment,
          taskPriority: 'REGULAR',
          completedAt: new Date().toISOString()
        });
      }
    } else if (actionType === 'RESET' || actionType === 'DELETE') {
      // Full Reset: Remove all point transactions for this officer
      for (let i = pointTransactions.length - 1; i >= 0; i--) {
        if (pointTransactions[i].officerId === officerId) {
          pointTransactions.splice(i, 1);
        }
      }
      
      // Also mark tasks as not having points added if they were linked
      tasks.forEach(t => {
        const isOfficerTask = (t.createdBy === officer.employeeId || t.assignedBy === officer.employeeId);
        if (isOfficerTask) {
          t.pointAdded = false;
        }
      });
    }

      await logAdminAction(user, `POINT_${actionType}`, `Admin ${user.name} ${actionType === 'EDIT' ? 'edited' : 'reset'} points for ${officer.name}. Reason: ${reason || 'Manual Override'}`, officer.id);
      
      // Force recalculation before saving and returning
      recalculateAllPoints();
      await saveData();
      broadcastRealtimeUpdate({ type: 'POINTS_UPDATED' });
      
      res.json({ success: true, newPoints: officer.total_point });
  });

  app.post("/api/admin/sync-data", authenticate, async (req: Request, res: Response) => {
    try {
      console.log("SYNC STARTED");
      const user = (req as any).user;
      if (user.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ error: "Only Super Admin can synchronize data" });
      }
      
      // ✅ STEP 1: RESET
      users.forEach((u: any) => {
        if (u.role === 'OFFICER') u.total_point = 0;
        if (u.role === 'TECHNICIAN') u.completedTask = 0;
      });
      console.log("RESET DONE");

      // ✅ STEP 1.5: AUTO-FIX MISSING ASSIGNEDBY
      let fixedCount = 0;
      tasks.forEach((t: any) => {
        if (!t.assignedBy && t.createdBy) {
          t.assignedBy = t.createdBy;
          fixedCount++;
        }
      });
      if (fixedCount > 0) console.log(`AUTO-FIXED ${fixedCount} tasks with missing assignedBy`);

      // ✅ STEP 2 & 3: RECALCULATE
      recalculateAllPoints();
      console.log("OFFICER & TECHNICIAN SYNC DONE");

      await saveData();
      broadcastRealtimeUpdate({ type: 'POINTS_UPDATED' });
      console.log("SAVE DONE");
      
      return res.json({ 
        success: true, 
        message: "REAL DATA SYNC COMPLETED" 
      });
    } catch (error: any) {
      console.error("SYNC ERROR:", error);
      return res.status(500).json({ 
        success: false, 
        message: "SYNC FAILED", 
        error: error.message 
      });
    }
  });

  app.delete("/api/admin/tasks/:id", authenticate, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const isSuperAdmin = user.role === 'SUPER_ADMIN' || user.employeeId === 'jhfboss';
      const isExecutive = user.role === 'CBO' || user.role === 'DCBO' || user.role === 'HOD' || user.role === 'DHOD';
      if (!isSuperAdmin && !isExecutive) {
        return res.status(403).json({ error: "Only Super Admin and Executives can delete tasks" });
      }
      const { id } = req.params;
      const rawId = String(id || '').trim();
      const cleanId = decodeURIComponent(rawId).trim();
      console.log(`[ADMIN DELETE] Delete task request for ID: "${cleanId}" from user: ${user.name} (${user.role})`);
      
      const taskIndex = tasks.findIndex(t => 
        String(t.id).trim() === cleanId || 
        String(t.taskId).trim() === cleanId ||
        String(t.id).trim() === rawId ||
        String(t.taskId).trim() === rawId ||
        (t.id && cleanId && String(t.id) == cleanId) ||
        (t.taskId && cleanId && String(t.taskId) == cleanId)
      );
      if (taskIndex === -1) {
        console.warn(`[ADMIN DELETE] Task "${cleanId}" not found for deletion. Available task IDs: ${tasks.map(t => `${t.id}/${t.taskId}`).join(', ')}`);
        return res.status(404).json({ error: "Task not found" });
      }
      
      const task = tasks[taskIndex];
      const targetId = String(task.id || '').trim();
      const targetTaskId = String(task.taskId || '').trim();

      // Record in deletedTaskIds tombstone so it can NEVER resurrect
      if (targetId && !deletedTaskIds.includes(targetId)) deletedTaskIds.push(targetId);
      if (targetTaskId && !deletedTaskIds.includes(targetTaskId)) deletedTaskIds.push(targetTaskId);

      // Immediately delete from MySQL tasks table + tombstone
      if (targetId) deleteMysqlTask(targetId);
      if (targetTaskId) deleteMysqlTask(targetTaskId);

      // Remove from tasks memory
      tasks.splice(taskIndex, 1);

      // Clean up point transactions associated with this task
      for (let i = pointTransactions.length - 1; i >= 0; i--) {
        const pt = pointTransactions[i];
        const ptTaskId = String(pt.taskId || '').trim();
        if (
          ptTaskId === targetId || 
          ptTaskId === targetTaskId ||
          ptTaskId === cleanId ||
          ptTaskId === rawId
        ) {
          pointTransactions.splice(i, 1);
        }
      }

      // Clean up assignment requests associated with this task
      for (let i = assignmentRequests.length - 1; i >= 0; i--) {
        const ar = assignmentRequests[i];
        const arTaskId = String(ar.taskId || '').trim();
        if (arTaskId === targetId || arTaskId === targetTaskId || arTaskId === cleanId) {
          assignmentRequests.splice(i, 1);
        }
      }

      // Clean up notifications associated with this task
      for (let i = notifications.length - 1; i >= 0; i--) {
        const notif = notifications[i];
        const nTaskId = String(notif.taskId || '').trim();
        if (nTaskId === targetId || nTaskId === targetTaskId || nTaskId === cleanId) {
          notifications.splice(i, 1);
        }
      }

      recalculateAllPoints();
      rebuildTechnicianStatuses();
      
      await logAdminAction(user, 'TASK_DELETED', `Deleted task ${task.title} (${task.taskId || task.id})`, undefined, task.id);
      await saveData();

      // Auto-backup triggered immediately on admin task deletion
      createHourlyBackup('TASK_DELETED', undefined, {
        taskId: task.taskId || task.id,
        title: task.title,
        deletedBy: user.employeeId || user.name
      }).catch(err => console.error("[AUTO-BACKUP ERROR] Admin task delete backup failed:", err));

      console.log(`[ADMIN DELETE] Task ${cleanId} (${task.title}) successfully deleted. Remaining tasks in memory: ${tasks.length}`);
      res.json({ success: true, message: "Task deleted successfully", taskId: task.id });
    } catch (err: any) {
      console.error("Error in admin delete task:", err);
      res.status(500).json({ error: err.message || "Failed to delete task" });
    }
  });

  app.put("/api/admin/tasks/:id/points", authenticate, async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: "Only Super Admin can edit task points" });
    }
    const { id } = req.params;
    const { newPoints } = req.body;

    if (newPoints < 0 || newPoints > 3) {
      return res.status(400).json({ error: "Points must be between 0 and 3" });
    }

    const task = tasks.find(t => t.id === id);
    if (!task) return res.status(404).json({ error: "Task not found" });
    
    const oldPoints = task.points || 0;
    task.points = newPoints;
    
    // Update point transaction if it exists
    const pt = pointTransactions.find(pt => pt.taskId === id);
    if (pt) {
      pt.pointValue = newPoints;
    }
    
    await logAdminAction(user, 'TASK_POINT_EDITED', `Updated points for task ${task.title} from ${oldPoints} to ${newPoints}`, undefined, id);
    await saveData();
    res.json({ success: true });
  });

  // --- SMART SHIFT MANAGEMENT, OVERTIME, TIME EXTENSION & TEAM PERFORMANCE APIS ---
  const supervisorRoles = ['SUPER_ADMIN', 'CBO', 'DCBO', 'HOD', 'DHOD', 'IN_CHARGE', 'MODEL_MANAGER', 'ENGINEER', 'OFFICER'];
  const executiveRoles = ['SUPER_ADMIN', 'CBO', 'DCBO', 'HOD', 'DHOD', 'IN_CHARGE'];

  app.get("/api/shifts", authenticate, (req: Request, res: Response) => {
    res.json(shiftConfigurations);
  });

  app.post("/api/shifts", authenticate, async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!executiveRoles.includes(user.role)) {
      return res.status(403).json({ error: "Access Denied: Insufficient permissions to configure shifts." });
    }
    const { id, code, name, startTime, endTime, breakDurationMinutes, breakMinutes, isDefault, color, description } = req.body;
    const normalizedCode = String(code || '').trim().toUpperCase().replace(/\s+/g, '_');
    if (!normalizedCode || !name || !startTime || !endTime) {
      return res.status(400).json({ error: "Shift code, name, startTime, and endTime are required." });
    }

    if (isDefault) {
      shiftConfigurations.forEach(s => { s.isDefault = false; });
    }

    const existingIdx = shiftConfigurations.findIndex(s => s.id === id || s.code.toUpperCase() === normalizedCode);
    const savedShift: ShiftConfiguration = {
      id: existingIdx !== -1 ? shiftConfigurations[existingIdx].id : (id || `shift-${Date.now()}`),
      code: normalizedCode,
      name: String(name).trim(),
      startTime: String(startTime).trim(),
      endTime: String(endTime).trim(),
      breakDurationMinutes: Number(breakDurationMinutes ?? breakMinutes ?? 60),
      isDefault: Boolean(isDefault),
      color: color || 'blue',
      description: description || '',
      isActive: true
    };

    if (existingIdx !== -1) {
      shiftConfigurations[existingIdx] = savedShift;
    } else {
      shiftConfigurations.push(savedShift);
    }

    await logAdminAction(user, 'SHIFT_CONFIG_UPDATED', `Saved shift ${savedShift.code} (${savedShift.startTime}-${savedShift.endTime})`);
    await saveData();
    broadcastRealtimeUpdate({ type: 'SHIFTS_UPDATED', data: savedShift });
    res.status(201).json(savedShift);
  });

  app.put("/api/shifts/:id", authenticate, async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!executiveRoles.includes(user.role)) {
      return res.status(403).json({ error: "Access Denied: Insufficient permissions to update shifts." });
    }
    const { id } = req.params;
    const idx = shiftConfigurations.findIndex(s => s.id === id || s.code === id);
    if (idx === -1) return res.status(404).json({ error: "Shift not found" });

    if (req.body.isDefault) {
      shiftConfigurations.forEach(s => { s.isDefault = false; });
    }
    shiftConfigurations[idx] = {
      ...shiftConfigurations[idx],
      ...req.body,
      id: shiftConfigurations[idx].id
    };
    await saveData();
    broadcastRealtimeUpdate({ type: 'SHIFTS_UPDATED', data: shiftConfigurations[idx] });
    res.json(shiftConfigurations[idx]);
  });

  app.delete("/api/shifts/:id", authenticate, async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!executiveRoles.includes(user.role)) {
      return res.status(403).json({ error: "Access Denied: Insufficient permissions." });
    }
    const { id } = req.params;
    const idx = shiftConfigurations.findIndex(s => s.id === id || s.code === id);
    if (idx === -1) return res.status(404).json({ error: "Shift not found" });
    if (shiftConfigurations[idx].isDefault) {
      return res.status(400).json({ error: "Cannot delete the default shift configuration." });
    }
    const removed = shiftConfigurations.splice(idx, 1)[0];
    await logAdminAction(user, 'SHIFT_CONFIG_DELETED', `Deleted shift ${removed.code}`);
    await saveData();
    res.json({ success: true });
  });

  app.get("/api/shifts/assignments", authenticate, (req: Request, res: Response) => {
    res.json(technicianShiftAssignments);
  });

  app.post("/api/shifts/assignments", authenticate, async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!supervisorRoles.includes(user.role)) {
      return res.status(403).json({ error: "Access Denied: Insufficient permissions." });
    }
    const { technicianId, defaultShiftCode, shiftCode, weeklySchedule, temporaryOverrides, holidays, notes } = req.body;
    const targetEmpId = String(technicianId || '').trim();
    if (!targetEmpId) return res.status(400).json({ error: "technicianId is required" });

    const codeToUse = String(defaultShiftCode || shiftCode || 'SHIFT_B').trim().toUpperCase();
    const existingIdx = technicianShiftAssignments.findIndex(a => String(a.technicianId).trim() === targetEmpId);
    const nowIso = new Date().toISOString();

    const record: TechnicianShiftAssignment = {
      id: existingIdx !== -1 ? (technicianShiftAssignments[existingIdx].id || `assign-${targetEmpId}`) : `assign-${targetEmpId}`,
      technicianId: targetEmpId,
      defaultShiftCode: codeToUse,
      weeklySchedule: weeklySchedule ?? (existingIdx !== -1 ? technicianShiftAssignments[existingIdx].weeklySchedule : undefined),
      temporaryOverrides: temporaryOverrides ?? (existingIdx !== -1 ? technicianShiftAssignments[existingIdx].temporaryOverrides : []),
      holidays: holidays ?? (existingIdx !== -1 ? technicianShiftAssignments[existingIdx].holidays : []),
      assignedBy: user.name,
      assignedAt: nowIso,
      notes
    };

    if (existingIdx !== -1) technicianShiftAssignments[existingIdx] = record;
    else technicianShiftAssignments.push(record);

    rebuildTechnicianStatuses();
    await saveData();
    broadcastRealtimeUpdate({ type: 'SHIFTS_UPDATED', data: record });
    res.json(record);
  });

  app.post("/api/shifts/assignments/bulk", authenticate, async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!supervisorRoles.includes(user.role)) {
      return res.status(403).json({ error: "Access Denied: Insufficient permissions to assign shifts." });
    }
    const { technicianIds, defaultShiftCode, shiftCode, effectiveFrom, effectiveTo, isTemporary, notes } = req.body;
    if (!Array.isArray(technicianIds) || technicianIds.length === 0) {
      return res.status(400).json({ error: "technicianIds array is required" });
    }
    const codeToUse = String(defaultShiftCode || shiftCode || 'SHIFT_B').trim().toUpperCase();
    const nowIso = new Date().toISOString();

    const overrideDates: string[] = [];
    if (isTemporary && effectiveFrom) {
      const startD = parseDate(`${effectiveFrom}T12:00:00+06:00`);
      const endD = effectiveTo ? parseDate(`${effectiveTo}T12:00:00+06:00`) : startD;
      if (!isNaN(startD.getTime()) && !isNaN(endD.getTime())) {
        let cursor = new Date(startD.getTime());
        let guard = 0;
        while (cursor.getTime() <= endD.getTime() && guard < 60) {
          overrideDates.push(getBangladeshDateTime(cursor).dateStr);
          cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
          guard++;
        }
      }
    }

    const updatedRecords: TechnicianShiftAssignment[] = [];
    for (const rawId of technicianIds) {
      const targetEmpId = String(rawId || '').trim();
      if (!targetEmpId) continue;

      const idx = technicianShiftAssignments.findIndex(a => String(a.technicianId).trim() === targetEmpId);
      const existing: TechnicianShiftAssignment = idx !== -1
        ? { ...technicianShiftAssignments[idx] }
        : { id: `assign-${targetEmpId}`, technicianId: targetEmpId, defaultShiftCode: codeToUse, temporaryOverrides: [] };

      if (isTemporary && overrideDates.length > 0) {
        const overrides = Array.isArray(existing.temporaryOverrides) ? [...existing.temporaryOverrides] : [];
        for (const dStr of overrideDates) {
          const oIdx = overrides.findIndex(o => o.date === dStr);
          const ov = { date: dStr, shiftCode: codeToUse, reason: notes || 'Temporary Shift Assignment' };
          if (oIdx !== -1) overrides[oIdx] = ov;
          else overrides.push(ov);
        }
        existing.temporaryOverrides = overrides;
      } else {
        existing.defaultShiftCode = codeToUse;
      }
      existing.assignedBy = user.name;
      existing.assignedAt = nowIso;
      if (notes) existing.notes = notes;

      if (idx !== -1) technicianShiftAssignments[idx] = existing;
      else technicianShiftAssignments.push(existing);
      updatedRecords.push(existing);
    }

    rebuildTechnicianStatuses();
    await logAdminAction(user, 'BULK_SHIFT_ASSIGNED', `Assigned ${updatedRecords.length} technician(s) to ${codeToUse}${isTemporary ? ' (Temporary)' : ''}`);
    await saveData();
    broadcastRealtimeUpdate({ type: 'SHIFTS_UPDATED', data: updatedRecords });
    res.json({ success: true, count: updatedRecords.length, assignments: updatedRecords });
  });

  // --- Overtime Management Routes ---
  app.get("/api/overtime", authenticate, (req: Request, res: Response) => {
    const { taskId, status, technicianId } = req.query;
    let list = [...overtimeRequests];
    if (taskId) list = list.filter(o => String(o.taskId) === String(taskId));
    if (status) list = list.filter(o => String(o.status) === String(status));
    if (technicianId) list = list.filter(o => String(o.technicianId) === String(technicianId));
    list.sort((a, b) => new Date(b.requestedAt || 0).getTime() - new Date(a.requestedAt || 0).getTime());
    res.json(list);
  });

  app.post("/api/overtime/request", authenticate, async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { taskId, technicianId, durationMinutes, reason, date, startTime, autoApprove } = req.body;
    const task = tasks.find(t => t.id === taskId || t.taskId === taskId);
    if (!task) return res.status(404).json({ error: "Task not found" });

    const rawMins = durationMinutes !== undefined && durationMinutes !== null && durationMinutes !== ''
      ? Number(durationMinutes)
      : 120;
    if (![120, 180, 240].includes(rawMins)) {
      return res.status(400).json({ error: "Overtime duration must be 2 hours (minimum), 3 hours, or 4 hours (highest)." });
    }
    const mins = rawMins;
    const trimmedReason = String(reason || '').trim();
    if (!trimmedReason) return res.status(400).json({ error: "Justification reason is required" });

    let resolvedTechId = String(technicianId || '').trim();
    if (!resolvedTechId) {
      const assignedRef = task.workType === 'TEAM' && Array.isArray(task.assignedTechnicians) && task.assignedTechnicians.length > 0
        ? task.assignedTechnicians[0].employeeId
        : task.assignedTo;
      const techUser = users.find(u => u.employeeId === assignedRef || u.id === assignedRef || u.name === assignedRef);
      resolvedTechId = techUser ? techUser.employeeId : String(assignedRef || user.employeeId);
    } else {
      const techUser = users.find(u => u.employeeId === resolvedTechId || u.id === resolvedTechId || u.name === resolvedTechId);
      if (techUser) resolvedTechId = techUser.employeeId;
    }
    const techObj = users.find(u => u.employeeId === resolvedTechId);

    const bdNow = getBangladeshDateTime();
    const otDate = date || bdNow.dateStr;
    const { shift } = getTechnicianShiftForDate(resolvedTechId, otDate, technicianShiftAssignments, shiftConfigurations);

    const startDt = startTime ? parseDate(startTime) : createBangladeshTimestamp(otDate, shift.endTime);
    const startMs = !isNaN(startDt.getTime()) ? startDt.getTime() : Date.now();
    const endMs = startMs + mins * 60 * 1000;

    const canAutoApprove = Boolean(autoApprove) && supervisorRoles.includes(user.role);
    const nowIso = new Date().toISOString();

    const otRecord: OvertimeRequest = {
      id: `ot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      taskId: task.id,
      taskTitle: task.title,
      technicianId: resolvedTechId,
      technicianName: techObj?.name || resolvedTechId,
      date: otDate,
      startTime: new Date(startMs).toISOString(),
      endTime: new Date(endMs).toISOString(),
      normalDutyEndTime: shift.endTime,
      durationMinutes: mins,
      approvedDurationMinutes: canAutoApprove ? mins : undefined,
      reason: trimmedReason,
      status: canAutoApprove ? 'APPROVED' : 'PENDING',
      requestedBy: user.name,
      requestedById: user.employeeId,
      requestedAt: nowIso,
      approvedBy: canAutoApprove ? user.name : undefined,
      approvedById: canAutoApprove ? user.employeeId : undefined,
      approvedAt: canAutoApprove ? nowIso : undefined
    };

    overtimeRequests.push(otRecord);
    addTaskTimerAuditLog({
      taskId: task.id,
      technicianId: resolvedTechId,
      event: canAutoApprove ? 'OVERTIME_APPROVED' : 'OVERTIME_REQUESTED',
      details: canAutoApprove
        ? `Supervisor ${user.name} granted +${mins}m overtime on ${otDate} (${shift.endTime} -> ${getBangladeshDateTime(endMs).timeStr} BST): ${trimmedReason}`
        : `${user.name} requested +${mins}m overtime on ${otDate}: ${trimmedReason}`,
      actor: user.name,
      actorId: user.employeeId
    });

    if (!canAutoApprove) {
      users.filter(u => supervisorRoles.includes(u.role) && ['SUPER_ADMIN', 'HOD', 'DHOD', 'IN_CHARGE', 'OFFICER', 'ENGINEER'].includes(u.role)).forEach(sup => {
        if (sup.employeeId === task.createdBy || sup.employeeId === techObj?.supervisorId || sup.role === 'IN_CHARGE' || sup.role === 'HOD' || sup.role === 'DHOD') {
          notifications.push({
            id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            userId: sup.id,
            senderId: user.id,
            taskId: task.id,
            type: 'OVERTIME_REQUEST',
            message: `Overtime request (+${formatMinutes(mins)}) from ${user.name} for "${task.title}"`,
            read: false,
            timestamp: nowIso
          });
        }
      });
    } else if (techObj) {
      notifications.push({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        userId: techObj.id,
        senderId: user.id,
        taskId: task.id,
        type: 'OVERTIME_APPROVED',
        message: `${user.name} authorized +${formatMinutes(mins)} overtime for "${task.title}"`,
        read: false,
        timestamp: nowIso
      });
    }

    await saveData();
    broadcastRealtimeUpdate({ type: 'OVERTIME_UPDATED', taskId: task.id, data: otRecord });
    res.status(201).json(otRecord);
  });

  app.post("/api/overtime/:id/approve", authenticate, async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!supervisorRoles.includes(user.role)) {
      return res.status(403).json({ error: "Access Denied: Only authorized supervisors can approve overtime." });
    }
    const { id } = req.params;
    const ot = overtimeRequests.find(o => o.id === id);
    if (!ot) return res.status(404).json({ error: "Overtime request not found" });

    let approvedMins: number;
    if (req.body.approvedDurationMinutes !== undefined && req.body.approvedDurationMinutes !== null && req.body.approvedDurationMinutes !== '') {
      const parsedApproved = Number(req.body.approvedDurationMinutes);
      if (![120, 180, 240].includes(parsedApproved)) {
        return res.status(400).json({ error: "Approved overtime duration must be 2 hours (minimum), 3 hours, or 4 hours (highest)." });
      }
      approvedMins = parsedApproved;
    } else {
      approvedMins = Math.max(120, Math.min(240, Number(ot.durationMinutes) || 120));
    }
    const startMs = parseDate(ot.startTime).getTime() || Date.now();
    const endMs = startMs + approvedMins * 60 * 1000;

    ot.status = 'APPROVED';
    ot.approvedDurationMinutes = approvedMins;
    ot.endTime = new Date(endMs).toISOString();
    ot.approvedBy = user.name;
    ot.approvedById = user.employeeId;
    ot.approvedAt = new Date().toISOString();
    if (req.body.remarks) ot.remarks = req.body.remarks;

    addTaskTimerAuditLog({
      taskId: ot.taskId,
      technicianId: ot.technicianId,
      event: 'OVERTIME_APPROVED',
      details: `Approved +${approvedMins}m overtime by ${user.name}`,
      actor: user.name,
      actorId: user.employeeId
    });

    const techObj = users.find(u => u.employeeId === ot.technicianId);
    if (techObj) {
      notifications.push({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        userId: techObj.id,
        senderId: user.id,
        taskId: ot.taskId,
        type: 'OVERTIME_APPROVED',
        message: `Your +${formatMinutes(approvedMins)} overtime for "${ot.taskTitle || ot.taskId}" was approved by ${user.name}`,
        read: false,
        timestamp: new Date().toISOString()
      });
    }

    await saveData();
    broadcastRealtimeUpdate({ type: 'OVERTIME_UPDATED', taskId: ot.taskId, data: ot });
    res.json(ot);
  });

  app.post("/api/overtime/:id/reject", authenticate, async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!supervisorRoles.includes(user.role)) {
      return res.status(403).json({ error: "Access Denied: Only authorized supervisors can reject overtime." });
    }
    const { id } = req.params;
    const ot = overtimeRequests.find(o => o.id === id);
    if (!ot) return res.status(404).json({ error: "Overtime request not found" });

    ot.status = 'REJECTED';
    ot.rejectedBy = user.name;
    ot.rejectedAt = new Date().toISOString();
    ot.remarks = req.body.reason || 'Rejected by supervisor';

    addTaskTimerAuditLog({
      taskId: ot.taskId,
      technicianId: ot.technicianId,
      event: 'OVERTIME_REJECTED',
      details: `Overtime rejected by ${user.name}: ${ot.remarks}`,
      actor: user.name,
      actorId: user.employeeId
    });

    await saveData();
    broadcastRealtimeUpdate({ type: 'OVERTIME_UPDATED', taskId: ot.taskId, data: ot });
    res.json(ot);
  });

  app.post("/api/overtime/:id/cancel", authenticate, async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { id } = req.params;
    const ot = overtimeRequests.find(o => o.id === id);
    if (!ot) return res.status(404).json({ error: "Overtime request not found" });
    if (!supervisorRoles.includes(user.role) && ot.technicianId !== user.employeeId && ot.requestedById !== user.employeeId) {
      return res.status(403).json({ error: "Access Denied" });
    }
    ot.status = 'CANCELLED';
    await saveData();
    broadcastRealtimeUpdate({ type: 'OVERTIME_UPDATED', taskId: ot.taskId, data: ot });
    res.json(ot);
  });

  // --- Task Estimated Duration Extension ---
  app.post("/api/tasks/:id/extend-time", authenticate, async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!supervisorRoles.includes(user.role)) {
      return res.status(403).json({ error: "Access Denied: Only supervisors can extend task estimated time." });
    }
    const { id } = req.params;
    const { additionalMinutes, reason } = req.body;
    const idx = tasks.findIndex(t => t.id === id || t.taskId === id);
    if (idx === -1) return res.status(404).json({ error: "Task not found" });

    const mins = Math.max(15, Number(additionalMinutes) || 0);
    const trimmedReason = String(reason || '').trim();
    if (!mins || !trimmedReason) {
      return res.status(400).json({ error: "additionalMinutes and reason are required" });
    }

    const oldTask = tasks[idx];
    const currentEstimatedMins = parseDurationToMinutes(oldTask.revisedEstimatedDuration || oldTask.estimatedDuration);
    const originalDuration = oldTask.originalEstimatedDuration || oldTask.estimatedDuration || `${currentEstimatedMins}m`;
    const newTotalMins = currentEstimatedMins + mins;
    const newDurationFormatted = formatMinutes(newTotalMins);

    const extRecord: TaskTimeExtension = {
      id: `ext_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      taskId: oldTask.id,
      previousEstimatedMinutes: currentEstimatedMins,
      additionalMinutes: mins,
      newEstimatedMinutes: newTotalMins,
      reason: trimmedReason,
      extendedBy: user.name,
      extendedById: user.employeeId,
      extendedAt: new Date().toISOString()
    };

    taskTimeExtensions.push(extRecord);
    const history = Array.isArray(oldTask.extensionHistory) ? [...oldTask.extensionHistory, extRecord] : [extRecord];

    tasks[idx] = {
      ...oldTask,
      originalEstimatedDuration: originalDuration,
      revisedEstimatedDuration: newDurationFormatted,
      estimatedDuration: String(newTotalMins),
      extensionHistory: history,
      logs: [
        ...(oldTask.logs || []),
        {
          id: Date.now().toString(),
          action: `Estimated duration extended by +${formatMinutes(mins)} (${oldTask.estimatedDuration || currentEstimatedMins + 'm'} -> ${newDurationFormatted}): ${trimmedReason}`,
          timestamp: new Date().toISOString(),
          user: user.name
        }
      ]
    };

    addTaskTimerAuditLog({
      taskId: oldTask.id,
      event: 'TIME_EXTENDED',
      details: `Extended by +${mins}m (New target: ${newTotalMins}m) — ${trimmedReason}`,
      actor: user.name,
      actorId: user.employeeId
    });

    recalculateAllPoints();
    await saveData();
    saveSingleMysqlTask(tasks[idx]).catch(err => console.error("[MYSQL SYNC ERROR] Task extension sync:", err?.message || err));
    broadcastRealtimeUpdate({ type: 'TASK_UPDATED', taskId: tasks[idx].id, status: tasks[idx].status });
    res.json(decorateTaskWithTiming(tasks[idx]));
  });

  // --- Performance Config & Advanced Team Performance Dashboard ---
  app.get("/api/performance/config", authenticate, (req: Request, res: Response) => {
    res.json(performanceConfig);
  });

  app.post("/api/performance/config", authenticate, async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!['SUPER_ADMIN', 'CBO', 'DCBO', 'HOD', 'DHOD'].includes(user.role)) {
      return res.status(403).json({ error: "Access Denied: Only executive leadership can update performance weights." });
    }
    const { timeEfficiencyWeight, taskCompletionWeight, qualityWeight, onTimeCompletionWeight, supervisorEvalWeight } = req.body;
    const sum = Number(timeEfficiencyWeight) + Number(taskCompletionWeight) + Number(qualityWeight) + Number(onTimeCompletionWeight) + Number(supervisorEvalWeight);
    if (Math.abs(sum - 100) > 0.01) {
      return res.status(400).json({ error: `Weights must sum to 100% (currently ${sum}%).` });
    }
    performanceConfig = {
      timeEfficiencyWeight: Number(timeEfficiencyWeight),
      taskCompletionWeight: Number(taskCompletionWeight),
      qualityWeight: Number(qualityWeight),
      onTimeCompletionWeight: Number(onTimeCompletionWeight),
      supervisorEvalWeight: Number(supervisorEvalWeight)
    };
    await logAdminAction(user, 'PERFORMANCE_CONFIG_UPDATED', `Updated performance weights: ${JSON.stringify(performanceConfig)}`);
    await saveData();
    res.json(performanceConfig);
  });

  app.get("/api/analytics/team-performance", authenticate, (req: Request, res: Response) => {
    const user = (req as any).user;
    const period = String(req.query.period || 'monthly').toLowerCase();
    const bdNow = getBangladeshDateTime();
    const targetMonth = req.query.month ? parseInt(String(req.query.month), 10) : bdNow.month;
    const targetYear = req.query.year ? parseInt(String(req.query.year), 10) : bdNow.year;

    const nowMs = Date.now();
    const sevenDaysAgoMs = nowMs - 7 * 24 * 60 * 60 * 1000;
    const periodTasks = tasks.filter(t => {
      if (t.requestStatus === 'REJECTED') return false;
      const refDate = parseDate(t.completedAt || t.startedAt || t.createdAt);
      if (isNaN(refDate.getTime())) return false;
      const refBd = getBangladeshDateTime(refDate);
      if (period === 'daily') {
        return refBd.dateStr === bdNow.dateStr || t.status === 'RUNNING';
      }
      if (period === 'weekly') {
        return refDate.getTime() >= sevenDaysAgoMs || t.status === 'RUNNING';
      }
      return (refBd.month === targetMonth && refBd.year === targetYear) || (targetMonth === bdNow.month && targetYear === bdNow.year && t.status === 'RUNNING');
    });

    const technicians = users.filter(u => {
      if (u.role !== 'TECHNICIAN') return false;
      if (['SUPER_ADMIN', 'CBO', 'DCBO', 'HOD', 'DHOD', 'IN_CHARGE', 'MODEL_MANAGER', 'ENGINEER'].includes(user.role)) return true;
      if (user.role === 'OFFICER') {
        return !u.supervisorId || u.supervisorId === user.id || (Array.isArray(u.supervisor_ids) && u.supervisor_ids.includes(user.employeeId));
      }
      return u.employeeId === user.employeeId || u.id === user.id;
    });

    let totalEstimatedMins = 0;
    let totalActualMins = 0;
    let totalOvertimeMins = 0;
    let completedTasksTotal = 0;
    let runningTasksTotal = 0;
    let pendingTasksTotal = 0;

    const techStatsMap = new Map<string, any>();
    technicians.forEach(tech => {
      const { shift } = getTechnicianShiftForDate(tech.employeeId, bdNow.dateStr, technicianShiftAssignments, shiftConfigurations);
      techStatsMap.set(tech.employeeId, {
        technicianId: tech.employeeId,
        technicianName: tech.name,
        department: tech.department || 'RAC R&I',
        assignedShift: shift.code,
        totalTasks: 0,
        completedTasks: 0,
        onTimeTasks: 0,
        reworkIncidents: 0,
        qualityRatings: [] as number[],
        supervisorRatings: [] as number[],
        estimatedMinutes: 0,
        actualMinutes: 0,
        overtimeMinutes: 0
      });
    });

    periodTasks.forEach(task => {
      const timing = computeTaskTiming(task);
      const isCompleted = task.status === 'COMPLETED';
      if (isCompleted) completedTasksTotal++;
      else if (task.status === 'RUNNING') runningTasksTotal++;
      else pendingTasksTotal++;

      totalEstimatedMins += timing.estimatedMinutes;
      totalActualMins += timing.accumulatedWorkingMinutes;
      totalOvertimeMins += timing.accumulatedOvertimeMinutes;

      const assignedIds: string[] = [];
      if (task.workType === 'TEAM' && Array.isArray(task.assignedTechnicians)) {
        task.assignedTechnicians.forEach(at => {
          if (at.employeeId) assignedIds.push(String(at.employeeId).trim());
        });
      } else if (task.assignedTo) {
        const matched = users.find(u => u.employeeId === task.assignedTo || u.id === task.assignedTo || u.name === task.assignedTo);
        if (matched && matched.role === 'TECHNICIAN') assignedIds.push(matched.employeeId);
      }

      for (const empId of assignedIds) {
        const entry = techStatsMap.get(empId);
        if (!entry) continue;
        entry.totalTasks++;
        entry.estimatedMinutes += timing.estimatedMinutes;
        entry.actualMinutes += timing.accumulatedWorkingMinutes;
        entry.overtimeMinutes += timing.accumulatedOvertimeMinutes;
        if (isCompleted) {
          entry.completedTasks++;
          const deadlineMs = task.deadline ? parseDate(task.deadline).getTime() : Infinity;
          const compMs = task.completedAt ? parseDate(task.completedAt).getTime() : Date.now();
          if (compMs <= deadlineMs && !timing.isTimeExceeded) {
            entry.onTimeTasks++;
          }
        }
        if (task.reworkCount) entry.reworkIncidents += Number(task.reworkCount);
        if (task.quality) entry.qualityRatings.push(Number(task.quality));
        if (task.supervisorRating) entry.supervisorRatings.push(Number(task.supervisorRating));
      }
    });

    const rankings = Array.from(techStatsMap.values()).map(entry => {
      const avgQuality = entry.qualityRatings.length > 0
        ? entry.qualityRatings.reduce((a: number, b: number) => a + b, 0) / entry.qualityRatings.length
        : undefined;
      const avgSupRating = entry.supervisorRatings.length > 0
        ? entry.supervisorRatings.reduce((a: number, b: number) => a + b, 0) / entry.supervisorRatings.length
        : undefined;

      const scoreBreakdown = entry.totalTasks === 0
        ? { compositeScore: 0, timeEfficiencyScore: 100, completionRate: 0, qualityScore: 100, onTimeRate: 0, supervisorScore: 90 }
        : calculatePerformanceScore({
            estimatedMinutes: entry.estimatedMinutes || 60,
            actualMinutes: entry.actualMinutes || entry.estimatedMinutes || 60,
            completedTasksCount: entry.completedTasks,
            totalAssignedTasksCount: entry.totalTasks,
            averageQualityRating: avgQuality,
            reworkCount: entry.reworkIncidents,
            onTimeTasksCount: entry.onTimeTasks,
            supervisorRating: avgSupRating
          }, performanceConfig);

      return {
        technicianId: entry.technicianId,
        technicianName: entry.technicianName,
        department: entry.department,
        assignedShift: entry.assignedShift,
        totalTasks: entry.totalTasks,
        completedTasks: entry.completedTasks,
        actualWorkingHours: Math.round((entry.actualMinutes / 60) * 10) / 10,
        estimatedHours: Math.round((entry.estimatedMinutes / 60) * 10) / 10,
        approvedOvertimeHours: Math.round((entry.overtimeMinutes / 60) * 10) / 10,
        timeEfficiencyPercentage: Math.min(130, Math.round(scoreBreakdown.timeEfficiencyScore)),
        completionRatePercentage: Math.round(scoreBreakdown.completionRate),
        qualityRatePercentage: Math.round(scoreBreakdown.qualityScore),
        onTimeRatePercentage: Math.round(scoreBreakdown.onTimeRate),
        reworkIncidents: entry.reworkIncidents,
        compositeScore: scoreBreakdown.compositeScore
      };
    });

    rankings.sort((a, b) => b.compositeScore - a.compositeScore || b.completedTasks - a.completedTasks);
    const rankedWithPos = rankings.map((r, idx) => ({ ...r, rank: idx + 1 }));

    const activeTechs = rankedWithPos.filter(r => r.totalTasks > 0);
    const avgTeamScore = activeTechs.length > 0
      ? Math.round((activeTechs.reduce((s, r) => s + r.compositeScore, 0) / activeTechs.length) * 10) / 10
      : 0;
    const avgEfficiency = totalActualMins > 0
      ? Math.min(130, Math.round((totalEstimatedMins / totalActualMins) * 100))
      : 100;

    res.json({
      period,
      month: targetMonth,
      year: targetYear,
      config: performanceConfig,
      summary: {
        actualWorkingHours: Math.round((totalActualMins / 60) * 10) / 10,
        estimatedHours: Math.round((totalEstimatedMins / 60) * 10) / 10,
        averageEfficiency: avgEfficiency,
        approvedOvertimeHours: Math.round((totalOvertimeMins / 60) * 10) / 10,
        completedTasks: completedTasksTotal,
        runningTasks: runningTasksTotal,
        pendingTasks: pendingTasksTotal,
        totalTasks: periodTasks.length,
        averageTeamScore: avgTeamScore
      },
      awards: {
        topPerformer: activeTechs[0] || rankedWithPos[0] || null,
        mostProductive: [...activeTechs].sort((a, b) => b.completedTasks - a.completedTasks)[0] || null,
        mostEfficient: [...activeTechs].sort((a, b) => b.timeEfficiencyPercentage - a.timeEfficiencyPercentage)[0] || null,
        qualityChampion: [...activeTechs].sort((a, b) => a.reworkIncidents - b.reworkIncidents || b.qualityRatePercentage - a.qualityRatePercentage)[0] || null
      },
      rankings: rankedWithPos
    });
  });

  // --- Background 60-Second Smart Working-Time Engine Monitor ---
  const lastTimerStateByTask = new Map<string, string>();
  setInterval(async () => {
    try {
      let stateChanged = false;
      const now = new Date();
      for (const t of tasks) {
        if (t.status !== 'RUNNING') continue;
        const timing = computeTaskTiming(t, now);
        const prevState = lastTimerStateByTask.get(t.id);
        const currState = timing.timerStatus;

        if (prevState && prevState !== currState) {
          if (currState === 'PAUSED_SHIFT_END') {
            addTaskTimerAuditLog({
              taskId: t.id,
              event: 'AUTO_PAUSED_SHIFT_END',
              details: `Duty shift ${timing.activeShift?.code || ''} ended — task automatically paused at ${formatMinutes(timing.accumulatedWorkingMinutes)} accumulated work.`,
              actor: 'SmartTimerEngine'
            });
            const supUser = users.find(u => u.employeeId === t.createdBy || u.employeeId === t.responsibleOfficerId);
            if (supUser) {
              notifications.push({
                id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                userId: supUser.id,
                taskId: t.id,
                type: 'SHIFT_END_OVERTIME_PROMPT',
                message: `Task "${t.title}" paused at shift end (${formatMinutes(timing.accumulatedWorkingMinutes)} worked). Approve overtime if continuation is needed today.`,
                read: false,
                timestamp: now.toISOString()
              });
            }
            stateChanged = true;
          } else if (currState === 'RUNNING' || currState === 'RESUMED') {
            addTaskTimerAuditLog({
              taskId: t.id,
              event: 'AUTO_RESUMED_CHECKIN',
              details: `New shift/check-in active — task automatically resumed (${formatMinutes(timing.accumulatedWorkingMinutes)} prior work preserved).`,
              actor: 'SmartTimerEngine'
            });
            stateChanged = true;
          }
          broadcastRealtimeUpdate({ type: 'TIMER_TICK', taskId: t.id, status: currState });
        }
        lastTimerStateByTask.set(t.id, currState);
      }
      if (stateChanged) {
        rebuildTechnicianStatuses();
        await saveData();
      }
    } catch (err) {
      console.error('[SMART TIMER MONITOR] Tick error:', err);
    }
  }, 60000);

  // --- API 404 Handler ---
  app.all("/api/*", (req, res) => {
    console.warn(`404 API Not Found: ${req.method} ${req.originalUrl}`);
    res.status(404).json({ error: `API endpoint ${req.method} ${req.originalUrl} not found` });
  });

  // --- Global Error Handler ---
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error("Unhandled Error:", err);
    if (res.headersSent) {
      return next(err);
    }
    res.status(err.status || 500).json({
      error: err.message || "Internal Server Error",
      path: req.originalUrl
    });
  });

  // --- Vite & Static Asset Integration ---
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

  const distPath = path.join(process.cwd(), "dist");
  const hasDist = fsSync.existsSync(path.join(distPath, "index.html"));
  const isProduction = process.env.NODE_ENV === "production" || (!process.env.NODE_ENV && hasDist);

  if (isProduction && hasDist) {
    console.log("Starting in production mode (serving from dist/)...");
    app.use(express.static(distPath));
    app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
  } else {
    console.log("Starting Vite in development mode...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite middleware ready.");
  }

  // --- Global Error Handler ---
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error("Unhandled Error:", err);
    if (res.headersSent) {
      return next(err);
    }
    res.status(err.status || 500).json({ error: err.message || "Internal Server Error" });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running at http://localhost:${PORT}`);
    
    // Run initial recalculation, default password verification, and status rebuild after server is up
    setTimeout(async () => {
      try {
        console.log("Running initial data synchronization...");
        for (const user of defaultUsers) {
          const existingUser = users.find((u: any) => u.employeeId.toLowerCase() === user.employeeId.toLowerCase());
          if (existingUser && existingUser.password) {
            const isMatch = await bcrypt.compare(user.password, existingUser.password);
            if (!isMatch) {
              existingUser.password = await bcrypt.hash(user.password, 10);
            }
          }
        }
        recalculateAllPoints();
        rebuildTechnicianStatuses();
        await saveData();
        console.log("Initial data synchronization completed.");
      } catch (syncErr) {
        console.error("Initial data sync error:", syncErr);
      }
    }, 1000);
  });

  process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED REJECTION at:', promise, 'reason:', reason);
  });

  // --- Session Cleanup Task ---
  // Runs every hour to clean up old inactive sessions
  setInterval(async () => {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    let changed = false;

    userSessions.forEach(s => {
      if (s.active) {
        const lastActivity = new Date(s.lastActivity);
        if (lastActivity < sevenDaysAgo) {
          s.active = false;
          s.logoutTime = now.toISOString();
          changed = true;
          
          const log = activityLogs.find(l => l.id === s.id);
          if (log) {
            log.logoutTime = s.logoutTime;
            log.sessionDuration = "Timeout (7 days inactivity)";
          }
        }
      }
    });

    // Also remove very old inactive sessions (e.g. older than 30 days) to keep data.json small
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const initialCount = userSessions.length;
    const filteredSessions = userSessions.filter(s => {
      if (s.active) return true;
      const loginTime = new Date(s.loginTime);
      return loginTime > thirtyDaysAgo;
    });

    if (filteredSessions.length !== initialCount) {
      userSessions.length = 0;
      for (const session of filteredSessions) {
        userSessions.push(session);
      }
      changed = true;
    }

    if (changed) {
      console.log(`Cleaned up sessions. Active sessions: ${userSessions.filter(s => s.active).length}`);
      await saveData();
    }
  }, 3600000); // Every hour

  // --- Periodic Auto-Save ---
  // Save data every 5 minutes to persist in-memory changes (like lastActivity)
  setInterval(async () => {
    console.log('Periodic auto-save...');
    await saveData();
  }, 300000); // Every 5 minutes

  // --- Start Hourly Auto-Backup Engine ---
  startAutoBackupSchedule();
}

startServer().catch(err => {
  console.error("CRITICAL: Server failed to start:", err);
  process.exit(1);
});
