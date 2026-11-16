# Daily Work Update - Hierarchical Enterprise Task Management System

A robust, production-grade, full-stack task governance, workforce monitoring, and operational intelligence platform engineered specifically for structured manufacturing, research, and engineering environments (RAC R&I).

**Architected & Developed by: Jahid Hasan (38250) RAC R&I**  
**Version:** 4.2.0 (Executive Production Release)  
**Permanent Data Persistence, Disaster Recovery & Multi-Tier Role Governance Guaranteed**

---

## 🎯 Executive Presentation Master Blueprint & AI Slide Generator Prompt

> **How to Use This Section**:  
> You can copy and paste the block below directly into any AI Presentation Tool (such as **Gamma App**, **ChatGPT / Gemini (Prompt for Slides)**, **Tome**, **Beautiful.ai**, or **Decktopus**) to generate an executive-ready slide deck in seconds.

```text
Create a modern, executive-grade corporate presentation slide deck (14 slides) for an industrial enterprise system titled:
"Daily Work Update — Hierarchical Task Management & Workforce Intelligence Platform (RAC R&I)"
Developed by: Jahid Hasan (ID: 38250), RAC R&I.
Theme: Deep Charcoal/Dark Slate, Neon Cyan, Emerald Green, and Royal Blue accents. Clean glassmorphic cards, data tables, and high-impact KPI metrics.

Slide Structure:
Slide 1: Title & Executive Summary (Platform Vision, Author: Jahid Hasan 38250, RAC R&I)
Slide 2: Industry Challenge & Operational Need (Eliminating shop-floor bottlenecks, manual attendance gaps, unverified tasks)
Slide 3: High-Level Platform Architecture (Tri-tier atomic persistence, Dual-Disk rollback safety, Cloud Firestore self-healing)
Slide 4: The 8-Tier Organizational Hierarchy (CBO, DCBO, HOD, DHOD, In-Charge, Model Manager, Engineer, Officer, Technician, Super Admin)
Slide 5: Confidential Point Governance & Strict Access Control (Points visible exclusively to CBO, DCBO, HOD, DHOD, and Super Admin; hidden from Officer and Engineer panels)
Slide 6: Officer-to-Engineer Task Recommendation & Point Workflow (Officer creates -> Field execution -> In-Charge/HOD review -> Points awarded to Concern Engineer)
Slide 7: 6-State Shift Attendance & Live Workforce Board (Present, Leave, Short Leave, Absent, Shift A 6AM-2PM, Shift B 2PM-10PM; Real-time Free vs. Working technician roster)
Slide 8: Real-Time Calendar Engine (Dynamic 12-month selector, auto running-month sync, permanent historical record archiving)
Slide 9: Single Work vs. Dynamic Team Collaboration (Single technician direct tracking vs. Multi-technician weighted progress sliders and cross-section borrowing)
Slide 10: 100-Mark Balanced Scorecard Performance Evaluation (60% Task Delivery + 10% Attendance Reliability + 30% Operational Efficiency)
Slide 11: Enterprise Role-Based BI Analytics & Deep Drill-Downs (Time trend area charts, model workload distribution, associate drill-down modals, Excel/PDF exports)
Slide 12: Zero Data Loss Architecture & Autonomous Disaster Recovery (5-minute rolling background snapshots, persistent tombstones, one-click JSON system restoration)
Slide 13: Hardware Fingerprint Security & Session Governance (Unique device hashes, IP threat monitoring, active session termination, instant device blacklisting)
Slide 14: Conclusion & Strategic Business Impact (100% operational transparency, zero data loss, objective performance appraisal, factory efficiency boost)
```

---

## 🖥️ Slide-by-Slide Presentation Content & Speaker Script

### Slide 1: Title & Vision
- **Slide Title**: Daily Work Update — Hierarchical Enterprise Task Governance
- **Subtitle**: Real-Time Workforce Tracking, Quality Auditing & Multi-Tier Production Intelligence
- **Presenter / Author**: Jahid Hasan (38250) — RAC Research & Innovation (RAC R&I)
- **Key Message**: Transforming manual factory operations into a unified, secure, data-grounded digital command center.

