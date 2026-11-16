import mysql from 'mysql2/promise';
import crypto from 'crypto';
import dns from 'dns';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

export interface PersistentBackupRecord {
  id: string;
  filename: string;
  timestamp: string;
  type: '5MIN_AUTO' | 'MANUAL' | 'TASK_ENTRY' | 'TASK_DELETED' | string;
  status: 'SUCCESS' | 'FAILED';
  totalTasks: number;
  totalUsers: number;
  totalAttendance: number;
  sizeBytes: number;
  checksum: string;
  verified: boolean;
  metaDetails?: Record<string, any>;
  data?: any;
}

export interface LocalDbConfig {
  enabled: boolean;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

let pool: mysql.Pool | null = null;
let schemaInitialized = false;
let lastDbError: string | null = null;
let hostUnreachableUntil = 0;
let loggedHostNotice = false;

// Delta-hash caches to keep MySQL writes minimal on unmodified rows
const userWriteCache = new Map<string, string>();
const taskWriteCache = new Map<string, string>();
let lastGlobalHashes: Record<string, string> = {};

export function getMysqlConfig(): LocalDbConfig {
  const host = (process.env.MYSQL_HOST || '').trim();
  const port = parseInt(process.env.MYSQL_PORT || '3306', 10) || 3306;
  const database = (process.env.MYSQL_DATABASE || 'task_management').trim();
  const user = (process.env.MYSQL_USER || 'taskadmin').trim();
  const password = process.env.MYSQL_PASSWORD || '';
  return {
    enabled: Boolean(host),
    host,
    port,
    database,
    user,
    password
  };
}

export function isMysqlEnabled(): boolean {
  if (!getMysqlConfig().enabled) return false;
  if (hostUnreachableUntil > Date.now()) return false;
  return true;
}

async function checkHostResolvable(host: string): Promise<boolean> {
  if (!host) return false;
  if (host === '127.0.0.1' || host === 'localhost') return true;
  if (hostUnreachableUntil > Date.now()) return false;
  try {
    await dns.promises.lookup(host);
    hostUnreachableUntil = 0;
    return true;
  } catch (err: any) {
    hostUnreachableUntil = Date.now() + 60_000;
    lastDbError = err?.message || `Host "${host}" not resolvable`;
    if (!loggedHostNotice) {
      loggedHostNotice = true;
      console.log(`[MYSQL DB] Host "${host}" is unreachable in this runtime (${err?.code || 'ENOTFOUND'}). Running with local filesystem storage.`);
    }
    return false;
  }
}

export function initMysqlPool(): mysql.Pool | null {
  const cfg = getMysqlConfig();
  if (!cfg.enabled || hostUnreachableUntil > Date.now()) {
    return null;
  }
  if (pool) return pool;

  try {
    pool = mysql.createPool({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      charset: 'utf8mb4',
      timezone: '+06:00',
      multipleStatements: true
    });
    console.log(`[MYSQL DB] Connection pool initialized (${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database})`);
    return pool;
  } catch (err: any) {
    lastDbError = err?.message || String(err);
    console.warn('[MYSQL DB] Failed to create connection pool:', lastDbError);
    return null;
  }
}

const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS departments (
    id VARCHAR(128) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(64) NULL,
    description TEXT NULL,
    created_at VARCHAR(64) NULL,
    UNIQUE KEY uq_departments_name (name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS projects (
    id VARCHAR(128) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    department_id VARCHAR(128) NULL,
    department_name VARCHAR(255) NULL,
    description TEXT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    created_at VARCHAR(64) NULL,
    UNIQUE KEY uq_projects_name (name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(128) PRIMARY KEY,
    employee_id VARCHAR(128) NOT NULL,
    name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NULL,
    role VARCHAR(64) NOT NULL,
    department VARCHAR(255) NULL,
    section VARCHAR(255) NULL,
    designation VARCHAR(255) NULL,
    email VARCHAR(255) NULL,
    phone VARCHAR(64) NULL,
    supervisor_id VARCHAR(128) NULL,
    cbo_id VARCHAR(128) NULL,
    dcbo_id VARCHAR(128) NULL,
    hod_id VARCHAR(128) NULL,
    dhod_id VARCHAR(128) NULL,
    supervisor_ids_json TEXT NULL,
    assigned_engineers_json TEXT NULL,
    avatar LONGTEXT NULL,
    theme VARCHAR(128) NULL,
    custom_background LONGTEXT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'FREE',
    total_point DECIMAL(10,2) NOT NULL DEFAULT 0,
    completed_task INT NOT NULL DEFAULT 0,
    must_change_password TINYINT(1) NOT NULL DEFAULT 0,
    updated_at VARCHAR(64) NULL,
    raw_json LONGTEXT NOT NULL,
    UNIQUE KEY uq_users_employee_id (employee_id),
    INDEX idx_users_role (role),
    INDEX idx_users_department (department)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS tasks (
    id VARCHAR(128) PRIMARY KEY,
    task_id VARCHAR(128) NOT NULL,
    title VARCHAR(500) NOT NULL,
    model VARCHAR(255) NULL,
    department VARCHAR(255) NULL,
    project VARCHAR(255) NULL,
    details TEXT NULL,
    urgency VARCHAR(32) NOT NULL DEFAULT 'REGULAR',
    created_by VARCHAR(128) NULL,
    assigned_by VARCHAR(128) NULL,
    assigned_to VARCHAR(255) NULL,
    work_type VARCHAR(32) NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    progress INT NOT NULL DEFAULT 0,
    points DECIMAL(10,2) NULL,
    quality DECIMAL(5,2) NULL,
    deadline VARCHAR(64) NULL,
    engineer_deadline VARCHAR(64) NULL,
    remarks TEXT NULL,
    created_at VARCHAR(64) NULL,
    started_at VARCHAR(64) NULL,
    completed_at VARCHAR(64) NULL,
    request_status VARCHAR(32) NULL,
    request_remarks TEXT NULL,
    approved_by VARCHAR(128) NULL,
    custom_start_time VARCHAR(64) NULL,
    estimated_duration VARCHAR(128) NULL,
    actual_completion_time VARCHAR(64) NULL,
    task_taken_time VARCHAR(128) NULL,
    remaining_time VARCHAR(128) NULL,
    over_time VARCHAR(128) NULL,
    total_team_progress INT NULL,
    point_added TINYINT(1) NOT NULL DEFAULT 0,
    engineer_approved TINYINT(1) NOT NULL DEFAULT 0,
    recommended_by VARCHAR(128) NULL,
    recommended_by_name VARCHAR(255) NULL,
    recommended_role VARCHAR(64) NULL,
    recommended_at VARCHAR(64) NULL,
    recommended_points DECIMAL(10,2) NULL,
    supervisor_approved TINYINT(1) NOT NULL DEFAULT 0,
    supervisor_approved_by VARCHAR(128) NULL,
    responsible_officer_id VARCHAR(128) NULL,
    concern_engineer_id VARCHAR(128) NULL,
    model_manager_id VARCHAR(128) NULL,
    in_charge_id VARCHAR(128) NULL,
    dhod_id VARCHAR(128) NULL,
    hod_id VARCHAR(128) NULL,
    total_hold_minutes DECIMAL(10,2) NULL,
    total_hold_ms BIGINT NULL,
    current_hold_start_time VARCHAR(64) NULL,
    timer_status VARCHAR(64) NULL,
    assigned_shift_code VARCHAR(64) NULL,
    original_estimated_duration VARCHAR(128) NULL,
    revised_estimated_duration VARCHAR(128) NULL,
    accumulated_working_minutes DECIMAL(10,2) NULL,
    accumulated_overtime_minutes DECIMAL(10,2) NULL,
    approved_overtime_minutes DECIMAL(10,2) NULL,
    is_time_exceeded TINYINT(1) NOT NULL DEFAULT 0,
    time_exceeded_minutes DECIMAL(10,2) NULL,
    rework_count INT NOT NULL DEFAULT 0,
    supervisor_rating DECIMAL(5,2) NULL,
    assigned_technicians_json LONGTEXT NULL,
    team_approvals_json LONGTEXT NULL,
    hold_history_json LONGTEXT NULL,
    extension_history_json LONGTEXT NULL,
    updated_at VARCHAR(64) NULL,
    raw_json LONGTEXT NOT NULL,
    INDEX idx_tasks_task_id (task_id),
    INDEX idx_tasks_status (status),
    INDEX idx_tasks_created_by (created_by),
    INDEX idx_tasks_assigned_to (assigned_to)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS task_logs (
    id VARCHAR(128) NOT NULL,
    task_id VARCHAR(128) NOT NULL,
    action TEXT NOT NULL,
    user_name VARCHAR(255) NOT NULL,
    timestamp VARCHAR(64) NOT NULL,
    PRIMARY KEY (id, task_id),
    INDEX idx_task_logs_task (task_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS task_comments (
    id VARCHAR(128) PRIMARY KEY,
    task_id VARCHAR(128) NOT NULL,
    user_id VARCHAR(128) NULL,
    employee_id VARCHAR(128) NULL,
    user_name VARCHAR(255) NOT NULL,
    comment TEXT NOT NULL,
    created_at VARCHAR(64) NOT NULL,
    INDEX idx_task_comments_task (task_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS task_attachments (
    id VARCHAR(128) PRIMARY KEY,
    task_id VARCHAR(128) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    original_name VARCHAR(500) NOT NULL,
    mime_type VARCHAR(255) NULL,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    storage_path VARCHAR(500) NOT NULL,
    url VARCHAR(500) NOT NULL,
    uploaded_by VARCHAR(128) NOT NULL,
    uploaded_by_name VARCHAR(255) NULL,
    uploaded_at VARCHAR(64) NOT NULL,
    INDEX idx_task_attachments_task (task_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS attendance_records (
    id VARCHAR(128) PRIMARY KEY,
    technician_id VARCHAR(128) NOT NULL,
    status VARCHAR(64) NOT NULL,
    att_date VARCHAR(32) NOT NULL,
    check_in_time VARCHAR(64) NULL,
    check_out_time VARCHAR(64) NULL,
    shift_code VARCHAR(64) NULL,
    notes TEXT NULL,
    raw_json TEXT NULL,
    INDEX idx_att_date (att_date),
    INDEX idx_att_tech (technician_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS point_transactions (
    id VARCHAR(128) PRIMARY KEY,
    task_id VARCHAR(128) NOT NULL,
    officer_id VARCHAR(128) NULL,
    engineer_id VARCHAR(128) NULL,
    point_value DECIMAL(10,2) NOT NULL DEFAULT 0,
    task_priority VARCHAR(32) NULL,
    completed_at VARCHAR(64) NULL,
    INDEX idx_pt_task (task_id),
    INDEX idx_pt_eng (engineer_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS technician_performance (
    id VARCHAR(128) PRIMARY KEY,
    technician_id VARCHAR(128) NOT NULL,
    task_id VARCHAR(128) NULL,
    perf_date VARCHAR(32) NULL,
    total_work_minutes DECIMAL(10,2) NOT NULL DEFAULT 0,
    remaining_minutes DECIMAL(10,2) NOT NULL DEFAULT 0,
    completion_speed_score DECIMAL(10,2) NOT NULL DEFAULT 0,
    attendance_score DECIMAL(10,2) NOT NULL DEFAULT 0,
    efficiency_score DECIMAL(10,2) NOT NULL DEFAULT 0,
    final_daily_score DECIMAL(10,2) NOT NULL DEFAULT 0,
    INDEX idx_tp_tech (technician_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS assignment_requests (
    id VARCHAR(128) PRIMARY KEY,
    task_id VARCHAR(128) NOT NULL,
    requesting_officer_id VARCHAR(128) NULL,
    target_technician_id VARCHAR(128) NULL,
    supervisor_id VARCHAR(128) NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    reason TEXT NULL,
    created_at VARCHAR(64) NULL,
    approved_at VARCHAR(64) NULL,
    INDEX idx_ar_task (task_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS notifications (
    id VARCHAR(128) PRIMARY KEY,
    user_id VARCHAR(128) NOT NULL,
    sender_id VARCHAR(128) NULL,
    task_id VARCHAR(128) NULL,
    type VARCHAR(64) NULL,
    message TEXT NOT NULL,
    is_read TINYINT(1) NOT NULL DEFAULT 0,
    timestamp VARCHAR(64) NOT NULL,
    INDEX idx_notif_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS activity_logs (
    id VARCHAR(128) PRIMARY KEY,
    user_id VARCHAR(128) NULL,
    employee_id VARCHAR(128) NULL,
    name VARCHAR(255) NULL,
    role VARCHAR(64) NULL,
    login_time VARCHAR(64) NULL,
    logout_time VARCHAR(64) NULL,
    session_duration VARCHAR(64) NULL,
    ip_address VARCHAR(128) NULL,
    local_ip VARCHAR(128) NULL,
    browser VARCHAR(255) NULL,
    os VARCHAR(255) NULL,
    device_type VARCHAR(128) NULL,
    device_name VARCHAR(255) NULL,
    platform VARCHAR(128) NULL,
    location_json TEXT NULL,
    login_status VARCHAR(32) NULL,
    failed_attempt_count INT NULL,
    is_suspicious TINYINT(1) NOT NULL DEFAULT 0,
    suspicious_reason TEXT NULL,
    created_at VARCHAR(64) NULL,
    INDEX idx_act_emp (employee_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id VARCHAR(128) PRIMARY KEY,
    admin_id VARCHAR(128) NULL,
    admin_name VARCHAR(255) NULL,
    action_type VARCHAR(128) NULL,
    target_user VARCHAR(128) NULL,
    target_task VARCHAR(128) NULL,
    ip_address VARCHAR(128) NULL,
    details TEXT NULL,
    timestamp VARCHAR(64) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS user_sessions (
    id VARCHAR(128) PRIMARY KEY,
    user_id VARCHAR(128) NOT NULL,
    employee_id VARCHAR(128) NOT NULL,
    login_time VARCHAR(64) NULL,
    logout_time VARCHAR(64) NULL,
    session_duration VARCHAR(64) NULL,
    ip_address VARCHAR(128) NULL,
    local_ip VARCHAR(128) NULL,
    browser VARCHAR(255) NULL,
    os VARCHAR(255) NULL,
    device_hash VARCHAR(255) NULL,
    device_name VARCHAR(255) NULL,
    platform VARCHAR(128) NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    last_activity VARCHAR(64) NULL,
    INDEX idx_us_emp (employee_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS failed_login_attempts (
    id VARCHAR(128) PRIMARY KEY,
    employee_id VARCHAR(128) NOT NULL,
    ip_address VARCHAR(128) NULL,
    browser VARCHAR(255) NULL,
    os VARCHAR(255) NULL,
    attempt_count INT NOT NULL DEFAULT 0,
    is_locked TINYINT(1) NOT NULL DEFAULT 0,
    lock_until VARCHAR(64) NULL,
    reason TEXT NULL,
    timestamp VARCHAR(64) NULL,
    INDEX idx_fla_emp (employee_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS locked_devices (
    id VARCHAR(128) PRIMARY KEY,
    ip_address VARCHAR(128) NULL,
    device_hash VARCHAR(255) NULL,
    browser VARCHAR(255) NULL,
    os VARCHAR(255) NULL,
    reason TEXT NULL,
    locked_by VARCHAR(128) NULL,
    locked_at VARCHAR(64) NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS shift_configurations (
    id VARCHAR(128) PRIMARY KEY,
    code VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    start_time VARCHAR(16) NOT NULL,
    end_time VARCHAR(16) NOT NULL,
    break_duration_minutes INT NOT NULL DEFAULT 0,
    is_default TINYINT(1) NOT NULL DEFAULT 0,
    color VARCHAR(64) NULL,
    description TEXT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    UNIQUE KEY uq_shift_code (code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS technician_shift_assignments (
    technician_id VARCHAR(128) PRIMARY KEY,
    id VARCHAR(128) NULL,
    default_shift_code VARCHAR(64) NOT NULL,
    weekly_schedule_json TEXT NULL,
    temporary_overrides_json TEXT NULL,
    holidays_json TEXT NULL,
    assigned_by VARCHAR(128) NULL,
    assigned_at VARCHAR(64) NULL,
    notes TEXT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS task_time_sessions (
    id VARCHAR(128) PRIMARY KEY,
    task_id VARCHAR(128) NOT NULL,
    technician_id VARCHAR(128) NOT NULL,
    session_date VARCHAR(32) NOT NULL,
    shift_code VARCHAR(64) NOT NULL,
    start_time VARCHAR(64) NOT NULL,
    end_time VARCHAR(64) NULL,
    duration_minutes DECIMAL(10,2) NOT NULL DEFAULT 0,
    type VARCHAR(32) NOT NULL DEFAULT 'NORMAL',
    status VARCHAR(64) NOT NULL DEFAULT 'ACTIVE',
    notes TEXT NULL,
    INDEX idx_tts_task (task_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS task_time_extensions (
    id VARCHAR(128) PRIMARY KEY,
    task_id VARCHAR(128) NOT NULL,
    previous_estimated_minutes DECIMAL(10,2) NOT NULL DEFAULT 0,
    additional_minutes DECIMAL(10,2) NOT NULL DEFAULT 0,
    new_estimated_minutes DECIMAL(10,2) NOT NULL DEFAULT 0,
    reason TEXT NULL,
    extended_by VARCHAR(255) NULL,
    extended_by_id VARCHAR(128) NULL,
    extended_at VARCHAR(64) NOT NULL,
    INDEX idx_tte_task (task_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS overtime_requests (
    id VARCHAR(128) PRIMARY KEY,
    task_id VARCHAR(128) NOT NULL,
    task_title VARCHAR(500) NULL,
    technician_id VARCHAR(128) NOT NULL,
    technician_name VARCHAR(255) NULL,
    req_date VARCHAR(32) NULL,
    start_time VARCHAR(64) NOT NULL,
    end_time VARCHAR(64) NOT NULL,
    normal_duty_end_time VARCHAR(64) NULL,
    duration_minutes DECIMAL(10,2) NOT NULL DEFAULT 0,
    approved_duration_minutes DECIMAL(10,2) NULL,
    reason TEXT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    requested_by VARCHAR(255) NULL,
    requested_by_id VARCHAR(128) NULL,
    requested_at VARCHAR(64) NULL,
    approved_by VARCHAR(255) NULL,
    approved_by_id VARCHAR(128) NULL,
    approved_at VARCHAR(64) NULL,
    rejected_by VARCHAR(255) NULL,
    rejected_at VARCHAR(64) NULL,
    remarks TEXT NULL,
    INDEX idx_ot_task (task_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS task_timer_audit_logs (
    id VARCHAR(128) PRIMARY KEY,
    task_id VARCHAR(128) NOT NULL,
    technician_id VARCHAR(128) NULL,
    event VARCHAR(64) NOT NULL,
    details TEXT NULL,
    actor VARCHAR(255) NULL,
    actor_id VARCHAR(128) NULL,
    timestamp VARCHAR(64) NOT NULL,
    INDEX idx_ttal_task (task_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS system_settings (
    setting_key VARCHAR(128) PRIMARY KEY,
    setting_value LONGTEXT NOT NULL,
    updated_at VARCHAR(64) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS deleted_tombstones (
    entity_type VARCHAR(64) NOT NULL,
    entity_id VARCHAR(128) NOT NULL,
    deleted_at VARCHAR(64) NOT NULL,
    PRIMARY KEY (entity_type, entity_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  `CREATE TABLE IF NOT EXISTS backup_snapshots (
    id VARCHAR(191) PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    backup_timestamp VARCHAR(64) NOT NULL,
    backup_type VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'SUCCESS',
    total_tasks INT NOT NULL DEFAULT 0,
    total_users INT NOT NULL DEFAULT 0,
    total_attendance INT NOT NULL DEFAULT 0,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    checksum VARCHAR(128) NOT NULL,
    verified TINYINT(1) NOT NULL DEFAULT 1,
    meta_details_json TEXT NULL,
    payload_json LONGTEXT NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
];

export async function ensureMysqlSchema(force = false): Promise<boolean> {
  const cfg = getMysqlConfig();
  if (!cfg.enabled) return false;
  const resolvable = await checkHostResolvable(cfg.host);
  if (!resolvable) return false;

  const p = initMysqlPool();
  if (!p) return false;
  if (schemaInitialized && !force) return true;

  try {
    for (const stmt of SCHEMA_STATEMENTS) {
      await p.query(stmt);
    }
    schemaInitialized = true;
    lastDbError = null;
    console.log('[MYSQL DB] Database schema verified/initialized (all tables ready).');
    return true;
  } catch (err: any) {
    lastDbError = err?.message || String(err);
    const code = err?.code || '';
    if (code === 'ENOTFOUND' || code === 'ECONNREFUSED' || String(lastDbError).includes('ENOTFOUND')) {
      hostUnreachableUntil = Date.now() + 60_000;
      console.warn('[MYSQL DB] MySQL server unreachable right now:', lastDbError);
    } else {
      console.error('[MYSQL DB] Schema initialization error:', lastDbError);
    }
    return false;
  }
}

export async function checkMysqlDbHealth(): Promise<{ ok: boolean; mode: string; message: string; timestamp: string }> {
  const nowIso = new Date().toISOString();
  const cfg = getMysqlConfig();
  if (!cfg.enabled) {
    return {
      ok: true,
      mode: 'LOCAL_DISK_STORAGE',
      message: 'Local filesystem storage active (MySQL runs automatically when MYSQL_HOST is reachable)',
      timestamp: nowIso
    };
  }
  const resolvable = await checkHostResolvable(cfg.host);
  if (!resolvable) {
    return {
      ok: true,
      mode: 'LOCAL_DISK_FALLBACK',
      message: `Local filesystem storage active (Docker MySQL host "${cfg.host}" is inactive outside Docker Compose)`,
      timestamp: nowIso
    };
  }
  const p = initMysqlPool();
  if (!p) {
    return {
      ok: false,
      mode: 'MYSQL_ERROR',
      message: lastDbError || 'MySQL connection pool unavailable',
      timestamp: nowIso
    };
  }
  try {
    await p.query('SELECT 1 AS ping');
    lastDbError = null;
    return {
      ok: true,
      mode: 'MYSQL_LAN',
      message: `Connected to local MySQL (${cfg.host}:${cfg.port}/${cfg.database})`,
      timestamp: nowIso
    };
  } catch (err: any) {
    lastDbError = err?.message || String(err);
    return {
      ok: false,
      mode: 'MYSQL_DISCONNECTED',
      message: lastDbError || 'MySQL ping failed',
      timestamp: nowIso
    };
  }
}

export function getLocalDbStatus() {
  const cfg = getMysqlConfig();
  const active = isMysqlEnabled();
  return {
    storageMode: active ? 'MYSQL_LOCAL_SERVER' : 'LOCAL_FILESYSTEM',
    isMysqlConfigured: active,
    mysqlHost: cfg.enabled ? `${cfg.host}:${cfg.port}` : null,
    mysqlDatabase: cfg.enabled ? cfg.database : null,
    lastError: lastDbError,
    // Keep legacy key false so no Firestore quota banner ever appears in UI
    isQuotaExhausted: false,
    quotaExhaustedUntil: null
  };
}

function hashObj(val: any): string {
  return crypto.createHash('md5').update(JSON.stringify(val ?? null)).digest('hex');
}

function safeJsonParse(raw: any, fallback: any = null) {
  if (raw == null) return fallback;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function slugId(prefix: string, name: string): string {
  return `${prefix}_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 64) || 'default'}`;
}

export async function loadMysqlProductionData(): Promise<any | null> {
  const cfg = getMysqlConfig();
  if (!cfg.enabled) return null;

  const ready = await ensureMysqlSchema();
  if (!ready || !pool) return null;

  try {
    console.log('[MYSQL DB] Fetching authoritative production records from MySQL...');
    const [
      [userRows],
      [taskRows],
      [taskLogRows],
      [taskCommentRows],
      [taskAttRows],
      [tombstoneRows],
      [attRows],
      [ptRows],
      [tpRows],
      [arRows],
      [notifRows],
      [actRows],
      [auditRows],
      [sessRows],
      [flaRows],
      [ldRows],
      [shiftRows],
      [tsaRows],
      [ttsRows],
      [tteRows],
      [otRows],
      [ttalRows],
      [settingRows]
    ] = await Promise.all([
      pool.query<any[]>('SELECT * FROM users'),
      pool.query<any[]>('SELECT * FROM tasks'),
      pool.query<any[]>('SELECT * FROM task_logs ORDER BY timestamp ASC'),
      pool.query<any[]>('SELECT * FROM task_comments ORDER BY created_at ASC'),
      pool.query<any[]>('SELECT * FROM task_attachments ORDER BY uploaded_at ASC'),
      pool.query<any[]>('SELECT * FROM deleted_tombstones'),
      pool.query<any[]>('SELECT * FROM attendance_records'),
      pool.query<any[]>('SELECT * FROM point_transactions'),
      pool.query<any[]>('SELECT * FROM technician_performance'),
      pool.query<any[]>('SELECT * FROM assignment_requests'),
      pool.query<any[]>('SELECT * FROM notifications ORDER BY timestamp ASC'),
      pool.query<any[]>('SELECT * FROM activity_logs ORDER BY created_at ASC'),
      pool.query<any[]>('SELECT * FROM admin_audit_logs ORDER BY timestamp ASC'),
      pool.query<any[]>('SELECT * FROM user_sessions'),
      pool.query<any[]>('SELECT * FROM failed_login_attempts'),
      pool.query<any[]>('SELECT * FROM locked_devices'),
      pool.query<any[]>('SELECT * FROM shift_configurations'),
      pool.query<any[]>('SELECT * FROM technician_shift_assignments'),
      pool.query<any[]>('SELECT * FROM task_time_sessions'),
      pool.query<any[]>('SELECT * FROM task_time_extensions'),
      pool.query<any[]>('SELECT * FROM overtime_requests'),
      pool.query<any[]>('SELECT * FROM task_timer_audit_logs ORDER BY timestamp ASC'),
      pool.query<any[]>('SELECT * FROM system_settings')
    ]);

    const excludedUserIds = new Set(['65683', '45660', 'admin', '42274', 'ADMIN001', '1792817683237pvty5', '1774775811747ugmqy', '17923231674240mbok']);
    const deletedTaskIds = tombstoneRows
      .filter(r => r.entity_type === 'TASK')
      .map(r => String(r.entity_id).trim())
      .filter(Boolean);
    const delSet = new Set(deletedTaskIds);

    const users = userRows
      .map(r => {
        const parsed = safeJsonParse(r.raw_json, {});
        return {
          ...parsed,
          id: r.id,
          employeeId: r.employee_id,
          name: r.name,
          password: r.password_hash ?? parsed.password,
          role: r.role,
          department: r.department ?? parsed.department,
          section: r.section ?? parsed.section,
          designation: r.designation ?? parsed.designation,
          email: r.email ?? parsed.email,
          phone: r.phone ?? parsed.phone,
          supervisorId: r.supervisor_id ?? parsed.supervisorId,
          cboId: r.cbo_id ?? parsed.cboId,
          dcboId: r.dcbo_id ?? parsed.dcboId,
          hodId: r.hod_id ?? parsed.hodId,
          dhodId: r.dhod_id ?? parsed.dhodId,
          supervisor_ids: safeJsonParse(r.supervisor_ids_json, parsed.supervisor_ids),
          assignedEngineers: safeJsonParse(r.assigned_engineers_json, parsed.assignedEngineers),
          avatar: r.avatar ?? parsed.avatar,
          theme: r.theme ?? parsed.theme,
          customBackground: r.custom_background ?? parsed.customBackground,
          status: r.status ?? parsed.status,
          total_point: Number(r.total_point ?? parsed.total_point ?? 0),
          completedTask: Number(r.completed_task ?? parsed.completedTask ?? 0),
          mustChangePassword: Boolean(r.must_change_password)
        };
      })
      .filter(u => !excludedUserIds.has(String(u.employeeId || '').trim()) && !excludedUserIds.has(String(u.id || '').trim()));

    if (users.length === 0) {
      console.log('[MYSQL DB] MySQL users table is currently empty (first boot seed or migration required).');
      return null;
    }

    const logsByTask = new Map<string, any[]>();
    for (const l of taskLogRows) {
      const tid = String(l.task_id);
      if (!logsByTask.has(tid)) logsByTask.set(tid, []);
      logsByTask.get(tid)!.push({ id: l.id, action: l.action, user: l.user_name, timestamp: l.timestamp });
    }

    const commentsByTask = new Map<string, any[]>();
    for (const c of taskCommentRows) {
      const tid = String(c.task_id);
      if (!commentsByTask.has(tid)) commentsByTask.set(tid, []);
      commentsByTask.get(tid)!.push({
        id: c.id,
        taskId: c.task_id,
        userId: c.user_id || undefined,
        employeeId: c.employee_id || '',
        userName: c.user_name,
        comment: c.comment,
        createdAt: c.created_at
      });
    }

    const attByTask = new Map<string, any[]>();
    for (const a of taskAttRows) {
      const tid = String(a.task_id);
      if (!attByTask.has(tid)) attByTask.set(tid, []);
      attByTask.get(tid)!.push({
        id: a.id,
        taskId: a.task_id,
        filename: a.filename,
        originalName: a.original_name,
        mimeType: a.mime_type || 'application/octet-stream',
        sizeBytes: Number(a.size_bytes || 0),
        url: a.url,
        uploadedBy: a.uploaded_by,
        uploadedByName: a.uploaded_by_name || undefined,
        uploadedAt: a.uploaded_at
      });
    }

    const tasks = taskRows
      .map(r => {
        const parsed = safeJsonParse(r.raw_json, {});
        const mergedLogs = logsByTask.get(String(r.id)) || parsed.logs || [];
        const mergedComments = commentsByTask.get(String(r.id)) || parsed.comments || [];
        const mergedAttachments = attByTask.get(String(r.id)) || parsed.attachments || [];
        return {
          ...parsed,
          id: r.id,
          taskId: r.task_id,
          title: r.title,
          model: r.model ?? parsed.model,
          department: r.department ?? parsed.department,
          project: r.project ?? parsed.project,
          details: r.details ?? parsed.details,
          urgency: r.urgency ?? parsed.urgency,
          status: r.status ?? parsed.status,
          progress: Number(r.progress ?? parsed.progress ?? 0),
          logs: mergedLogs,
          comments: mergedComments,
          attachments: mergedAttachments
        };
      })
      .filter(t => {
        const id = String(t.id || '').trim();
        const tid = String(t.taskId || '').trim();
        return (!id || !delSet.has(id)) && (!tid || !delSet.has(tid));
      });

    const settingsMap = new Map<string, any>();
    for (const s of settingRows) {
      settingsMap.set(s.setting_key, safeJsonParse(s.setting_value, s.setting_value));
    }

    const attendanceRecords = attRows.map(r => {
      const parsed = safeJsonParse(r.raw_json, {});
      return {
        ...parsed,
        id: r.id,
        technicianId: r.technician_id,
        status: r.status,
        date: r.att_date,
        checkInTime: r.check_in_time ?? parsed.checkInTime,
        checkOutTime: r.check_out_time ?? parsed.checkOutTime,
        shiftCode: r.shift_code ?? parsed.shiftCode,
        notes: r.notes ?? parsed.notes
      };
    });

    const pointTransactions = ptRows.map(r => ({
      id: r.id,
      taskId: r.task_id,
      officerId: r.officer_id,
      engineerId: r.engineer_id,
      pointValue: Number(r.point_value),
      taskPriority: r.task_priority,
      completedAt: r.completed_at
    }));

    const technicianPerformance = tpRows.map(r => ({
      id: r.id,
      technicianId: r.technician_id,
      taskId: r.task_id,
      date: r.perf_date,
      totalWorkMinutes: Number(r.total_work_minutes),
      remainingMinutes: Number(r.remaining_minutes),
      completionSpeedScore: Number(r.completion_speed_score),
      attendanceScore: Number(r.attendance_score),
      efficiencyScore: Number(r.efficiency_score),
      finalDailyScore: Number(r.final_daily_score)
    }));

    const assignmentRequests = arRows.map(r => ({
      id: r.id,
      taskId: r.task_id,
      requestingOfficerId: r.requesting_officer_id,
      targetTechnicianId: r.target_technician_id,
      supervisorId: r.supervisor_id,
      status: r.status,
      reason: r.reason || undefined,
      createdAt: r.created_at,
      approvedAt: r.approved_at || undefined
    }));

    const notifications = notifRows.map(r => ({
      id: r.id,
      userId: r.user_id,
      senderId: r.sender_id || undefined,
      taskId: r.task_id || undefined,
      type: r.type || undefined,
      message: r.message,
      read: Boolean(r.is_read),
      timestamp: r.timestamp
    }));

    const activityLogs = actRows.map(r => ({
      id: r.id,
      userId: r.user_id,
      employeeId: r.employee_id,
      name: r.name,
      role: r.role,
      loginTime: r.login_time,
      logoutTime: r.logout_time || undefined,
      sessionDuration: r.session_duration || undefined,
      ipAddress: r.ip_address,
      localIp: r.local_ip || undefined,
      browser: r.browser,
      os: r.os,
      deviceType: r.device_type,
      deviceName: r.device_name || undefined,
      platform: r.platform || undefined,
      location: safeJsonParse(r.location_json, undefined),
      loginStatus: r.login_status,
      failedAttemptCount: r.failed_attempt_count ?? undefined,
      isSuspicious: Boolean(r.is_suspicious),
      suspiciousReason: r.suspicious_reason || undefined,
      createdAt: r.created_at
    }));

    const adminAuditLogs = auditRows.map(r => ({
      id: r.id,
      adminId: r.admin_id,
      adminName: r.admin_name,
      actionType: r.action_type,
      targetUser: r.target_user || undefined,
      targetTask: r.target_task || undefined,
      ipAddress: r.ip_address,
      details: r.details,
      timestamp: r.timestamp
    }));

    const userSessions = sessRows.map(r => ({
      id: r.id,
      userId: r.user_id,
      employeeId: r.employee_id,
      loginTime: r.login_time,
      logoutTime: r.logout_time || undefined,
      sessionDuration: r.session_duration || undefined,
      ipAddress: r.ip_address,
      localIp: r.local_ip || undefined,
      browser: r.browser,
      os: r.os,
      deviceHash: r.device_hash,
      deviceName: r.device_name || undefined,
      platform: r.platform || undefined,
      active: Boolean(r.active),
      lastActivity: r.last_activity
    }));

    const failedLoginAttempts = flaRows.map(r => ({
      id: r.id,
      employeeId: r.employee_id,
      ipAddress: r.ip_address,
      browser: r.browser,
      os: r.os,
      attemptCount: Number(r.attempt_count),
      isLocked: Boolean(r.is_locked),
      lockUntil: r.lock_until || undefined,
      reason: r.reason || undefined,
      timestamp: r.timestamp
    }));

    const lockedDevices = ldRows.map(r => ({
      id: r.id,
      ipAddress: r.ip_address || undefined,
      deviceHash: r.device_hash || undefined,
      browser: r.browser || undefined,
      os: r.os || undefined,
      reason: r.reason,
      lockedBy: r.locked_by,
      lockedAt: r.locked_at
    }));

    const shiftConfigurations = shiftRows.length > 0
      ? shiftRows.map(r => ({
          id: r.id,
          code: r.code,
          name: r.name,
          startTime: r.start_time,
          endTime: r.end_time,
          breakDurationMinutes: Number(r.break_duration_minutes || 0),
          isDefault: Boolean(r.is_default),
          color: r.color || undefined,
          description: r.description || undefined,
          isActive: Boolean(r.is_active)
        }))
      : null;

    const technicianShiftAssignments = tsaRows.map(r => ({
      id: r.id || undefined,
      technicianId: r.technician_id,
      defaultShiftCode: r.default_shift_code,
      weeklySchedule: safeJsonParse(r.weekly_schedule_json, undefined),
      temporaryOverrides: safeJsonParse(r.temporary_overrides_json, undefined),
      holidays: safeJsonParse(r.holidays_json, undefined),
      assignedBy: r.assigned_by || undefined,
      assignedAt: r.assigned_at || undefined,
      notes: r.notes || undefined
    }));

    const taskTimeSessions = ttsRows.map(r => ({
      id: r.id,
      taskId: r.task_id,
      technicianId: r.technician_id,
      date: r.session_date,
      shiftCode: r.shift_code,
      startTime: r.start_time,
      endTime: r.end_time || undefined,
      durationMinutes: Number(r.duration_minutes || 0),
      type: r.type,
      status: r.status,
      notes: r.notes || undefined
    }));

    const taskTimeExtensions = tteRows.map(r => ({
      id: r.id,
      taskId: r.task_id,
      previousEstimatedMinutes: Number(r.previous_estimated_minutes || 0),
      additionalMinutes: Number(r.additional_minutes || 0),
      newEstimatedMinutes: Number(r.new_estimated_minutes || 0),
      reason: r.reason,
      extendedBy: r.extended_by,
      extendedById: r.extended_by_id || undefined,
      extendedAt: r.extended_at
    }));

    const overtimeRequests = otRows.map(r => ({
      id: r.id,
      taskId: r.task_id,
      taskTitle: r.task_title || undefined,
      technicianId: r.technician_id,
      technicianName: r.technician_name || undefined,
      date: r.req_date,
      startTime: r.start_time,
      endTime: r.end_time,
      normalDutyEndTime: r.normal_duty_end_time || undefined,
      durationMinutes: Number(r.duration_minutes || 0),
      approvedDurationMinutes: r.approved_duration_minutes != null ? Number(r.approved_duration_minutes) : undefined,
      reason: r.reason,
      status: r.status,
      requestedBy: r.requested_by || undefined,
      requestedById: r.requested_by_id || undefined,
      requestedAt: r.requested_at || undefined,
      approvedBy: r.approved_by || undefined,
      approvedById: r.approved_by_id || undefined,
      approvedAt: r.approved_at || undefined,
      rejectedBy: r.rejected_by || undefined,
      rejectedAt: r.rejected_at || undefined,
      remarks: r.remarks || undefined
    }));

    const taskTimerAuditLogs = ttalRows.map(r => ({
      id: r.id,
      taskId: r.task_id,
      technicianId: r.technician_id || undefined,
      event: r.event,
      details: r.details,
      actor: r.actor || undefined,
      actorId: r.actor_id || undefined,
      timestamp: r.timestamp
    }));

    // Warm delta cache
    users.forEach(u => userWriteCache.set(String(u.employeeId || u.id), hashObj(u)));
    tasks.forEach(t => taskWriteCache.set(String(t.id || t.taskId), hashObj(t)));

    console.log(`[MYSQL DB] Loaded ${users.length} users and ${tasks.length} tasks from MySQL.`);
    return {
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
      taskTimeSessions,
      taskTimeExtensions,
      overtimeRequests,
      taskTimerAuditLogs,
      performanceConfig: settingsMap.get('performance_config') || null,
      autoBackupSettings: settingsMap.get('auto_backup_settings') || { enabled: true, intervalMinutes: 5, retentionCount: 5000 },
      lastSavedAt: settingsMap.get('last_saved_at') || new Date().toISOString(),
      source: 'MYSQL_LOCAL'
    };
  } catch (err: any) {
    lastDbError = err?.message || String(err);
    console.error('[MYSQL DB] Error loading production data:', lastDbError);
    return null;
  }
}

async function upsertUserRow(conn: mysql.PoolConnection | mysql.Pool, u: any) {
  const empId = String(u.employeeId || u.id || '').trim();
  const id = String(u.id || empId).trim();
  if (!empId || !id) return;
  const nowIso = new Date().toISOString();
  await conn.query(
    `INSERT INTO users (
      id, employee_id, name, password_hash, role, department, section, designation,
      email, phone, supervisor_id, cbo_id, dcbo_id, hod_id, dhod_id,
      supervisor_ids_json, assigned_engineers_json, avatar, theme, custom_background,
      status, total_point, completed_task, must_change_password, updated_at, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      id=VALUES(id), name=VALUES(name), password_hash=VALUES(password_hash), role=VALUES(role),
      department=VALUES(department), section=VALUES(section), designation=VALUES(designation),
      email=VALUES(email), phone=VALUES(phone), supervisor_id=VALUES(supervisor_id),
      cbo_id=VALUES(cbo_id), dcbo_id=VALUES(dcbo_id), hod_id=VALUES(hod_id), dhod_id=VALUES(dhod_id),
      supervisor_ids_json=VALUES(supervisor_ids_json), assigned_engineers_json=VALUES(assigned_engineers_json),
      avatar=VALUES(avatar), theme=VALUES(theme), custom_background=VALUES(custom_background),
      status=VALUES(status), total_point=VALUES(total_point), completed_task=VALUES(completed_task),
      must_change_password=VALUES(must_change_password), updated_at=VALUES(updated_at), raw_json=VALUES(raw_json)`,
    [
      id,
      empId,
      String(u.name || empId),
      u.password || null,
      String(u.role || 'TECHNICIAN'),
      u.department || null,
      u.section || null,
      u.designation || null,
      u.email || null,
      u.phone || null,
      u.supervisorId || null,
      u.cboId || null,
      u.dcboId || null,
      u.hodId || null,
      u.dhodId || null,
      u.supervisor_ids ? JSON.stringify(u.supervisor_ids) : null,
      u.assignedEngineers ? JSON.stringify(u.assignedEngineers) : null,
      u.avatar || null,
      u.theme || null,
      u.customBackground || null,
      String(u.status || 'FREE'),
      Number(u.total_point || 0),
      Number(u.completedTask || 0),
      u.mustChangePassword ? 1 : 0,
      nowIso,
      JSON.stringify(u)
    ]
  );

  if (u.department && String(u.department).trim()) {
    const deptName = String(u.department).trim();
    await conn.query(
      `INSERT IGNORE INTO departments (id, name, code, created_at) VALUES (?, ?, ?, ?)`,
      [slugId('dept', deptName), deptName, deptName.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 32), nowIso]
    );
  }
}

async function upsertTaskRow(conn: mysql.PoolConnection | mysql.Pool, t: any) {
  const id = String(t.id || t.taskId || '').trim();
  const taskId = String(t.taskId || t.id || '').trim();
  if (!id) return;
  const nowIso = new Date().toISOString();

  await conn.query(
    `INSERT INTO tasks (
      id, task_id, title, model, department, project, details, urgency,
      created_by, assigned_by, assigned_to, work_type, status, progress,
      points, quality, deadline, engineer_deadline, remarks, created_at,
      started_at, completed_at, request_status, request_remarks, approved_by,
      custom_start_time, estimated_duration, actual_completion_time, task_taken_time,
      remaining_time, over_time, total_team_progress, point_added, engineer_approved,
      recommended_by, recommended_by_name, recommended_role, recommended_at, recommended_points,
      supervisor_approved, supervisor_approved_by, responsible_officer_id, concern_engineer_id,
      model_manager_id, in_charge_id, dhod_id, hod_id, total_hold_minutes, total_hold_ms,
      current_hold_start_time, timer_status, assigned_shift_code, original_estimated_duration,
      revised_estimated_duration, accumulated_working_minutes, accumulated_overtime_minutes,
      approved_overtime_minutes, is_time_exceeded, time_exceeded_minutes, rework_count,
      supervisor_rating, assigned_technicians_json, team_approvals_json, hold_history_json,
      extension_history_json, updated_at, raw_json
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    ) ON DUPLICATE KEY UPDATE
      task_id=VALUES(task_id), title=VALUES(title), model=VALUES(model), department=VALUES(department),
      project=VALUES(project), details=VALUES(details), urgency=VALUES(urgency), created_by=VALUES(created_by),
      assigned_by=VALUES(assigned_by), assigned_to=VALUES(assigned_to), work_type=VALUES(work_type),
      status=VALUES(status), progress=VALUES(progress), points=VALUES(points), quality=VALUES(quality),
      deadline=VALUES(deadline), engineer_deadline=VALUES(engineer_deadline), remarks=VALUES(remarks),
      created_at=VALUES(created_at), started_at=VALUES(started_at), completed_at=VALUES(completed_at),
      request_status=VALUES(request_status), request_remarks=VALUES(request_remarks), approved_by=VALUES(approved_by),
      custom_start_time=VALUES(custom_start_time), estimated_duration=VALUES(estimated_duration),
      actual_completion_time=VALUES(actual_completion_time), task_taken_time=VALUES(task_taken_time),
      remaining_time=VALUES(remaining_time), over_time=VALUES(over_time), total_team_progress=VALUES(total_team_progress),
      point_added=VALUES(point_added), engineer_approved=VALUES(engineer_approved), recommended_by=VALUES(recommended_by),
      recommended_by_name=VALUES(recommended_by_name), recommended_role=VALUES(recommended_role),
      recommended_at=VALUES(recommended_at), recommended_points=VALUES(recommended_points),
      supervisor_approved=VALUES(supervisor_approved), supervisor_approved_by=VALUES(supervisor_approved_by),
      responsible_officer_id=VALUES(responsible_officer_id), concern_engineer_id=VALUES(concern_engineer_id),
      model_manager_id=VALUES(model_manager_id), in_charge_id=VALUES(in_charge_id), dhod_id=VALUES(dhod_id),
      hod_id=VALUES(hod_id), total_hold_minutes=VALUES(total_hold_minutes), total_hold_ms=VALUES(total_hold_ms),
      current_hold_start_time=VALUES(current_hold_start_time), timer_status=VALUES(timer_status),
      assigned_shift_code=VALUES(assigned_shift_code), original_estimated_duration=VALUES(original_estimated_duration),
      revised_estimated_duration=VALUES(revised_estimated_duration), accumulated_working_minutes=VALUES(accumulated_working_minutes),
      accumulated_overtime_minutes=VALUES(accumulated_overtime_minutes), approved_overtime_minutes=VALUES(approved_overtime_minutes),
      is_time_exceeded=VALUES(is_time_exceeded), time_exceeded_minutes=VALUES(time_exceeded_minutes),
      rework_count=VALUES(rework_count), supervisor_rating=VALUES(supervisor_rating),
      assigned_technicians_json=VALUES(assigned_technicians_json), team_approvals_json=VALUES(team_approvals_json),
      hold_history_json=VALUES(hold_history_json), extension_history_json=VALUES(extension_history_json),
      updated_at=VALUES(updated_at), raw_json=VALUES(raw_json)`,
    [
      id,
      taskId,
      String(t.title || 'Untitled Task').slice(0, 500),
      t.model || null,
      t.department || null,
      t.project || t.model || null,
      t.details || null,
      String(t.urgency || 'REGULAR'),
      t.createdBy || null,
      t.assignedBy || null,
      t.assignedTo || null,
      t.workType || null,
      String(t.status || 'PENDING'),
      Number(t.progress || 0),
      t.points != null ? Number(t.points) : null,
      t.quality != null ? Number(t.quality) : null,
      t.deadline || null,
      t.engineer_deadline || null,
      t.remarks || null,
      t.createdAt || null,
      t.startedAt || null,
      t.completedAt || null,
      t.requestStatus || null,
      t.requestRemarks || null,
      t.approvedBy || null,
      t.customStartTime || null,
      t.estimatedDuration || null,
      t.actualCompletionTime || null,
      t.taskTakenTime || null,
      t.remainingTime || null,
      t.overTime || null,
      t.totalTeamProgress != null ? Number(t.totalTeamProgress) : null,
      t.pointAdded ? 1 : 0,
      t.engineerApproved ? 1 : 0,
      t.recommendedBy || null,
      t.recommendedByName || null,
      t.recommendedRole || null,
      t.recommendedAt || null,
      t.recommendedPoints != null ? Number(t.recommendedPoints) : null,
      t.supervisorApproved ? 1 : 0,
      t.supervisorApprovedBy || null,
      t.responsibleOfficerId || null,
      t.concernEngineerId || null,
      t.modelManagerId || null,
      t.inChargeId || null,
      t.dhodId || null,
      t.hodId || null,
      t.totalHoldMinutes != null ? Number(t.totalHoldMinutes) : null,
      t.totalHoldMs != null ? Number(t.totalHoldMs) : null,
      t.currentHoldStartTime || null,
      t.timerStatus || null,
      t.assignedShiftCode || null,
      t.originalEstimatedDuration || null,
      t.revisedEstimatedDuration || null,
      t.accumulatedWorkingMinutes != null ? Number(t.accumulatedWorkingMinutes) : null,
      t.accumulatedOvertimeMinutes != null ? Number(t.accumulatedOvertimeMinutes) : null,
      t.approvedOvertimeMinutes != null ? Number(t.approvedOvertimeMinutes) : null,
      t.isTimeExceeded ? 1 : 0,
      t.timeExceededMinutes != null ? Number(t.timeExceededMinutes) : null,
      Number(t.reworkCount || 0),
      t.supervisorRating != null ? Number(t.supervisorRating) : null,
      t.assignedTechnicians ? JSON.stringify(t.assignedTechnicians) : null,
      t.teamApprovals ? JSON.stringify(t.teamApprovals) : null,
      t.holdHistory ? JSON.stringify(t.holdHistory) : null,
      t.extensionHistory ? JSON.stringify(t.extensionHistory) : null,
      nowIso,
      JSON.stringify(t)
    ]
  );

  // Sync task_logs
  if (Array.isArray(t.logs) && t.logs.length > 0) {
    for (let i = 0; i < t.logs.length; i++) {
      const log = t.logs[i];
      if (!log) continue;
      const logId = String(log.id || `log_${i}_${Date.now()}`);
      await conn.query(
        `INSERT INTO task_logs (id, task_id, action, user_name, timestamp)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE action=VALUES(action), user_name=VALUES(user_name), timestamp=VALUES(timestamp)`,
        [logId, id, String(log.action || ''), String(log.user || 'System'), String(log.timestamp || nowIso)]
      );
    }
  }

  // Sync task_comments
  if (Array.isArray(t.comments) && t.comments.length > 0) {
    for (const c of t.comments) {
      if (!c || !c.id) continue;
      await conn.query(
        `INSERT INTO task_comments (id, task_id, user_id, employee_id, user_name, comment, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE comment=VALUES(comment)`,
        [String(c.id), id, c.userId || null, c.employeeId || null, String(c.userName || 'User'), String(c.comment || ''), String(c.createdAt || nowIso)]
      );
    }
  }

  // Sync task_attachments
  if (Array.isArray(t.attachments) && t.attachments.length > 0) {
    for (const a of t.attachments) {
      if (!a || !a.id) continue;
      await conn.query(
        `INSERT INTO task_attachments (id, task_id, filename, original_name, mime_type, size_bytes, storage_path, url, uploaded_by, uploaded_by_name, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE original_name=VALUES(original_name), url=VALUES(url)`,
        [
          String(a.id),
          id,
          String(a.filename || a.originalName || 'file'),
          String(a.originalName || a.filename || 'file'),
          a.mimeType || 'application/octet-stream',
          Number(a.sizeBytes || 0),
          a.url || `/uploads/attachments/${a.filename}`,
          a.url || `/uploads/attachments/${a.filename}`,
          String(a.uploadedBy || ''),
          a.uploadedByName || null,
          String(a.uploadedAt || nowIso)
        ]
      );
    }
  }

  // Track project / model
  const projName = String(t.project || t.model || '').trim();
  if (projName) {
    await conn.query(
      `INSERT IGNORE INTO projects (id, name, department_name, status, created_at) VALUES (?, ?, ?, 'ACTIVE', ?)`,
      [slugId('proj', projName), projName, t.department || 'RAC R&I', nowIso]
    );
  }
}

export async function saveMysqlProductionData(payload: {
  users: any[];
  tasks: any[];
  deletedTaskIds: string[];
  deletedUserIds?: string[];
  attendanceRecords: any[];
  pointTransactions?: any[];
  technicianPerformance?: any[];
  assignmentRequests?: any[];
  notifications?: any[];
  activityLogs?: any[];
  adminAuditLogs?: any[];
  userSessions?: any[];
  failedLoginAttempts?: any[];
  lockedDevices?: any[];
  shiftConfigurations?: any[];
  technicianShiftAssignments?: any[];
  overtimeRequests?: any[];
  taskTimeExtensions?: any[];
  taskTimeSessions?: any[];
  taskTimerAuditLogs?: any[];
  performanceConfig?: any;
  autoBackupSettings?: any;
  lastSavedAt?: string;
}): Promise<boolean> {
  if (!isMysqlEnabled()) return false;
  const ready = await ensureMysqlSchema();
  if (!ready || !pool) return false;

  if (!Array.isArray(payload.users) || payload.users.length === 0) {
    console.error('[MYSQL DB SAFETY REJECTION] Attempted to save empty user list. Aborting MySQL sync.');
    return false;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const nowIso = payload.lastSavedAt || new Date().toISOString();

    // 1. Delta-save users
    let changedUsers = 0;
    for (const u of payload.users) {
      const key = String(u.employeeId || u.id || '').trim();
      if (!key) continue;
      const h = hashObj(u);
      if (userWriteCache.get(key) !== h) {
        await upsertUserRow(conn, u);
        userWriteCache.set(key, h);
        changedUsers++;
      }
    }

    // 2. Delta-save tasks
    let changedTasks = 0;
    for (const t of payload.tasks || []) {
      const key = String(t.id || t.taskId || '').trim();
      if (!key) continue;
      const h = hashObj(t);
      if (taskWriteCache.get(key) !== h) {
        await upsertTaskRow(conn, t);
        taskWriteCache.set(key, h);
        changedTasks++;
      }
    }

    // 3. Enforce deleted tombstones
    if (Array.isArray(payload.deletedTaskIds) && payload.deletedTaskIds.length > 0) {
      for (const delId of payload.deletedTaskIds) {
        const cleanDel = String(delId || '').trim();
        if (!cleanDel) continue;
        await conn.query(`INSERT IGNORE INTO deleted_tombstones (entity_type, entity_id, deleted_at) VALUES ('TASK', ?, ?)`, [cleanDel, nowIso]);
        await conn.query(`DELETE FROM tasks WHERE id = ? OR task_id = ?`, [cleanDel, cleanDel]);
        await conn.query(`DELETE FROM task_logs WHERE task_id = ?`, [cleanDel]);
        await conn.query(`DELETE FROM task_comments WHERE task_id = ?`, [cleanDel]);
        await conn.query(`DELETE FROM task_attachments WHERE task_id = ?`, [cleanDel]);
        taskWriteCache.delete(cleanDel);
      }
    }

    // 4. Sync attendance (delta check on full list hash)
    const attHash = hashObj(payload.attendanceRecords || []);
    if (lastGlobalHashes.att !== attHash) {
      for (const r of payload.attendanceRecords || []) {
        if (!r || !r.id) continue;
        await conn.query(
          `INSERT INTO attendance_records (id, technician_id, status, att_date, check_in_time, check_out_time, shift_code, notes, raw_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE status=VALUES(status), check_in_time=VALUES(check_in_time), check_out_time=VALUES(check_out_time), shift_code=VALUES(shift_code), notes=VALUES(notes), raw_json=VALUES(raw_json)`,
          [String(r.id), String(r.technicianId || ''), String(r.status || 'PRESENT'), String(r.date || ''), r.checkInTime || null, r.checkOutTime || null, r.shiftCode || null, r.notes || null, JSON.stringify(r)]
        );
      }
      lastGlobalHashes.att = attHash;
    }

    // 5. Sync points & performance
    const ptsHash = hashObj([payload.pointTransactions || [], payload.technicianPerformance || []]);
    if (lastGlobalHashes.pts !== ptsHash) {
      for (const pt of payload.pointTransactions || []) {
        if (!pt || !pt.id) continue;
        await conn.query(
          `INSERT INTO point_transactions (id, task_id, officer_id, engineer_id, point_value, task_priority, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE point_value=VALUES(point_value), officer_id=VALUES(officer_id), engineer_id=VALUES(engineer_id)`,
          [String(pt.id), String(pt.taskId || ''), pt.officerId || null, pt.engineerId || null, Number(pt.pointValue || 0), pt.taskPriority || null, pt.completedAt || null]
        );
      }
      for (const tp of payload.technicianPerformance || []) {
        if (!tp || !tp.id) continue;
        await conn.query(
          `INSERT INTO technician_performance (id, technician_id, task_id, perf_date, total_work_minutes, remaining_minutes, completion_speed_score, attendance_score, efficiency_score, final_daily_score)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE total_work_minutes=VALUES(total_work_minutes), final_daily_score=VALUES(final_daily_score)`,
          [String(tp.id), String(tp.technicianId || ''), tp.taskId || null, tp.date || null, Number(tp.totalWorkMinutes || 0), Number(tp.remainingMinutes || 0), Number(tp.completionSpeedScore || 0), Number(tp.attendanceScore || 0), Number(tp.efficiencyScore || 0), Number(tp.finalDailyScore || 0)]
        );
      }
      lastGlobalHashes.pts = ptsHash;
    }

    // 6. Sync notifications & assignment requests
    const notifHash = hashObj([payload.notifications || [], payload.assignmentRequests || []]);
    if (lastGlobalHashes.notif !== notifHash) {
      for (const n of (payload.notifications || []).slice(-500)) {
        if (!n || !n.id) continue;
        await conn.query(
          `INSERT INTO notifications (id, user_id, sender_id, task_id, type, message, is_read, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE is_read=VALUES(is_read), message=VALUES(message)`,
          [String(n.id), String(n.userId || ''), n.senderId || null, n.taskId || null, n.type || null, String(n.message || ''), n.read ? 1 : 0, String(n.timestamp || nowIso)]
        );
      }
      for (const ar of payload.assignmentRequests || []) {
        if (!ar || !ar.id) continue;
        await conn.query(
          `INSERT INTO assignment_requests (id, task_id, requesting_officer_id, target_technician_id, supervisor_id, status, reason, created_at, approved_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE status=VALUES(status), approved_at=VALUES(approved_at)`,
          [String(ar.id), String(ar.taskId || ''), ar.requestingOfficerId || null, ar.targetTechnicianId || null, ar.supervisorId || null, String(ar.status || 'PENDING'), ar.reason || null, ar.createdAt || null, ar.approvedAt || null]
        );
      }
      lastGlobalHashes.notif = notifHash;
    }

    // 7. Sync security & audit tables
    const secHash = hashObj([payload.activityLogs || [], payload.adminAuditLogs || [], payload.userSessions || [], payload.failedLoginAttempts || [], payload.lockedDevices || []]);
    if (lastGlobalHashes.sec !== secHash) {
      for (const a of (payload.activityLogs || []).slice(-300)) {
        if (!a || !a.id) continue;
        await conn.query(
          `INSERT INTO activity_logs (id, user_id, employee_id, name, role, login_time, logout_time, session_duration, ip_address, local_ip, browser, os, device_type, device_name, platform, location_json, login_status, failed_attempt_count, is_suspicious, suspicious_reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE logout_time=VALUES(logout_time), session_duration=VALUES(session_duration)`,
          [String(a.id), a.userId || null, a.employeeId || null, a.name || null, a.role || null, a.loginTime || null, a.logoutTime || null, a.sessionDuration || null, a.ipAddress || null, a.localIp || null, a.browser || null, a.os || null, a.deviceType || null, a.deviceName || null, a.platform || null, a.location ? JSON.stringify(a.location) : null, a.loginStatus || null, a.failedAttemptCount ?? null, a.isSuspicious ? 1 : 0, a.suspiciousReason || null, a.createdAt || null]
        );
      }
      for (const l of (payload.adminAuditLogs || []).slice(-300)) {
        if (!l || !l.id) continue;
        await conn.query(
          `INSERT IGNORE INTO admin_audit_logs (id, admin_id, admin_name, action_type, target_user, target_task, ip_address, details, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [String(l.id), l.adminId || null, l.adminName || null, l.actionType || null, l.targetUser || null, l.targetTask || null, l.ipAddress || null, l.details || null, String(l.timestamp || nowIso)]
        );
      }
      await conn.query('DELETE FROM user_sessions');
      for (const s of payload.userSessions || []) {
        if (!s || !s.id) continue;
        await conn.query(
          `INSERT INTO user_sessions (id, user_id, employee_id, login_time, logout_time, session_duration, ip_address, local_ip, browser, os, device_hash, device_name, platform, active, last_activity)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [String(s.id), String(s.userId || ''), String(s.employeeId || ''), s.loginTime || null, s.logoutTime || null, s.sessionDuration || null, s.ipAddress || null, s.localIp || null, s.browser || null, s.os || null, s.deviceHash || null, s.deviceName || null, s.platform || null, s.active ? 1 : 0, s.lastActivity || null]
        );
      }
      await conn.query('DELETE FROM failed_login_attempts');
      for (const f of payload.failedLoginAttempts || []) {
        if (!f || !f.id) continue;
        await conn.query(
          `INSERT INTO failed_login_attempts (id, employee_id, ip_address, browser, os, attempt_count, is_locked, lock_until, reason, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [String(f.id), String(f.employeeId || ''), f.ipAddress || null, f.browser || null, f.os || null, Number(f.attemptCount || 0), f.isLocked ? 1 : 0, f.lockUntil || null, f.reason || null, f.timestamp || null]
        );
      }
      await conn.query('DELETE FROM locked_devices');
      for (const d of payload.lockedDevices || []) {
        if (!d || !d.id) continue;
        await conn.query(
          `INSERT INTO locked_devices (id, ip_address, device_hash, browser, os, reason, locked_by, locked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [String(d.id), d.ipAddress || null, d.deviceHash || null, d.browser || null, d.os || null, d.reason || null, d.lockedBy || null, d.lockedAt || null]
        );
      }
      lastGlobalHashes.sec = secHash;
    }

    // 8. Sync shifts, assignments, sessions, extensions, overtime, timer logs
    const shiftHash = hashObj([
      payload.shiftConfigurations || [],
      payload.technicianShiftAssignments || [],
      payload.taskTimeSessions || [],
      payload.taskTimeExtensions || [],
      payload.overtimeRequests || [],
      payload.taskTimerAuditLogs || []
    ]);
    if (lastGlobalHashes.shifts !== shiftHash) {
      for (const sc of payload.shiftConfigurations || []) {
        if (!sc || !sc.id) continue;
        await conn.query(
          `INSERT INTO shift_configurations (id, code, name, start_time, end_time, break_duration_minutes, is_default, color, description, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE code=VALUES(code), name=VALUES(name), start_time=VALUES(start_time), end_time=VALUES(end_time), break_duration_minutes=VALUES(break_duration_minutes), is_default=VALUES(is_default), color=VALUES(color), description=VALUES(description), is_active=VALUES(is_active)`,
          [String(sc.id), String(sc.code), String(sc.name), String(sc.startTime), String(sc.endTime), Number(sc.breakDurationMinutes || 0), sc.isDefault ? 1 : 0, sc.color || null, sc.description || null, sc.isActive !== false ? 1 : 0]
        );
      }
      for (const tsa of payload.technicianShiftAssignments || []) {
        if (!tsa || !tsa.technicianId) continue;
        await conn.query(
          `INSERT INTO technician_shift_assignments (technician_id, id, default_shift_code, weekly_schedule_json, temporary_overrides_json, holidays_json, assigned_by, assigned_at, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE default_shift_code=VALUES(default_shift_code), weekly_schedule_json=VALUES(weekly_schedule_json), temporary_overrides_json=VALUES(temporary_overrides_json), holidays_json=VALUES(holidays_json), assigned_by=VALUES(assigned_by), assigned_at=VALUES(assigned_at), notes=VALUES(notes)`,
          [String(tsa.technicianId), tsa.id || null, String(tsa.defaultShiftCode || 'SHIFT_B'), tsa.weeklySchedule ? JSON.stringify(tsa.weeklySchedule) : null, tsa.temporaryOverrides ? JSON.stringify(tsa.temporaryOverrides) : null, tsa.holidays ? JSON.stringify(tsa.holidays) : null, tsa.assignedBy || null, tsa.assignedAt || null, tsa.notes || null]
        );
      }
      for (const tts of (payload.taskTimeSessions || []).slice(-500)) {
        if (!tts || !tts.id) continue;
        await conn.query(
          `INSERT INTO task_time_sessions (id, task_id, technician_id, session_date, shift_code, start_time, end_time, duration_minutes, type, status, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE end_time=VALUES(end_time), duration_minutes=VALUES(duration_minutes), status=VALUES(status), notes=VALUES(notes)`,
          [String(tts.id), String(tts.taskId || ''), String(tts.technicianId || ''), String(tts.date || ''), String(tts.shiftCode || ''), String(tts.startTime || ''), tts.endTime || null, Number(tts.durationMinutes || 0), String(tts.type || 'NORMAL'), String(tts.status || 'ACTIVE'), tts.notes || null]
        );
      }
      for (const tte of (payload.taskTimeExtensions || []).slice(-500)) {
        if (!tte || !tte.id) continue;
        await conn.query(
          `INSERT IGNORE INTO task_time_extensions (id, task_id, previous_estimated_minutes, additional_minutes, new_estimated_minutes, reason, extended_by, extended_by_id, extended_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [String(tte.id), String(tte.taskId || ''), Number(tte.previousEstimatedMinutes || 0), Number(tte.additionalMinutes || 0), Number(tte.newEstimatedMinutes || 0), tte.reason || null, tte.extendedBy || null, tte.extendedById || null, String(tte.extendedAt || nowIso)]
        );
      }
      for (const ot of (payload.overtimeRequests || []).slice(-500)) {
        if (!ot || !ot.id) continue;
        await conn.query(
          `INSERT INTO overtime_requests (id, task_id, task_title, technician_id, technician_name, req_date, start_time, end_time, normal_duty_end_time, duration_minutes, approved_duration_minutes, reason, status, requested_by, requested_by_id, requested_at, approved_by, approved_by_id, approved_at, rejected_by, rejected_at, remarks)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE status=VALUES(status), approved_duration_minutes=VALUES(approved_duration_minutes), approved_by=VALUES(approved_by), approved_by_id=VALUES(approved_by_id), approved_at=VALUES(approved_at), rejected_by=VALUES(rejected_by), rejected_at=VALUES(rejected_at), remarks=VALUES(remarks)`,
          [String(ot.id), String(ot.taskId || ''), ot.taskTitle || null, String(ot.technicianId || ''), ot.technicianName || null, ot.date || null, String(ot.startTime || ''), String(ot.endTime || ''), ot.normalDutyEndTime || null, Number(ot.durationMinutes || 0), ot.approvedDurationMinutes ?? null, ot.reason || null, String(ot.status || 'PENDING'), ot.requestedBy || null, ot.requestedById || null, ot.requestedAt || null, ot.approvedBy || null, ot.approvedById || null, ot.approvedAt || null, ot.rejectedBy || null, ot.rejectedAt || null, ot.remarks || null]
        );
      }
      for (const ttal of (payload.taskTimerAuditLogs || []).slice(-500)) {
        if (!ttal || !ttal.id) continue;
        await conn.query(
          `INSERT IGNORE INTO task_timer_audit_logs (id, task_id, technician_id, event, details, actor, actor_id, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [String(ttal.id), String(ttal.taskId || ''), ttal.technicianId || null, String(ttal.event || ''), ttal.details || null, ttal.actor || null, ttal.actorId || null, String(ttal.timestamp || nowIso)]
        );
      }
      lastGlobalHashes.shifts = shiftHash;
    }

    // 9. Sync system settings
    const settingsEntries: Array<[string, any]> = [
      ['performance_config', payload.performanceConfig || null],
      ['auto_backup_settings', payload.autoBackupSettings || null],
      ['last_saved_at', nowIso]
    ];
    for (const [k, v] of settingsEntries) {
      if (v !== null && v !== undefined) {
        await conn.query(
          `INSERT INTO system_settings (setting_key, setting_value, updated_at) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value), updated_at=VALUES(updated_at)`,
          [k, JSON.stringify(v), nowIso]
        );
      }
    }

    await conn.commit();
    lastDbError = null;
    if (changedUsers > 0 || changedTasks > 0) {
      console.log(`[MYSQL DB] Delta commit successful (${changedUsers} user(s), ${changedTasks} task(s) updated).`);
    }
    return true;
  } catch (err: any) {
    await conn.rollback().catch(() => {});
    lastDbError = err?.message || String(err);
    console.error('[MYSQL DB] Error saving production data:', lastDbError);
    return false;
  } finally {
    conn.release();
  }
}

export async function saveSingleMysqlTask(task: any): Promise<boolean> {
  if (!isMysqlEnabled()) return false;
  const ready = await ensureMysqlSchema();
  if (!ready || !pool) return false;
  const docId = String(task.id || task.taskId || '').trim();
  if (!docId) return false;

  try {
    const h = hashObj(task);
    if (taskWriteCache.get(docId) === h) return true;
    await upsertTaskRow(pool, task);
    taskWriteCache.set(docId, h);
    return true;
  } catch (err: any) {
    lastDbError = err?.message || String(err);
    console.error(`[MYSQL DB] Error saving single task ${docId}:`, lastDbError);
    return false;
  }
}

export async function deleteMysqlTask(taskId: string): Promise<boolean> {
  if (!isMysqlEnabled()) return false;
  const ready = await ensureMysqlSchema();
  if (!ready || !pool || !taskId) return false;
  try {
    const cleanId = String(taskId).trim();
    await pool.query(`INSERT IGNORE INTO deleted_tombstones (entity_type, entity_id, deleted_at) VALUES ('TASK', ?, ?)`, [cleanId, new Date().toISOString()]);
    await pool.query(`DELETE FROM tasks WHERE id = ? OR task_id = ?`, [cleanId, cleanId]);
    await pool.query(`DELETE FROM task_logs WHERE task_id = ?`, [cleanId]);
    await pool.query(`DELETE FROM task_comments WHERE task_id = ?`, [cleanId]);
    await pool.query(`DELETE FROM task_attachments WHERE task_id = ?`, [cleanId]);
    taskWriteCache.delete(cleanId);
    return true;
  } catch (err: any) {
    lastDbError = err?.message || String(err);
    console.error(`[MYSQL DB] Error deleting task ${taskId}:`, lastDbError);
    return false;
  }
}

export async function saveMysqlBackupSnapshot(
  snapshot: any,
  backupType: '5MIN_AUTO' | 'MANUAL' | 'TASK_ENTRY' | 'TASK_DELETED' | string = '5MIN_AUTO',
  metaDetails?: Record<string, any>
): Promise<PersistentBackupRecord> {
  const now = new Date();
  const timeStr = now.toISOString().replace(/[:.]/g, '-');
  const filename = `db-backup-${backupType.toLowerCase().replace(/_/g, '-')}-${timeStr}.json`;
  const backupId = filename.replace(/\.json$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');

  const jsonStr = JSON.stringify(snapshot);
  const checksum = crypto.createHash('sha256').update(jsonStr).digest('hex');
  const sizeBytes = Buffer.byteLength(jsonStr, 'utf-8');

  const record: PersistentBackupRecord = {
    id: backupId,
    filename,
    timestamp: now.toISOString(),
    type: backupType,
    status: 'SUCCESS',
    totalTasks: Array.isArray(snapshot.tasks) ? snapshot.tasks.length : 0,
    totalUsers: Array.isArray(snapshot.users) ? snapshot.users.length : 0,
    totalAttendance: Array.isArray(snapshot.attendanceRecords) ? snapshot.attendanceRecords.length : 0,
    sizeBytes,
    checksum,
    verified: true,
    metaDetails: metaDetails || {},
    data: snapshot
  };

  if (isMysqlEnabled()) {
    const ready = await ensureMysqlSchema();
    if (ready && pool) {
      try {
        await pool.query(
          `INSERT INTO backup_snapshots (id, filename, backup_timestamp, backup_type, status, total_tasks, total_users, total_attendance, size_bytes, checksum, verified, meta_details_json, payload_json)
           VALUES (?, ?, ?, ?, 'SUCCESS', ?, ?, ?, ?, ?, 1, ?, ?)
           ON DUPLICATE KEY UPDATE payload_json=VALUES(payload_json), verified=1`,
          [
            backupId,
            filename,
            now.toISOString(),
            backupType,
            record.totalTasks,
            record.totalUsers,
            record.totalAttendance,
            sizeBytes,
            checksum,
            JSON.stringify(metaDetails || {}),
            jsonStr
          ]
        );
      } catch (err: any) {
        console.warn('[MYSQL BACKUP] Error saving backup snapshot row:', err?.message || err);
      }
    }
  }

  try {
    const backupsDir = path.join(process.cwd(), 'backups');
    if (!fsSync.existsSync(backupsDir)) fsSync.mkdirSync(backupsDir, { recursive: true });
    await fs.writeFile(path.join(backupsDir, filename), jsonStr, 'utf-8');
    await fs.writeFile(path.join(backupsDir, 'latest-backup.json'), jsonStr, 'utf-8');
  } catch (diskErr: any) {
    console.warn('[LOCAL BACKUP] Local disk backup warning:', diskErr.message);
  }

  return record;
}

export async function getPersistentBackupList(): Promise<PersistentBackupRecord[]> {
  const recordsMap = new Map<string, PersistentBackupRecord>();

  if (isMysqlEnabled() && pool) {
    try {
      const [rows] = await pool.query<any[]>(
        `SELECT id, filename, backup_timestamp, backup_type, status, total_tasks, total_users, total_attendance, size_bytes, checksum, verified, meta_details_json
         FROM backup_snapshots ORDER BY backup_timestamp DESC LIMIT 200`
      );
      for (const r of rows) {
        recordsMap.set(r.filename || r.id, {
          id: r.id,
          filename: r.filename,
          timestamp: r.backup_timestamp,
          type: r.backup_type,
          status: r.status || 'SUCCESS',
          totalTasks: Number(r.total_tasks || 0),
          totalUsers: Number(r.total_users || 0),
          totalAttendance: Number(r.total_attendance || 0),
          sizeBytes: Number(r.size_bytes || 0),
          checksum: r.checksum || '',
          verified: Boolean(r.verified),
          metaDetails: safeJsonParse(r.meta_details_json, {})
        });
      }
    } catch (err: any) {
      console.warn('[MYSQL BACKUP] Error reading backup list:', err?.message || err);
    }
  }

  try {
    const backupsDir = path.join(process.cwd(), 'backups');
    if (fsSync.existsSync(backupsDir)) {
      const files = fsSync.readdirSync(backupsDir).filter(f => f.startsWith('db-backup-') && f.endsWith('.json'));
      for (const f of files) {
        if (!recordsMap.has(f)) {
          const stat = fsSync.statSync(path.join(backupsDir, f));
          let bType = 'HOURLY_AUTO';
          if (f.includes('manual')) bType = 'MANUAL';
          else if (f.includes('task-entry')) bType = 'TASK_ENTRY';
          else if (f.includes('task-delete')) bType = 'TASK_DELETED';
          else if (f.includes('5min')) bType = '5MIN_AUTO';

          recordsMap.set(f, {
            id: f.replace('.json', ''),
            filename: f,
            timestamp: stat.mtime.toISOString(),
            type: bType,
            status: 'SUCCESS',
            totalTasks: 0,
            totalUsers: 0,
            totalAttendance: 0,
            sizeBytes: stat.size,
            checksum: 'LOCAL_FILE',
            verified: true
          });
        }
      }
    }
  } catch (e: any) {
    console.warn('[LOCAL BACKUP] Error reading local disk backup list:', e.message);
  }

  return Array.from(recordsMap.values()).sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

export async function getPersistentBackupData(target: string): Promise<any | null> {
  const safeFilename = path.basename(target.endsWith('.json') ? target : `${target}.json`);
  const docId = target.replace('.json', '').replace(/[^a-zA-Z0-9_-]/g, '_');

  const backupsDir = path.join(process.cwd(), 'backups');
  const localPath = path.join(backupsDir, safeFilename);
  if (fsSync.existsSync(localPath)) {
    try {
      const raw = await fs.readFile(localPath, 'utf-8');
      return JSON.parse(raw);
    } catch {}
  }

  if (isMysqlEnabled() && pool) {
    try {
      const [rows] = await pool.query<any[]>(
        `SELECT payload_json FROM backup_snapshots WHERE filename = ? OR id = ? LIMIT 1`,
        [safeFilename, docId]
      );
      if (rows.length > 0 && rows[0].payload_json) {
        return safeJsonParse(rows[0].payload_json, null);
      }
    } catch (e: any) {
      console.warn('[MYSQL BACKUP] Error retrieving backup data:', e?.message || e);
    }
  }

  return null;
}
