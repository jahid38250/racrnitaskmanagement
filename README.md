# Daily Work Update — Enterprise Task & Workforce Management System (RAC R&I)

A full-stack, LAN-hosted task governance, smart shift time-tracking, workforce attendance, and performance analytics platform engineered for **RAC Research & Innovation (RAC R&I)**.

**Architected & Developed by:** Jahid Hasan (38250) — RAC R&I  
**Deployment Architecture:** Ubuntu Linux · Docker Compose · MySQL 8 · Nginx Reverse Proxy · Node.js 22 + React 19  
**Network Mode:** Office LAN Only (Zero External Cloud / Firebase Runtime Dependencies)

---

## Table of Contents

1. [Complete Feature Suite](#1-complete-feature-suite)
2. [Role Hierarchy & Permissions Matrix](#2-role-hierarchy--permissions-matrix)
3. [System & Network Architecture](#3-system--network-architecture)
4. [One-Click Server Deployment (For Server / IT Team)](#4-one-click-server-deployment-for-server--it-team)
5. [Environment Configuration (`.env`)](#5-environment-configuration-env)
6. [Database Schema & Firestore-to-MySQL Migration](#6-database-schema--firestore-to-mysql-migration)
7. [Operations, Backup & Disaster Recovery](#7-operations-backup--disaster-recovery)
8. [Key API Endpoints Reference](#8-key-api-endpoints-reference)
9. [Project Structure](#9-project-structure)

---

## 1. Complete Feature Suite

### A. Smart Shift Management (`ShiftManagementModal.tsx`, `workingTimeEngine.ts`)
- Configurable duty shifts using consistent **Bangladesh Standard Time (`Asia/Dhaka`)**:
  - **Shift A:** `08:00 AM – 05:00 PM`
  - **Shift B (Default):** `09:00 AM – 06:00 PM`
  - **Shift C:** `02:00 PM – 10:00 PM`
- Individual technician shift assignments, weekly schedules, temporary date-specific overrides, holidays, and weekly off-days.
- Integrated directly with daily check-in/check-out attendance records (`PRESENT`, `ABSENT`, `LEAVE`, `SHORT_LEAVE`, `CHECKED_OUT`, and shift codes).

### B. Attendance-Based Smart Working-Time Engine (`SmartTaskTimer.tsx`, `workingTimeEngine.ts`)
- Replaces continuous wall-clock countdowns with **actual eligible working-hour tracking**:
  $$\text{Actual Working Time} = \sum (\text{Eligible Working Intervals Within Active Duty Shifts}) + \text{Approved Overtime Intervals}$$
- Automatically pauses active task timers at duty shift end or technician checkout, and automatically resumes from the previously accumulated duration when the technician checks in on the next working day.
- Excludes Hold intervals (`totalHoldMinutes`, `holdHistory`) from active working elapsed time.
- Live color-coded visual telemetry: Normal progress, Approaching Target, Time Exceeded alerts, and Audit Trail logging (`task_timer_audit_logs`).

### C. Overtime & Time Extension Governance (`OvertimeModal.tsx`, `TimeExtensionModal.tsx`)
- **Overtime Workflow:** Supervisors/Engineers submit shift-end overtime requests specifying start/end window and technical justification; authorized leadership (`IN_CHARGE`, `HOD`, `DHOD`, `CBO`, `DCBO`, `SUPER_ADMIN`) approve/reject requests with audit logging. Approved overtime intervals are credited cleanly to task working time.
- **Target Time Extensions:** Authorized roles can extend estimated durations with mandatory reason logging while permanently preserving `originalEstimatedDuration`, `revisedEstimatedDuration`, and full `extensionHistory`.

### D. Task Lifecycle, Team Collaboration & Local File Attachments
- Supports **Single Work** (assigned to one technician) and **Team Work** (multi-technician progress sliders with live weighted team progress calculation).
- **Cross-Section Technician Borrowing:** Officers can request technicians supervised by other Officers; In-Charges/Concern Officers approve or reject multi-team approvals cleanly.
- **Officer-to-Engineer Recommendation Workflow:** Completed Officer tasks enter the recommendation queue for quality verification (`1–3` points) and credit to the assigned Concern Engineer.
- **Task File Attachments & Comments:** Local filesystem storage under `uploads/attachments/` (up to 25MB per file / 50MB request via Nginx) tracked in MySQL `task_attachments` and `task_comments`, allowing upload, download, and authorized deletion directly inside the Task Details modal.

### E. 100-Mark Team Performance Dashboard & Executive BI (`TeamPerformanceDashboard.tsx`, `RoleBasedAnalytics.tsx`, `CBODashboard.tsx`, `ExecutiveCommandCenter.tsx`)
- Configurable weighted performance scoring across Time Efficiency, Task Completion, Quality / Rework Penalties, On-Time Completion, and Supervisor Evaluation (`performanceConfig`).
- Dynamic 12-month real-time calendar filtering + custom `From Date` / `To Date` horizon.
- Printable landscape **PDF** reports (`jsPDF`) and **Excel (`.xlsx`)** exports with role-based privacy masking.
- Confidential point governance: Task/Score points are visible exclusively to `CBO`, `DCBO`, `HOD`, `DHOD`, and `SUPER_ADMIN` and sanitized from `OFFICER` and `ENGINEER` views/exports.
- Real-time Server-Sent Events (`/api/events`) pushing instant updates to connected LAN browsers.

### F. Enterprise Security, Session Control & Local Auth
- Local `bcryptjs` password hashing + `jsonwebtoken` (JWT) authentication (no external auth dependency).
- Hardware/browser device fingerprinting, active session tracking (`user_sessions`), failed-login brute-force lockout, instant remote session termination, and IP/device blacklisting (`locked_devices`) managed via the Super Admin Security Center.

---

## 2. Role Hierarchy & Permissions Matrix

| Role | Scope & Operational Authority |
| :--- | :--- |
| **SUPER_ADMIN** | Full system governance, Security Center, device lockout, session termination, permanent staff CRUD, MySQL/JSON backups & restores. |
| **CBO / DCBO** | Organization-wide executive dashboards, KPI intelligence, verified point oversight, cross-department performance audits. |
| **HOD / DHOD** | Department leadership, 6-state daily attendance marking, task approvals, overtime/extension approvals, performance calibration. |
| **IN_CHARGE** | Section workload balancing, cross-section technician borrow approvals, Officer task recommendations. |
| **MODEL_MANAGER** | Product model execution (`18K`, `24K`, `36K`, `Cassette`, `Portable`, etc.), trial/defect tracking. |
| **ENGINEER** | Technical deadlines (`engineer_deadline`), quality inspections, work recommendations, anonymized external reporting. |
| **OFFICER** | Daily task dispatch (Single/Team), technician shift monitoring, cross-team support requests, progress remarks. |
| **TECHNICIAN** | Mobile/desktop `"My Work"` dashboard, `0–100%` progress sliders, hold reason reporting, file attachments, shift status. |

---

## 3. System & Network Architecture

```text
  Office LAN Browsers (http://<SERVER-IP> or http://task.company.local)
           │
           ▼  TCP Port 80 (HTTP_PORT=80, only public LAN port)
  ┌─────────────────────────┐
  │   rac_task_nginx        │  nginx:1.27-alpine
  │   Reverse Proxy + SSE   │  • Proxies / and /api/* -> app:3000
  │   Static /uploads/      │  • Disables proxy_buffering on /api/events
  └───────────┬─────────────┘  • 50MB max upload limit
              │  Docker bridge network (frontend_proxy)
              ▼  Internal Port 3000 (not exposed directly)
  ┌─────────────────────────┐
  │   rac_task_app          │  Node 22 + Express + React 19 SPA
  │   Local Auth + Engine   │  • Mounts ./data, ./uploads, ./backups
  └───────────┬─────────────┘
              │  Docker internal network (backend_internal, internal: true)
              ▼  Internal Port 3306 (NEVER exposed to office LAN)
  ┌─────────────────────────┐
  │   rac_task_mysql        │  mysql:8.0 (utf8mb4_unicode_ci, +06:00 BST)
  │   Database:             │  • Auto-initialized via docker/mysql/init.sql
  │   task_management       │  • Persistent volume: mysql_data
  └─────────────────────────┘
```

- **LAN Security Guarantee:** Port `3306` is bound strictly inside Docker's `backend_internal` network and is never published to host LAN interfaces. Employee workstations cannot connect directly to MySQL.
- **Dual Persistence Safety:** Primary runtime persistence uses MySQL 8 (`task_management`) with local JSON snapshots (`data/db.json`, `data/permanent-staff.json`) and 5-minute automated snapshots (`backups/`) preserved on host disk.

---

## 4. One-Click Server Deployment (For Server / IT Team)

### Server Prerequisites
- **OS:** Ubuntu Linux (20.04 / 22.04 / 24.04 LTS)
- **Installed:** Docker Engine & Docker Compose plugin (`docker compose version`)
- **Network:** Connected to Office LAN (port `80` available)

### Deploy in One Command

```bash
chmod +x install.sh
./install.sh
```

What `install.sh` performs automatically:
1. Checks Docker, Docker Compose, and system utilities (`curl`, `tar`, `gzip`, `openssl`).
2. Verifies project structure (`Dockerfile`, `docker-compose.yml`, `docker/mysql/init.sql`, `docker/nginx/nginx.conf`).
3. Loads `.env` (or generates `.env` with secure random credentials if absent).
4. Builds the production application container (`npm run build` inside Docker).
5. Starts `mysql`, `app`, and `nginx` containers and waits for MySQL and HTTP health checks.
6. Initializes all MySQL tables (`scripts/init-mysql-db.ts`) and automatically imports existing production records (`data/db.json`) on first boot (`78` staff accounts, `58` tasks, `1,484` attendance records, `3` shifts).
7. Updates UFW rules if active (`allow 80/tcp`, `deny 3306/tcp`) and outputs the Office LAN URL.

*(A complete beginner-friendly Bangla deployment manual is also included in [`BANGLA_INSTALLATION_GUIDE.md`](./BANGLA_INSTALLATION_GUIDE.md).)*

---

## 5. Environment Configuration (`.env`)

All deployment variables live in `.env` (gitignored; template in `.env.example`):

| Variable | Value / Purpose |
| :--- | :--- |
| `SERVER_HOST` | `0.0.0.0` (binds LAN proxy; set internal DNS/IP for `APP_URL` if desired) |
| `HTTP_PORT` | `80` (Nginx LAN HTTP port mapped to host) |
| `PORT` | `3000` (Internal Node.js backend port behind Nginx) |
| `APP_URL` | `http://0.0.0.0:80` |
| `TZ` | `Asia/Dhaka` |
| `MYSQL_HOST` | `mysql` (Docker Compose internal MySQL service name) |
| `MYSQL_PORT` | `3306` |
| `MYSQL_DATABASE` | `task_management` |
| `MYSQL_USER` | `taskadmin` |
| `MYSQL_PASSWORD` | Cryptographically generated strong password in `.env` |
| `MYSQL_ROOT_PASSWORD` | Cryptographically generated strong root password in `.env` |
| `JWT_SECRET` | 64-char hex signing key in `.env` |
| `BACKUP_RETENTION_DAYS` | `30` (retention window for `backup.sh` archives) |

---

## 6. Database Schema & Firestore-to-MySQL Migration

### Core MySQL Tables (`task_management`)
- **Organization & Users:** `departments`, `projects`, `users`, `user_sessions`, `failed_login_attempts`, `locked_devices`
- **Tasks & Collaboration:** `tasks`, `task_logs`, `task_comments`, `task_attachments`, `assignment_requests`, `notifications`
- **Time & Shifts:** `shift_configurations`, `technician_shift_assignments`, `attendance_records`, `task_time_sessions`, `task_time_extensions`, `overtime_requests`, `task_timer_audit_logs`
- **Performance & Governance:** `point_transactions`, `technician_performance`, `activity_logs`, `admin_audit_logs`, `system_settings`, `deleted_tombstones`, `backup_snapshots`

### Non-Destructive Migration Commands
Run anytime to sync from Firestore (read-only REST API) and/or local snapshots without touching original Firebase records:

```bash
# Preview migration counts without writing to MySQL
docker compose exec app npx tsx scripts/migrate-firestore-to-mysql.ts --source=auto --dry-run

# Execute idempotent migration into MySQL
docker compose exec app npx tsx scripts/migrate-firestore-to-mysql.ts --source=auto
```

---

## 7. Operations, Backup & Disaster Recovery

| Script | Purpose |
| :--- | :--- |
| `./install.sh` | Complete first-time setup, build, container startup, DB init & data import |
| `./start.sh` | Start all services and verify `/api/system/db-status` health |
| `./stop.sh` | Stop all containers safely without touching persisted volumes |
| `./restart.sh` | Cleanly restart all services (`stop.sh` + `start.sh`) |
| `./status.sh` | Show container states, LAN URLs, live API health, MySQL row counts & latest backup |
| `./backup.sh` | Dump MySQL (`backups/mysql/mysql-task_management-*.sql.gz`), archive `uploads/` & `data/`, verify gzip integrity, prune >30 days |
| `./restore.sh <sql.gz>` | Take safety backup, restore SQL dump + matching `uploads-*.tar.gz`, and restart app |

### Recommended Daily Automated Backup Cron (Ubuntu Host)
```cron
0 2 * * * /path/to/app/backup.sh >> /path/to/app/backups/mysql/cron.log 2>&1
```

---

## 8. Key API Endpoints Reference

| Category | Method & Endpoint | Description |
| :--- | :--- | :--- |
| **Health** | `GET /api/system/db-status` | MySQL / storage health and active mode check |
| **Auth** | `POST /api/auth/login` | Employee ID + password login returning JWT + active shift context |
| **Auth** | `POST /api/auth/logout` | Close session & log session duration |
| **Auth** | `POST /api/auth/change-password` | User self-service password change |
| **Users** | `GET/POST/PUT/DELETE /api/users` | Staff roster management & supervisor mappings |
| **Users** | `POST /api/users/:id/reset-password` | Admin/HOD password reset & unlock |
| **Tasks** | `GET/POST /api/tasks`, `PUT /api/tasks/:id` | Create/list/update tasks with working-time calculation |
| **Tasks** | `POST /api/tasks/:id/recommend`, `/approve`, `/reject` | Recommendation, multi-team borrow approvals & rejections |
| **Files** | `GET/POST/DELETE /api/tasks/:id/attachments` | Upload, list, and delete local task attachments |
| **Comments** | `POST /api/tasks/:id/comments` | Persist task discussion comments |
| **Shifts** | `GET/POST /api/shifts`, `/api/shifts/assign` | Shift definitions (`SHIFT_A`, `SHIFT_B`, `SHIFT_C`) & assignments |
| **Overtime** | `GET/POST /api/overtime`, `/approve`, `/reject` | Overtime request lifecycle |
| **Extensions** | `POST /api/tasks/:id/extend-time` | Target time extension with audit history |
| **Analytics** | `GET /api/performance/dashboard`, `GET /api/departments`, `GET /api/projects` | Team performance scorecard, departments & models/projects |
| **Backups** | `GET /api/system/backup-settings`, `POST /api/system/backup-now`, `POST /api/system/restore-backup` | Automated & manual backup catalog and restore |
| **Security** | `GET /api/security/*`, `POST /api/security/lock-device` | Activity logs, active sessions, failed logins & hardware lockout |
| **Realtime** | `GET /api/events` | Server-Sent Events stream for live dashboard updates |

---

## 9. Project Structure

```text
.
├── install.sh                    # One-click Ubuntu Docker + MySQL installer
├── start.sh / stop.sh / restart.sh / status.sh
├── backup.sh / restore.sh        # Full MySQL + uploads backup & restore
├── docker-compose.yml            # MySQL 8 + Node App + Nginx stack
├── Dockerfile                    # Node 22 Alpine production build
├── .env / .env.example           # Deployment environment variables
├── BANGLA_INSTALLATION_GUIDE.md  # Beginner-friendly Bangla setup manual
├── docker/
│   ├── mysql/
│   │   ├── init.sql              # Full relational MySQL 8 schema & seed data
│   │   └── my.cnf                # UTF8MB4 +06:00 BST InnoDB tuning
│   └── nginx/
│       └── nginx.conf            # LAN HTTP reverse proxy + SSE + /uploads/
├── scripts/
│   ├── init-mysql-db.ts          # Standalone schema initialization CLI
│   ├── migrate-firestore-to-mysql.ts  # Non-destructive Firestore/JSON -> MySQL migrator
│   ├── backup-mysql.sh / restore-mysql.sh
├── server.ts                     # Express backend + SSE + Smart Timer Monitor
├── mysqlDb.ts                    # MySQL 8 connection pool & delta persistence engine
├── workingTimeEngine.ts          # Smart shift & attendance working-hour engine
├── App.tsx                       # React 19 UI + Role Dashboards + Task Details
├── SmartTaskTimer.tsx            # Live attendance-based timer component
├── ShiftManagementModal.tsx      # Shift & schedule configuration UI
├── OvertimeModal.tsx             # Overtime request & approval modal
├── TimeExtensionModal.tsx        # Audited task time extension modal
├── TeamPerformanceDashboard.tsx  # Weighted 100-mark scorecard dashboard
├── RoleBasedAnalytics.tsx        # Charts & Excel/PDF exports
├── AssociateAttendanceManagement.tsx
├── CBODashboard.tsx / ExecutiveCommandCenter.tsx
├── types.ts / utils.ts
├── data/                         # Runtime JSON mirror & permanent-staff baseline
├── uploads/                      # Local attachments & custom theme backgrounds
└── backups/                      # In-app snapshots & MySQL .sql.gz archives
```

---

**Software Development by Jahid Hasan (38250) — RAC R&I**  
Copyright © 2026 Daily Work Update. All rights reserved.