### Slide 2: The Factory Challenge & Problem Statement
- **Operational Gaps Addressed**:
  - Unstructured task assignments and lack of real-time progress visibility.
  - Manual attendance logs causing mismatch between available vs. assigned technicians.
  - Absence of standardized quality review before task completion.
  - Lack of objective, mathematical performance evaluation for field personnel.
- **Solution Delivered**: An 8-tier role-based system providing end-to-end task lifecycles, live countdowns, strict access privacy, and automated performance tracking.

### Slide 3: Enterprise System Architecture
- **Tri-Tier Storage Resilience**:
  1. *Dual-Disk Atomic Local File Engine* (`data.json`, `data/db.json` with sequential write queues).
  2. *Cloud Firestore Multi-Region Database* with quota-aware error handling and offline caching.
  3. *Permanent Staff Baseline Registry* (`data/permanent-staff.json`) guaranteeing staff records survive restarts.
- **Persistent Tombstones**: `deletedTaskIds` and `deletedUserIds` prevent ghost resurrection of deleted entities.

### Slide 4: 8-Tier Organizational Hierarchy
- **CBO & DCBO**: Chief Business Officer & Deputy CBO — Executive macro metrics, section health, strategic departmental audits.
- **HOD & DHOD**: Head & Deputy Head of Department — Department-wide operational approvals, attendance governance, final sign-offs.
- **In-Charge**: Section supervisor — Factory line workload balancing, inter-officer technician borrow approvals.
- **Model Manager**: RAC product line specialist (18K, 24K, 36K, Inverters) — Model defect resolution and milestone tracking.
- **Engineer**: Technical oversight — Technical deadline enforcement (`engineer_deadline`), quality verification, technical recommendations.
- **Officer**: Shop-floor supervisor — Daily task creation, technician dispatch, progress monitoring.
- **Technician**: Field specialist — Mobile/Desktop task execution, 0-100% progress sliders, live overtime counter.
- **Super Admin**: System governance — Hardware security, device blacklists, active session termination, one-click disaster recovery.

### Slide 5: Strict Point Governance & Confidential Score Protection
- **Authoritative Rule (Rule 18)**:
  - Task Points and Performance Scores are **strictly confidential**.
  - **Visible Only To**: `HOD`, `DHOD`, `DCBO`, `CBO`, and `SUPER_ADMIN`.
  - **Completely Hidden From**: All `OFFICER` and `ENGINEER` interfaces.
- **Hidden UI Elements for Officers & Engineers**:
  - Task Management summary counters, "Points" table columns, and footer totals.
  - Recommendation modal point assignment buttons and point badges.
  - Trend charts ("Points Earned" lines) and Analytics KPI cards ("Verified Points").
  - Associate drill-down modals and exported Excel/PDF reports.

### Slide 6: Officer-to-Engineer Task Recommendation Workflow
- **The Lifecycle**:
  1. *Initiation*: Officer creates task for RAC R&I models.
  2. *Execution*: Technician completes the task (100% progress).
  3. *Review Queue*: Task appears in *"Pending Officer Tasks Awaiting Engineer Recommendation"*.
  4. *Quality Evaluation*: In-Charge, HOD, or DHOD reviews deliverables, assigns 1 to 3 quality points, and links the Concern Engineer.
  5. *Point Allocation*: Points are credited directly to the Concern Engineer's record upon authorized sign-off.

### Slide 7: 6-State Shift Attendance & Live Workforce Roster
- **Attendance States**:
  - 🟢 `PRESENT`: On duty and available.
  - 🟡 `SHORT_LEAVE`: Temporarily off-line during working hours.
  - 🔴 `LEAVE`: Approved full-day absence.
  - ⚪ `ABSENT`: Unauthorized absence flagged for review.
  - 🕒 `SHIFT_A`: Morning Shift (06:00 AM – 02:00 PM).
  - 🌙 `SHIFT_B`: Evening Shift (02:00 PM – 10:00 PM).
- **Live Technician Board**: Instantly separates technicians into **Active Working**, **Available Free**, and **On Leave / Off-Duty**.

