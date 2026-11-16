-- RAC R&I Task Management System - MySQL 8 Relational Schema
-- UTF-8 (utf8mb4) with Bangladesh Standard Time (+06:00)

CREATE DATABASE IF NOT EXISTS task_management
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE task_management;

CREATE TABLE IF NOT EXISTS departments (
  id VARCHAR(128) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  code VARCHAR(64) NULL,
  description TEXT NULL,
  created_at VARCHAR(64) NULL,
  UNIQUE KEY uq_departments_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR(128) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  department_id VARCHAR(128) NULL,
  department_name VARCHAR(255) NULL,
  description TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  created_at VARCHAR(64) NULL,
  UNIQUE KEY uq_projects_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tasks (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS task_logs (
  id VARCHAR(128) NOT NULL,
  task_id VARCHAR(128) NOT NULL,
  action TEXT NOT NULL,
  user_name VARCHAR(255) NOT NULL,
  timestamp VARCHAR(64) NOT NULL,
  PRIMARY KEY (id, task_id),
  INDEX idx_task_logs_task (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS task_comments (
  id VARCHAR(128) PRIMARY KEY,
  task_id VARCHAR(128) NOT NULL,
  user_id VARCHAR(128) NULL,
  employee_id VARCHAR(128) NULL,
  user_name VARCHAR(255) NOT NULL,
  comment TEXT NOT NULL,
  created_at VARCHAR(64) NOT NULL,
  INDEX idx_task_comments_task (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS task_attachments (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance_records (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS point_transactions (
  id VARCHAR(128) PRIMARY KEY,
  task_id VARCHAR(128) NOT NULL,
  officer_id VARCHAR(128) NULL,
  engineer_id VARCHAR(128) NULL,
  point_value DECIMAL(10,2) NOT NULL DEFAULT 0,
  task_priority VARCHAR(32) NULL,
  completed_at VARCHAR(64) NULL,
  INDEX idx_pt_task (task_id),
  INDEX idx_pt_eng (engineer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS technician_performance (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS assignment_requests (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(128) NOT NULL,
  sender_id VARCHAR(128) NULL,
  task_id VARCHAR(128) NULL,
  type VARCHAR(64) NULL,
  message TEXT NOT NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  timestamp VARCHAR(64) NOT NULL,
  INDEX idx_notif_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activity_logs (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id VARCHAR(128) PRIMARY KEY,
  admin_id VARCHAR(128) NULL,
  admin_name VARCHAR(255) NULL,
  action_type VARCHAR(128) NULL,
  target_user VARCHAR(128) NULL,
  target_task VARCHAR(128) NULL,
  ip_address VARCHAR(128) NULL,
  details TEXT NULL,
  timestamp VARCHAR(64) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_sessions (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS failed_login_attempts (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS locked_devices (
  id VARCHAR(128) PRIMARY KEY,
  ip_address VARCHAR(128) NULL,
  device_hash VARCHAR(255) NULL,
  browser VARCHAR(255) NULL,
  os VARCHAR(255) NULL,
  reason TEXT NULL,
  locked_by VARCHAR(128) NULL,
  locked_at VARCHAR(64) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shift_configurations (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS technician_shift_assignments (
  technician_id VARCHAR(128) PRIMARY KEY,
  id VARCHAR(128) NULL,
  default_shift_code VARCHAR(64) NOT NULL,
  weekly_schedule_json TEXT NULL,
  temporary_overrides_json TEXT NULL,
  holidays_json TEXT NULL,
  assigned_by VARCHAR(128) NULL,
  assigned_at VARCHAR(64) NULL,
  notes TEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS task_time_sessions (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS task_time_extensions (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS overtime_requests (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS task_timer_audit_logs (
  id VARCHAR(128) PRIMARY KEY,
  task_id VARCHAR(128) NOT NULL,
  technician_id VARCHAR(128) NULL,
  event VARCHAR(64) NOT NULL,
  details TEXT NULL,
  actor VARCHAR(255) NULL,
  actor_id VARCHAR(128) NULL,
  timestamp VARCHAR(64) NOT NULL,
  INDEX idx_ttal_task (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_settings (
  setting_key VARCHAR(128) PRIMARY KEY,
  setting_value LONGTEXT NOT NULL,
  updated_at VARCHAR(64) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS deleted_tombstones (
  entity_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(128) NOT NULL,
  deleted_at VARCHAR(64) NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS backup_snapshots (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Default Initial Seed Data
INSERT IGNORE INTO departments (id, name, code, description, created_at)
VALUES ('dept_rac_ri', 'RAC R&I', 'RAC_RI', 'Research & Innovation Department', UTC_TIMESTAMP());

INSERT IGNORE INTO shift_configurations (id, code, name, start_time, end_time, break_duration_minutes, is_default, color, description, is_active) VALUES
  ('shift_a', 'SHIFT_A', 'Shift A (08:00 AM - 05:00 PM)', '08:00', '17:00', 0, 0, '#10b981', 'Morning Technical Duty Shift', 1),
  ('shift_b', 'SHIFT_B', 'Shift B (09:00 AM - 06:00 PM)', '09:00', '18:00', 0, 1, '#3b82f6', 'Default Standard Duty Shift', 1),
  ('shift_c', 'SHIFT_C', 'Shift C (02:00 PM - 10:00 PM)', '14:00', '22:00', 0, 0, '#f59e0b', 'Evening Shift (C)', 1);
