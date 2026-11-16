export type Role = 
  | 'SUPER_ADMIN' 
  | 'CBO'
  | 'DCBO'
  | 'HOD' 
  | 'DHOD'
  | 'IN_CHARGE' 
  | 'MODEL_MANAGER' 
  | 'ENGINEER' 
  | 'OFFICER' 
  | 'TECHNICIAN';

export type Urgency = 'REGULAR' | 'URGENT' | 'MOST_URGENT';
export type TaskStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'DELAYED' | 'HOLD' | 'REQUESTED' | 'REJECTED';

export interface User {
  id: string;
  employeeId: string;
  name: string;
  password?: string;
  role: Role;
  department?: string;
  section?: string;
  avatar?: string;
  supervisorId?: string;
  cboId?: string;
  dcboId?: string;
  hodId?: string;
  dhodId?: string;
  supervisor_ids?: string[]; // For shifting technicians under multiple officers
  assignedEngineers?: string[]; // Array of Engineer employeeIds
  phone?: string;
  designation?: string;
  email?: string;
  theme?: string;
  customBackground?: string;
  status?: 'FREE' | 'WORKING' | 'ON_LEAVE' | 'SHORT_LEAVE' | 'SHIFT_OFF';
  total_point?: number;
  completedTask?: number;
  mustChangePassword?: boolean;
}

export interface Department {
  id: string;
  name: string;
  code?: string;
  description?: string;
  createdAt?: string;
}

export interface ProjectModel {
  id: string;
  name: string;
  department?: string;
  description?: string;
  status?: 'ACTIVE' | 'ARCHIVED';
  createdAt?: string;
}

export interface TaskAttachment {
  id: string;
  taskId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
  uploadedBy: string;
  uploadedByName?: string;
  uploadedAt: string;
}

export interface TaskComment {
  id: string;
  taskId: string;
  userId?: string;
  employeeId: string;
  userName: string;
  comment: string;
  createdAt: string;
}

export interface TaskLog {
  id: string;
  action: string;
  timestamp: string;
  user: string;
}

export interface AssignedTechnician {
  employeeId: string;
  name: string;
  progress: number;
  status: TaskStatus;
  startedAt?: string;
  completedAt?: string;
}

export interface TeamApproval {
  officerId: string;
  officerName?: string;
  technicianIds: string[];
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  approvedAt?: string;
  approvedBy?: string;
  remarks?: string;
}

export interface Task {
  id: string;
  taskId: string;
  title: string;
  model: string;
  details: string;
  urgency: Urgency;
  createdBy: string;
  assignedBy: string;
  assignedTo: string; // Officer or Technician (for Single Work)
  workType?: 'SINGLE' | 'TEAM';
  assignedTechnicians?: AssignedTechnician[];
  teamApprovals?: TeamApproval[];
  status: TaskStatus;
  progress: number;
  points?: number; // Performance points
  quality?: number; // 1-5 scale
  deadline: string;
  engineer_deadline?: string;
  remarks?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  logs: TaskLog[];
  requestStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'RECOMMENDED';
  requestRemarks?: string;
  approvedBy?: string;
  customStartTime?: string;
  estimatedDuration?: string;
  actualCompletionTime?: string;
  taskTakenTime?: string;
  remainingTime?: string;
  overTime?: string;
  totalTeamProgress?: number;
  pointAdded?: boolean;
  engineerApproved?: boolean;
  recommendedBy?: string;
  recommendedByName?: string;
  recommendedRole?: string;
  recommendedAt?: string;
  recommendedPoints?: number;
  supervisorApproved?: boolean;
  supervisorApprovedBy?: string;
  responsibleOfficerId?: string;
  concernEngineerId?: string;
  modelManagerId?: string;
  inChargeId?: string;
  dhodId?: string;
  hodId?: string;
  totalHoldMinutes?: number;
  totalHoldMs?: number;
  currentHoldStartTime?: string;
  holdHistory?: Array<{ holdStart: string; holdEnd?: string; reason?: string }>;
  timerStatus?: 'RUNNING' | 'PAUSED_SHIFT_END' | 'RESUMED' | 'OVERTIME_PENDING' | 'OVERTIME_APPROVED' | 'TIME_EXCEEDED' | 'COMPLETED' | 'HOLD';
  assignedShiftCode?: string;
  originalEstimatedDuration?: string;
  revisedEstimatedDuration?: string;
  accumulatedWorkingMinutes?: number;
  accumulatedOvertimeMinutes?: number;
  approvedOvertimeMinutes?: number;
  isTimeExceeded?: boolean;
  timeExceededMinutes?: number;
  extensionHistory?: TaskTimeExtension[];
  reworkCount?: number;
  supervisorRating?: number;
  department?: string;
  project?: string;
  attachments?: TaskAttachment[];
  comments?: TaskComment[];
}

export interface Attendance {
  id: string;
  technicianId: string;
  status: 'PRESENT' | 'ABSENT' | 'LEAVE' | 'SHORT_LEAVE' | 'CHECKED_OUT' | 'SHIFT_6_2' | 'SHIFT_2_6' | 'SHIFT_A' | 'SHIFT_B';
  date: string;
  checkInTime?: string;
  checkOutTime?: string;
  shiftCode?: string;
  notes?: string;
}

export interface ShiftConfiguration {
  id: string;
  code: string;
  name: string;
  startTime: string; // HH:MM (Asia/Dhaka)
  endTime: string;   // HH:MM (Asia/Dhaka)
  breakDurationMinutes: number;
  isDefault: boolean;
  color?: string;
  description?: string;
  isActive?: boolean;
}