### Slide 8: Real-Time 12-Month Calendar & Historical Data Archival
- **Dynamic 12-Month Selector**: Supports selection from January to December across any year.
- **Real-Time Running Month Default**: System auto-detects current real-time month (e.g. November 2026) upon launch.
- **Zero Data Loss Guarantee**: Switching months instantly reloads data dynamically; historical records from prior months remain permanently intact and accessible.
- **Manual Date Horizon**: Accurate custom date ranges (`From Date` to `To Date`) for targeted analytical reviews.

### Slide 9: Single vs. Dynamic Team Collaboration
- **Single Work**: Assigned to one technician with a linear progress tracking slider.
- **Team Work**: Supports multiple technicians simultaneously (`assignedTechnicians`), each maintaining personal progress sliders. System computes live weighted team progress.
- **Shifting Technician Borrowing**: Allows officers to borrow specialists across sections with formal In-Charge approval and full audit logging.

### Slide 10: 100-Mark Balanced Scorecard Performance Evaluation
$$\mathbf{Total\ Score\ (100)} = \mathbf{Task\ Delivery\ (60)} + \mathbf{Attendance\ Reliability\ (10)} + \mathbf{Operational\ Efficiency\ (30)}$$
- **Task Delivery (Max 60)**: Weighted points from completed tasks based on urgency and complexity.
- **Attendance Reliability (Max 10)**: Ratio of Present days vs. working days with absence deductions.
- **Operational Delivery Efficiency (Max 30)**: Percentage of on-time task completions versus deadlines.
- **Audited Adjustments**: Leadership can apply auditable bonus or penalty points stored permanently in the ledger.

### Slide 11: Enterprise Role-Based BI Analytics & Deep Drill-Downs
- **Time Trend Intelligence**: Interactive Area and Line charts displaying task volume, completion rates, and bottlenecks.
- **Model Distribution Matrix**: Pie and bar distributions across RAC models (18K, 24K, 36K, Inverter series).
- **Workforce Performance Cards**: Clickable associate cards with full drill-down modal into individual historical tasks.
- **Multi-Format Export**: Clean Excel (.xlsx) workbooks and print-ready high-resolution PDFs with mandatory author attribution.

### Slide 12: Zero Data Loss Architecture & Autonomous Disaster Recovery
- **5-Minute Autonomous Snapshots**: Background engine writes verified system-wide backups to `/backups`.
- **Dual Baseline Staff Sync**: Employee credentials protected against accidental wipeouts during cold boots.
- **One-Click Instant Disaster Restoration**: Restore the full database, user credentials, and active tasks in under 3 seconds from any verified JSON snapshot.

### Slide 13: Hardware Fingerprint Security & Device Governance
- **Hardware Device Fingerprinting**: Combines browser family, screen resolution, GPU canvas hash, and IP into a unique device ID.
- **Live Active Sessions**: Super Admin can view all connected devices and terminate rogue sessions with one click (`Force Logout`).
- **Hardware Blacklist**: Lock malicious or unapproved devices permanently from accessing the platform.

### Slide 14: Conclusion & Strategic Factory Impact
- **Key Outcomes**:
  - 100% visibility into shop-floor RAC R&I task execution.
  - Zero accidental data loss through atomic local and cloud persistence.
  - High morale and fair recognition via the 100-mark balanced appraisal system.
  - Complete data privacy compliance with role-governed confidential score protection.

---

## 📋 Table of Contents
1. [System Architecture & Data Permanence Guarantee](#1-system-architecture--data-permanence-guarantee)
2. [8-Tier Organizational Hierarchy & Access Matrix](#2-8-tier-organizational-hierarchy--access-matrix)
3. [Confidential Score Point Governance (Rule 18)](#3-confidential-score-point-governance-rule-18)
4. [Step-by-Step User Role Operational Guides](#4-step-by-step-user-role-operational-guides)
5. [Core Functional Modules & Features](#5-core-functional-modules--features)
6. [API Endpoints Reference](#6-api-endpoints-reference)
7. [Installation, Environment & Production Deployment](#7-installation-environment--production-deployment)
8. [License & Mandatory Attribution](#8-license--mandatory-attribution)

---

## 1. System Architecture & Data Permanence Guarantee

The platform implements an industrial **tri-tier atomic persistence and self-healing storage engine** designed to prevent data loss even in cloud hosting environments subject to process cycling, container teardown, or ephemeral resets:

1. **Dual-Disk Process-Isolated Atomic Writes**:
   - Business records (users, tasks, attendance, points, logs) are written through a strict sequential Promise queue (`saveDataQueue`).
   - The payload is written to timestamped temporary files (`.tmp`) before being atomically renamed simultaneously to both `data.json` and `data/db.json`.
   - Backup mirror `data.json.bak` guarantees rollback safety.

2. **Permanent Staff Directory Protection (`data/permanent-staff.json`)**:
   - Employee credentials, designations, and roles are backed up to a dedicated immutable staff registry.
   - On server cold boot, the startup sequence **auto-heals** the employee roster, ensuring valid staff records are never lost.
   - Deletions are strictly restricted to Super Admin explicit commands.

3. **Persistent Task & User Tombstones (`deletedTaskIds` / `deletedUserIds`)**:
   - Deleted tasks and users are registered in persistent tombstone sets that survive server restarts and backups, preventing ghost resurrection.

4. **Autonomous 5-Minute Server-Side Snapshots**:
   - Autonomous background scheduler triggers a full, uncorrupted snapshot of all database tables every **5 minutes** into `backups/`.
   - Preserves rolling verified snapshots with zero auto-wipe.

---

## 2. 8-Tier Organizational Hierarchy & Access Matrix

| Role | Scope & Permissions | Key Interfaces & Capabilities |
| :--- | :--- | :--- |
| **SUPER_ADMIN** | Total administrative sovereignty across entire application, data stores, sessions, and devices. | Security Center, Device Lockout, Active Sessions Killer, Permanent Staff Management, Full DB Restore, System Backup. |
| **CBO** *(Chief Business Officer)* | Highest operational executive governance, factory-wide KPIs, cross-department analytics. | CBO Command Dashboard, Strategic Health Metrics, Line Efficiency Audits, Department Benchmark Reports. |
| **DCBO** *(Deputy CBO)* | Executive departmental performance tracking, resource balance oversight. | CBO & Executive Dashboards, Departmental Velocity Tracking, Cross-Section Oversight. |
| **HOD** *(Head of Dept)* | Department-wide leadership, executive workforce coordination, final approval authority. | Executive Command Center (ECC), Department Overview, 6-State Staff Attendance Marker, Executive 360° Reports. |
| **DHOD** *(Deputy HOD)* | Operations co-leadership, daily shift coordination, task approvals. | Executive Dashboards, Recommendation Reviews, Task Approvals, Shift Attendance Coordination. |
| **IN_CHARGE** | Factory section operational leadership, line balance, and inter-officer coordination. | Section Overview, Technician Rebalancing, Shifting Request Approval, Line Workload Tracking, Task Recommendations. |
| **MODEL_MANAGER**| RAC product model-focused execution (e.g., 18K, 24K, 36K, Inverter series). | Model-Wise Work Distribution, Model Delivery Schedules, Model Quality Tracking. |
| **ENGINEER** | Technical governance, quality evaluation, technical deadline control. | Technical Deadline Assignment (`engineer_deadline`), Quality Ratings (1-5), Work Recommendations, External Privacy Reports. |
| **OFFICER** | Daily work initiation, field supervision, technician shift management. | Task Creation (Single/Team), Rotating Technician Borrow Requests, Daily Progress Logs, Internal Accountability Reports. |
| **TECHNICIAN** | Direct maintenance, repair, and assembly execution. | "My Work" Mobile/Desktop Card, 0-100% Progress Sliders, Shift Check-In, Status Indicator (`FREE`/`WORKING`/`ON_LEAVE`). |

---

## 3. Confidential Score Point Governance (Rule 18)

To maintain an objective, dispute-free shop-floor environment and protect executive appraisal integrity:

- **Strict Access Restriction**:
  - Score points and task points are **strictly restricted** to **HOD**, **DHOD**, **DCBO**, **CBO**, and **SUPER_ADMIN**.
- **Panel Sanitization for Officers & Engineers**:
  - **Task Management Table**: "Points" column, header counter, and footer total points are completely hidden.
  - **Pending Recommendations**: Point selectors and point badge awards are replaced with clean "Review & Approve" actions.
  - **Task Details Modal**: Point metrics and credit notifications are hidden.
  - **Role Analytics & BI**: "Verified Points" KPI cards, "Points Earned" trend lines, and associate point badges are hidden.
  - **Excel / PDF Exports**: Point columns are automatically excluded from exports generated by Officers and Engineers.

---

## 4. Step-by-Step User Role Operational Guides

### Super Admin
1. **Security & Session Control**: Access Security Center to review real-time activity logs with IP and device fingerprints. Terminate rogue sessions or lock suspicious hardware IDs.
2. **Staff Roster Management**: Add new staff, map supervisors, and execute audited permanent staff removals.
3. **Disaster Recovery**: Trigger instant backups and restore full database snapshots via uploaded JSON files in under 3 seconds.

### CBO / DCBO
1. **Executive Factory Intelligence**: Review macro production KPIs, on-time delivery rates, and active task distribution across all lines.
2. **Quality & Performance Audits**: Monitor department-wide scores, verified points, and high-level milestones.

### HOD / DHOD
1. **Daily Attendance Governance**: Mark 6-state shift attendance (Present, Leave, Short-Leave, Absent, Shift A, Shift B) for all personnel.
2. **Task Final Approvals**: Review completed deliverables submitted by Officers and recommended by In-Charges/Engineers.
3. **Point & Score Management**: View and calibrate verified points, performance rankings, and monthly appraisals.

### In-Charge
1. **Section Line Balancing**: Reallocate tasks among technicians to prevent line overloading.
2. **Technician Borrow Requests**: Review and approve cross-section technician transfer requests.
3. **Officer Task Recommendation**: Review Officer-created tasks awaiting recommendation, assign 1-3 points, and credit the Concern Engineer.

### Model Manager
1. **RAC Model Execution**: Track task progress segmented by product model (18K, 24K, 36K, Inverter Split, Cassette).
2. **Defect & Trial Tracking**: Monitor line modifications, trials, and reliability test units.

### Engineer
1. **Technical Governance**: Set `engineer_deadline` alongside operational deadlines.
2. **Quality Review**: Inspect completed technical items and submit technical remarks.
3. **Confidentiality Reports**: Export external reports with technician personal identities masked.

### Officer
1. **Task Dispatch**: Create Single or Team tasks with model specifications, custom start times, and durations.
2. **Technician Shift Supervision**: Track live countdowns and support technicians facing blockages or holding reasons.
3. **Resource Requests**: Request rotating technician support from other sections via formal requests.

### Technician
1. **Daily Execution**: Check "My Work" board for active tasks with live second-by-second countdowns.
2. **Progress Updates**: Move the progress slider (0% ➔ 25% ➔ 50% ➔ 75% ➔ 100%) and enter remarks.
3. **Hold State**: Mark tasks as "Hold" with specific reason if parts or test conditions are unavailable.

---

## 5. Core Functional Modules & Features

### Feature 1: Task Execution & Live Countdown Lifecycle
- Real-time animated countdown timers on running tasks:
  - 🟢 **Green**: Normal progress (< 60% elapsed).
  - 🟡 **Amber**: Approaching deadline (60% – 85% elapsed).
  - 🔴 **Red**: Critical deadline (> 85% elapsed).
  - 🚨 **Red Pulsing Alert**: Real-time overtime counter (`Over: Xh Ym Zs`).

### Feature 2: 6-State Shift Attendance & Live Workforce Monitoring
- **Dedicated Technician Availability Roster**:
  - **Active Working**: Technicians currently running active tasks.
  - **Available Free**: Technicians present and ready for instant dispatch.
  - **On Leave / Off-Duty**: Technicians absent, on leave, or off-shift.

### Feature 3: Real-Time 12-Month Calendar & Auto Running-Month Engine
- Supports full 12-month navigation (January to December).
- Auto-defaults to the real-time running month upon loading.
- Selecting any month instantly updates views without wiping or resetting data.
- Custom date ranges (`From Date` to `To Date`) for targeted analytical reviews.

### Feature 4: 100-Mark Balanced Scorecard Performance Evaluation
- **Task Delivery (60 Marks)**: Points earned from successfully completed tasks based on urgency and complexity.
- **Attendance Reliability (10 Marks)**: Calculated based on on-duty attendance days versus total working days.
- **Operational Delivery Efficiency (30 Marks)**: Ratio of on-time task completions versus deadlines.
- **Audited Manual Adjustments**: Leadership can apply auditable bonus or penalty points stored permanently in the ledger.

### Feature 5: Role-Grounded Reporting & Document Export
- **Print-Ready Landscape PDF**: Includes company branding, summary stats, tabular breakdown, and digital signatures.
- **Excel Workbook (.xlsx)**: Clean tabular data with automated role-based privacy masking.
- **Mandatory Legal Footer**:  
  *`Software development by Jahid Hasan (38250) RAC R&I`*

### Feature 6: Hardware Fingerprint Security Suite
- Device fingerprinting via browser, screen resolution, GPU canvas rendering, and IP.
- Active session management with one-click remote JWT termination.
- Hardware and IP blacklisting for unauthorized access attempts.

---

## 6. API Endpoints Reference

### Authentication & Sessions
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/login` | Authenticate user, verify device fingerprint, return JWT. |
| `POST` | `/api/logout` | Terminate session and record activity duration. |
| `GET` | `/api/profile` | Retrieve profile and permissions of authenticated user. |

### Task Management
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/tasks` | Fetch tasks (filtered by role, month, year, or all). |
| `POST` | `/api/tasks` | Create new Single or Team task. |
| `PUT` | `/api/tasks/:id` | Update task progress (0-100%), status, or remarks. |
| `DELETE` | `/api/admin/tasks/:id` | Permanent hard delete with persistent tombstone sync (Super Admin). |
| `POST` | `/api/tasks/:id/recommend` | Submit technical recommendation & point award (In-Charge/HOD). |
| `POST` | `/api/tasks/:id/approve` | Final task approval (HOD/Admin). |

### Staff & Attendance
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/staff` | List all staff members, designations, and supervisor mappings. |
| `POST` | `/api/staff` | Register new employee. |
| `PUT` | `/api/staff/:id` | Update employee profile or credentials. |
| `DELETE` | `/api/staff/:id` | Permanently remove employee from all storage tiers. |
| `GET` | `/api/attendance` | Fetch shift attendance records. |
| `POST` | `/api/attendance` | Record daily shift attendance status for personnel. |

### System Governance & Disaster Recovery
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/system/backups-catalog` | Retrieve list of verified persistent backups with metadata. |
| `POST` | `/api/system/backup-now` | Trigger instantaneous database snapshot. |
| `GET` | `/api/system/backup` | Download complete JSON system backup. |
| `POST` | `/api/system/restore` | Restore entire system state from uploaded JSON snapshot. |
| `POST` | `/api/security/lock-device` | Blacklist and lock a hardware device fingerprint or IP. |
| `DELETE` | `/api/security/sessions/:id` | Force terminate an active device session. |

---

## 7. Installation, Environment & Production Deployment

### Prerequisites
- Node.js `>= 20.19.0`
- NPM or Bun package manager

### Environment Configuration
Create a `.env` file in the project root:
```env
PORT=3000
JWT_SECRET=your-enterprise-production-jwt-secret-38250
GEMINI_API_KEY=your-gemini-api-key-here
```

### Build & Execution
```bash
# 1. Install dependencies
npm install

# 2. Run full-stack development server (Express + Vite)
npm run dev

# 3. Compile production build
npm run build

# 4. Start production server
npm start
```

---

## 8. License & Mandatory Attribution

This software is engineered specifically for specialized manufacturing, research, and technical workforce governance.

**Software development by Jahid Hasan (38250) RAC R&I**  
Copyright © 2026 Daily Work Update. All rights reserved.