export interface TechnicianShiftAssignment {
  id?: string;
  technicianId: string;
  defaultShiftCode: string;
  weeklySchedule?: Record<string, string>; // dayOfWeek -> shiftCode | 'OFF'
  temporaryOverrides?: Array<{
    date: string; // YYYY-MM-DD
    shiftCode: string; // shiftCode | 'OFF'
    reason?: string;
  }>;
  holidays?: string[];
  assignedBy?: string;
  assignedAt?: string;
  notes?: string;
}

export interface TaskTimeSession {
  id: string;
  taskId: string;
  technicianId: string;
  date: string; // YYYY-MM-DD
  shiftCode: string;
  startTime: string; // ISO string
  endTime?: string;  // ISO string
  durationMinutes: number;
  type: 'NORMAL' | 'OVERTIME';
  status: 'ACTIVE' | 'PAUSED_SHIFT_END' | 'PAUSED_CHECKOUT' | 'PAUSED_HOLD' | 'COMPLETED';
  notes?: string;
}

export interface OvertimeRequest {
  id: string;
  taskId: string;
  taskTitle?: string;
  technicianId: string;
  technicianName?: string;
  date: string; // YYYY-MM-DD (BST)
  startTime: string; // ISO string
  endTime: string;   // ISO string
  normalDutyEndTime?: string;
  durationMinutes: number;
  approvedDurationMinutes?: number;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';
  requestedBy?: string;
  requestedById?: string;
  requestedAt?: string;
  approvedBy?: string;
  approvedById?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  remarks?: string;
}

export interface TaskTimeExtension {
  id: string;
  taskId: string;
  previousEstimatedMinutes: number;
  additionalMinutes: number;
  newEstimatedMinutes: number;
  reason: string;
  extendedBy: string;
  extendedById?: string;
  extendedAt: string;
}

export interface PerformanceConfig {
  timeEfficiencyWeight: number;
  taskCompletionWeight: number;
  qualityWeight: number;
  onTimeCompletionWeight: number;
  supervisorEvalWeight: number;
  reworkPenaltyPerIncident?: number;
  speedCapEfficiency?: number;
}

export interface TaskTimerAuditLog {
  id: string;
  taskId: string;
  technicianId?: string;
  event:
    | 'TIMER_STARTED'
    | 'AUTO_PAUSED_SHIFT_END'
    | 'AUTO_PAUSED_CHECKOUT'
    | 'AUTO_RESUMED_CHECKIN'
    | 'MANUAL_HOLD'
    | 'MANUAL_RESUME'
    | 'OVERTIME_REQUESTED'
    | 'OVERTIME_APPROVED'
    | 'OVERTIME_REJECTED'
    | 'OVERTIME_EXPIRED'
    | 'TIME_EXTENDED'
    | 'TASK_COMPLETED'
    | 'SHIFT_CHANGED';
  details: string;
  actor?: string;
  actorId?: string;
  timestamp: string;
}

export interface PointTransaction {
  id: string;
  taskId: string;
  officerId: string;
  engineerId: string;
  pointValue: number;
  taskPriority: Urgency;
  completedAt: string;
}

export interface TechnicianPerformance {
  id: string;
  technicianId: string;
  taskId: string;
  date: string;
  totalWorkMinutes: number;
  remainingMinutes: number;
  completionSpeedScore: number;
  attendanceScore: number;
  efficiencyScore: number;
  finalDailyScore: number;
}

export interface AssignmentRequest {
  id: string;
  taskId: string;
  requestingOfficerId: string;
  targetTechnicianId: string;
  supervisorId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reason?: string;
  createdAt: string;
  approvedAt?: string;
}

export interface Notification {
  id: string;
  userId: string;
  senderId?: string;
  taskId?: string;
  type?: string;
  message: string;
  read: boolean;
  timestamp: string;
}

export interface ActivityLog {
  id: string;
  userId: string;
  employeeId: string;
  name: string;
  role: Role;
  loginTime: string;
  logoutTime?: string;
  sessionDuration?: string;
  ipAddress: string;
  localIp?: string;
  browser: string;
  os: string;
  deviceType: string;
  deviceName?: string;
  platform?: string;
  location?: {
    country?: string;
    city?: string;
    region?: string;
  };
  loginStatus: 'SUCCESS' | 'FAILED';
  failedAttemptCount?: number;
  createdAt: string;
  isSuspicious?: boolean;
  suspiciousReason?: string;
}

export interface AdminAuditLog {
  id: string;
  adminId: string;
  adminName: string;
  actionType: string;
  targetUser?: string;
  targetTask?: string;
  timestamp: string;
  ipAddress: string;
  details: string;
}

export interface UserSession {
  id: string;
  userId: string;
  employeeId: string;
  loginTime: string;
  logoutTime?: string;
  sessionDuration?: string;
  ipAddress: string;
  localIp?: string;
  browser: string;
  os: string;
  deviceHash: string;
  deviceName?: string;
  platform?: string;
  active: boolean;
  lastActivity: string;
}

export interface FailedLoginAttempt {
  id: string;
  employeeId: string;
  ipAddress: string;
  browser: string;
  os: string;
  timestamp: string;
  attemptCount: number;
  isLocked: boolean;
  lockUntil?: string;
  reason?: string;
}

export interface LockedDevice {
  id: string;
  ipAddress?: string;
  deviceHash?: string;
  browser?: string;
  os?: string;
  reason: string;
  lockedBy: string;
  lockedAt: string;
}
