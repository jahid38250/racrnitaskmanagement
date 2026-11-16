/**
 * ADVANCED SMART WORKING-TIME & SHIFT MANAGEMENT ENGINE
 * 
 * Enterprise-grade attendance-based working-time calculation engine for industrial operations.
 * Implements strict working-hour interval math, multi-day task continuation, automatic
 * shift boundary pause/resume, supervisor overtime extensions, and comprehensive performance scoring.
 * 
 * Consistent with Bangladesh Standard Time (Asia/Dhaka, UTC+06:00).
 */

import { 
  Task, 
  Attendance, 
  ShiftConfiguration, 
  TechnicianShiftAssignment, 
  TaskTimeSession, 
  OvertimeRequest,
  PerformanceConfig
} from './types';

// Bangladesh Standard Time offset in milliseconds (+06:00)
export const BD_OFFSET_HOURS = 6;
export const BD_OFFSET_MS = BD_OFFSET_HOURS * 60 * 60 * 1000;

export const DEFAULT_SHIFTS: ShiftConfiguration[] = [
  {
    id: 'shift-a',
    code: 'SHIFT_A',
    name: 'Shift A: 08:00 AM – 05:00 PM',
    startTime: '08:00',
    endTime: '17:00',
    breakDurationMinutes: 60,
    isDefault: false,
    color: 'emerald',
    description: 'Morning Industrial Shift',
    isActive: true
  },
  {
    id: 'shift-b',
    code: 'SHIFT_B',
    name: 'Shift B: 09:00 AM – 06:00 PM',
    startTime: '09:00',
    endTime: '18:00',
    breakDurationMinutes: 60,
    isDefault: true,
    color: 'blue',
    description: 'Standard General Shift (Default)',
    isActive: true
  },
  {
    id: 'shift-c',
    code: 'SHIFT_C',
    name: 'Shift C: 02:00 PM – 10:00 PM',
    startTime: '14:00',
    endTime: '22:00',
    breakDurationMinutes: 45,
    isDefault: false,
    color: 'purple',
    description: 'Evening Operations Shift',
    isActive: true
  }
];

export const DEFAULT_PERFORMANCE_CONFIG: PerformanceConfig = {
  timeEfficiencyWeight: 30, // 30%
  taskCompletionWeight: 25, // 25%
  qualityWeight: 25,        // 25%
  onTimeCompletionWeight: 10, // 10%
  supervisorEvalWeight: 10   // 10%
};

/**
 * Parses any date string or Date object into a reliable Date.
 * Handles ISO strings, local date strings, and Bangladesh timezone offsets.
 */
export function parseDate(d?: string | Date | number | null): Date {
  if (!d) return new Date(NaN);
  if (d instanceof Date) return d;
  if (typeof d === 'number') return new Date(d);
  const trimmed = String(d).trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) {
    return new Date(`${trimmed}+06:00`);
  }
  return new Date(trimmed);
}

/**
 * Returns breakdown of year, month, day, hours, minutes in Bangladesh Standard Time (+06:00)
 */
export function getBangladeshDateTime(inputDate?: Date | string | number | null) {
  const d = inputDate ? parseDate(inputDate) : new Date();
  if (isNaN(d.getTime())) {
    const fallback = new Date();
    return getBangladeshDateTime(fallback);
  }
  // Convert UTC time to BD time by adding 6 hours to UTC
  const utcMs = d.getTime() + (d.getTimezoneOffset() * 60 * 1000);
  const bdDate = new Date(utcMs + BD_OFFSET_MS);

  const year = bdDate.getFullYear();
  const month = bdDate.getMonth() + 1; // 1-12
  const day = bdDate.getDate();
  const hours = bdDate.getHours();
  const minutes = bdDate.getMinutes();
  const seconds = bdDate.getSeconds();
  
  const yyyy = String(year);
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;
  const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  
  const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayOfWeek = daysOfWeek[bdDate.getDay()];

  return {
    year,
    month,
    day,
    hours,
    minutes,
    seconds,
    dateStr,
    timeStr,
    dayOfWeek,
    bdDate
  };
}

/**
 * Creates a UTC Date corresponding to a specific Bangladesh calendar date and HH:MM time.
 */
export function createBangladeshTimestamp(dateStr: string, timeStr: string): Date {
  // dateStr: 'YYYY-MM-DD', timeStr: 'HH:MM' or 'HH:MM:SS'
  const time = timeStr.length === 5 ? `${timeStr}:00` : timeStr;
  return new Date(`${dateStr}T${time}+06:00`);
}

/**
 * Retrieves the technician's assigned shift for a specific calendar date.
 * Hierarchy:
 * 1. Temporary override for that specific date
 * 2. Weekly schedule for that specific day of week
 * 3. Default assigned shift for technician
 * 4. System default shift (Shift B)
 */
export function getTechnicianShiftForDate(
  technicianId: string,
  dateStr: string,
  shiftAssignments: TechnicianShiftAssignment[] = [],
  shifts: ShiftConfiguration[] = DEFAULT_SHIFTS
): { shift: ShiftConfiguration; isWeeklyOff: boolean; isTemporaryOverride: boolean } {
  const assignment = shiftAssignments.find(a => 
    String(a.technicianId || '').trim().toLowerCase() === String(technicianId || '').trim().toLowerCase()
  );

  const bdInfo = getBangladeshDateTime(createBangladeshTimestamp(dateStr, '12:00'));
  const dayOfWeek = bdInfo.dayOfWeek; // 'friday', 'saturday', etc.

  let selectedCode = 'SHIFT_B';
  let isWeeklyOff = dayOfWeek === 'friday'; // Default weekly off in Bangladesh is Friday
  let isTemporaryOverride = false;

  if (assignment) {
    // 1. Temporary override
    if (Array.isArray(assignment.temporaryOverrides)) {
      const override = assignment.temporaryOverrides.find(o => o.date === dateStr);
      if (override) {
        selectedCode = override.shiftCode;
        isTemporaryOverride = true;
        isWeeklyOff = override.shiftCode === 'OFF';
      }
    }

    // 2. Weekly schedule
    if (!isTemporaryOverride && assignment.weeklySchedule && assignment.weeklySchedule[dayOfWeek]) {
      const sched = assignment.weeklySchedule[dayOfWeek];
      selectedCode = sched;
      isWeeklyOff = sched === 'OFF';
    } else if (!isTemporaryOverride && assignment.defaultShiftCode) {
      selectedCode = assignment.defaultShiftCode;
    }
  }

  // Lookup shift configuration by code
  let shift = shifts.find(s => s.code.toUpperCase() === selectedCode.toUpperCase());
  if (!shift) {
    shift = shifts.find(s => s.isDefault) || DEFAULT_SHIFTS[1];
  }

  return {
    shift,
    isWeeklyOff,
    isTemporaryOverride
  };
}

/**
 * Formats duration in minutes into clean human-readable string: e.g. "20h 0m", "8h 45m"
 */
export function formatMinutes(totalMinutes: number): string {
  const mins = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

export const formatMinutesToHmMini = formatMinutes;

/**
 * Formats duration in milliseconds into clean human-readable string with optional seconds
 */
export function formatDurationMs(ms: number, includeSeconds = false): string {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.floor(safeMs / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (includeSeconds) {
    return `${h}h ${m}m ${s}s`;
  }
  return `${h}h ${m}m`;
}

/**
 * Parses duration strings like "1200", "20h", "20h 30m", "1d 2h" into minutes.
 */
export function parseDurationToMinutes(dur?: string | number | null): number {
  if (dur === null || dur === undefined || dur === '') return 60;
  if (typeof dur === 'number') return Math.max(1, Math.round(dur));
  const str = String(dur).trim();
  if (/^\d+$/.test(str)) {
    return parseInt(str, 10) || 60;
  }
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

export interface WorkingInterval {
  startMs: number;
  endMs: number;
  type: 'NORMAL' | 'OVERTIME';
  dateStr: string;
  shiftCode: string;
}

/**
 * Calculates all eligible working intervals for a specific technician on a specific calendar day.
 */
export function getEligibleIntervalsForDay(
  technicianId: string,
  dateStr: string, // 'YYYY-MM-DD'
  attendanceRecords: Attendance[] = [],
  overtimeRequests: OvertimeRequest[] = [],
  shiftAssignments: TechnicianShiftAssignment[] = [],
  shifts: ShiftConfiguration[] = DEFAULT_SHIFTS,
  taskId?: string
): WorkingInterval[] {
  const intervals: WorkingInterval[] = [];

  // 1. Shift for this day
  const { shift, isWeeklyOff } = getTechnicianShiftForDate(technicianId, dateStr, shiftAssignments, shifts);

  // 2. Attendance on this day
  const att = attendanceRecords.find(a => 
    (String(a.technicianId || '').trim() === String(technicianId).trim() ||
     String((a as any).employeeId || '').trim() === String(technicianId).trim()) &&
    a.date === dateStr
  );

  // Also check temporary holidays / off days on assignment
  const assignment = shiftAssignments.find(a =>
    String(a.technicianId || '').trim().toLowerCase() === String(technicianId || '').trim().toLowerCase()
  );
  const isHoliday = Array.isArray(assignment?.holidays) && assignment!.holidays.includes(dateStr);

  const attStatus = att?.status || 'PRESENT'; // Default to PRESENT per enterprise rule

  // If technician is marked ABSENT, LEAVE, or CHECKED_OUT without checkInTime/checkOutTime bounds
  const isAbsentOrLeave = ['ABSENT', 'LEAVE'].includes(attStatus);

  // Allow explicit shift code override via attendance status/shiftCode
  let dayShift = shift;
  if (att?.shiftCode) {
    const found = shifts.find(s => s.code.toUpperCase() === att.shiftCode!.toUpperCase());
    if (found) dayShift = found;
  } else if (attStatus === 'SHIFT_A' || attStatus === 'SHIFT_6_2') {
    dayShift = shifts.find(s => s.code === 'SHIFT_A') || shift;
  } else if (attStatus === 'SHIFT_B' || attStatus === 'SHIFT_2_6') {
    dayShift = shifts.find(s => s.code === 'SHIFT_B') || shift;
  }

  if (!isWeeklyOff && !isHoliday && !isAbsentOrLeave) {
    // Normal Shift Hours: convert to UTC timestamps
    const shiftStart = createBangladeshTimestamp(dateStr, dayShift.startTime);
    const shiftEnd = createBangladeshTimestamp(dateStr, dayShift.endTime);

    let effectiveStartMs = shiftStart.getTime();
    let effectiveEndMs = shiftEnd.getTime();

    // Handle late check-in if present in attendance
    if (att?.checkInTime) {
      const checkInDate = att.checkInTime.includes('T')
        ? parseDate(att.checkInTime)
        : createBangladeshTimestamp(dateStr, att.checkInTime);
      if (!isNaN(checkInDate.getTime()) && checkInDate.getTime() > effectiveStartMs) {
        effectiveStartMs = checkInDate.getTime();
      }
    }

    // Handle early check-out if present in attendance
    if (att?.checkOutTime) {
      const checkOutDate = att.checkOutTime.includes('T')
        ? parseDate(att.checkOutTime)
        : createBangladeshTimestamp(dateStr, att.checkOutTime);
      if (!isNaN(checkOutDate.getTime()) && checkOutDate.getTime() < effectiveEndMs) {
        effectiveEndMs = checkOutDate.getTime();
      }
    }

    // If checked out without an explicit checkOutTime timestamp, treat as checked out now (or zero interval if strictly off duty)
    if (attStatus === 'CHECKED_OUT' && !att?.checkOutTime) {
      effectiveEndMs = Math.min(effectiveEndMs, Date.now());
    }

    if (effectiveEndMs > effectiveStartMs) {
      intervals.push({
        startMs: effectiveStartMs,
        endMs: effectiveEndMs,
        type: 'NORMAL',
        dateStr,
        shiftCode: dayShift.code
      });
    }
  }

  // 3. Approved Overtime Intervals for this day
  const approvedOvertimes = overtimeRequests.filter(ot => {
    if (ot.status !== 'APPROVED') return false;
    const matchTech = String(ot.technicianId || '').trim() === String(technicianId || '').trim();
    if (!matchTech) return false;
    if (taskId && ot.taskId && String(ot.taskId).trim() !== String(taskId).trim()) return false;
    
    // Check if start time or end time falls on this dateStr in BD time
    const otDate = getBangladeshDateTime(ot.startTime).dateStr;
    return otDate === dateStr;
  });

  for (const ot of approvedOvertimes) {
    const otStart = parseDate(ot.startTime);
    const otEnd = parseDate(ot.endTime);
    if (!isNaN(otStart.getTime()) && !isNaN(otEnd.getTime()) && otEnd.getTime() > otStart.getTime()) {
      intervals.push({
        startMs: otStart.getTime(),
        endMs: otEnd.getTime(),
        type: 'OVERTIME',
        dateStr,
        shiftCode: shift.code
      });
    }
  }

  return intervals;
}

/**
 * Calculates total hold intervals in milliseconds overlapping with a time range
 */
export function getHoldIntervals(task: Task): Array<{ startMs: number; endMs: number }> {
  const holdIntervals: Array<{ startMs: number; endMs: number }> = [];

  if (Array.isArray(task.holdHistory)) {
    for (const h of task.holdHistory) {
      const hStart = parseDate(h.holdStart).getTime();
      const hEnd = h.holdEnd ? parseDate(h.holdEnd).getTime() : (task.status === 'HOLD' ? Date.now() : hStart);
      if (!isNaN(hStart) && !isNaN(hEnd) && hEnd > hStart) {
        holdIntervals.push({ startMs: hStart, endMs: hEnd });
      }
    }
  }

  // If currently in HOLD and not closed in history
  if (task.status === 'HOLD' && task.currentHoldStartTime) {
    const hStart = parseDate(task.currentHoldStartTime).getTime();
    if (!isNaN(hStart)) {
      const existing = holdIntervals.find(i => Math.abs(i.startMs - hStart) < 1000);
      if (!existing) {
        holdIntervals.push({ startMs: hStart, endMs: Date.now() });
      }
    }
  }

  return holdIntervals;
}

export interface TaskWorkingIntervalBreakdown {
  date: string;
  shiftCode: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  type: 'NORMAL' | 'OVERTIME';
  isApprovedOvertime: boolean;
}

export interface TaskWorkingTimeResult {
  accumulatedWorkingMinutes: number;
  accumulatedWorkingMs: number;
  accumulatedOvertimeMinutes: number;
  approvedOvertimeMinutes: number;
  remainingMinutes: number;
  overTimeMinutes: number;
  estimatedMinutes: number;
  originalEstimatedMinutes: number;
  revisedEstimatedMinutes: number;
  progressPercent: number;
  timerStatus: 'RUNNING' | 'PAUSED_SHIFT_END' | 'RESUMED' | 'OVERTIME_PENDING' | 'OVERTIME_APPROVED' | 'TIME_EXCEEDED' | 'COMPLETED' | 'HOLD';
  statusExplanation: string;
  isWithinActiveShift: boolean;
  hasActiveOvertime: boolean;
  hasPendingOvertime: boolean;
  isTimeExceeded: boolean;
  activeShift: ShiftConfiguration;
  sessionsCount: number;
  breakdown: TaskWorkingIntervalBreakdown[];
}

/**
 * CORE ATTENDANCE-BASED WORKING TIME CALCULATION ENGINE
 * 
 * Accurately calculates eligible working time across multiple days, accounting for:
 * - Specific duty shifts per technician
 * - Daily attendance checks
 * - Multi-day shift pauses and automatic resumes
 * - Supervisor-approved overtime
 * - Manual task holds
 * - Real-time progress and remaining time
 */
export function calculateTaskWorkingTime(
  task: Task,
  options: {
    now?: Date | string | number;
    attendanceRecords?: Attendance[];
    overtimeRequests?: OvertimeRequest[];
    shiftAssignments?: TechnicianShiftAssignment[];
    shifts?: ShiftConfiguration[];
    technicians?: Array<{ id?: string; employeeId: string; name?: string }>;
  } = {}
): TaskWorkingTimeResult {
  const refTime = options.now ? parseDate(options.now) : new Date();
  const refNowMs = !isNaN(refTime.getTime()) ? refTime.getTime() : Date.now();

  const attendanceRecords = options.attendanceRecords || [];
  const overtimeRequests = options.overtimeRequests || [];
  const shiftAssignments = options.shiftAssignments || [];
  const shifts = options.shifts || DEFAULT_SHIFTS;

  // Determine canonical technician employeeId
  let rawTechRef = String(task.assignedTo || '').trim();
  if (task.workType === 'TEAM' && Array.isArray(task.assignedTechnicians) && task.assignedTechnicians.length > 0) {
    rawTechRef = String(task.assignedTechnicians[0].employeeId || task.assignedTechnicians[0].name || '').trim();
  }
  let technicianId = rawTechRef;
  if (rawTechRef && Array.isArray(options.technicians) && options.technicians.length > 0) {
    const matchedTech = options.technicians.find(u =>
      String(u.employeeId || '').trim().toLowerCase() === rawTechRef.toLowerCase() ||
      String(u.id || '').trim() === rawTechRef ||
      String(u.name || '').trim().toLowerCase() === rawTechRef.toLowerCase()
    );
    if (matchedTech?.employeeId) {
      technicianId = String(matchedTech.employeeId).trim();
    }
  }

  // Parse task start timestamp
  const startRaw = task.customStartTime || task.startedAt || task.createdAt;
  const startDate = parseDate(startRaw);
  const taskStartMs = !isNaN(startDate.getTime()) ? startDate.getTime() : refNowMs;

  // Parse task end timestamp if COMPLETED
  let taskEndMs = refNowMs;
  if (task.status === 'COMPLETED') {
    const endRaw = task.actualCompletionTime || task.completedAt || refTime;
    const endDate = parseDate(endRaw);
    if (!isNaN(endDate.getTime())) {
      taskEndMs = endDate.getTime();
    }
  }

  // Durations
  const originalEstimatedMinutes = parseDurationToMinutes(task.originalEstimatedDuration || task.estimatedDuration);
  const revisedEstimatedMinutes = parseDurationToMinutes(task.revisedEstimatedDuration || task.estimatedDuration || originalEstimatedMinutes);
  const estimatedMinutes = revisedEstimatedMinutes;

  // Sum total approved overtime minutes on this task
  const approvedOvertimeMinutes = overtimeRequests
    .filter(ot => ot.status === 'APPROVED' && String(ot.taskId || '').trim() === String(task.id).trim())
    .reduce((sum, ot) => sum + (Number(ot.approvedDurationMinutes ?? ot.durationMinutes) || 0), 0);

  // If task hasn't started yet or is PENDING/REJECTED/REQUESTED
  if (['PENDING', 'REQUESTED', 'REJECTED'].includes(task.status) && task.requestStatus !== 'RECOMMENDED') {
    const todayDateStr = getBangladeshDateTime(new Date(refNowMs)).dateStr;
    const { shift: assignedShift } = getTechnicianShiftForDate(technicianId, todayDateStr, shiftAssignments, shifts);
    return {
      accumulatedWorkingMinutes: 0,
      accumulatedWorkingMs: 0,
      accumulatedOvertimeMinutes: 0,
      approvedOvertimeMinutes,
      remainingMinutes: estimatedMinutes,
      overTimeMinutes: 0,
      estimatedMinutes,
      originalEstimatedMinutes,
      revisedEstimatedMinutes,
      progressPercent: 0,
      timerStatus: 'HOLD',
      statusExplanation: 'Task not started yet or awaiting approval',
      isWithinActiveShift: false,
      hasActiveOvertime: false,
      hasPendingOvertime: false,
      isTimeExceeded: false,
      activeShift: assignedShift,
      sessionsCount: 0,
      breakdown: []
    };
  }

  // Get hold intervals
  const holdIntervals = getHoldIntervals(task);

  // Iterate day by day from taskStart to taskEnd
  const startBD = getBangladeshDateTime(new Date(taskStartMs));
  const endBD = getBangladeshDateTime(new Date(taskEndMs));

  let currentLoopDate = createBangladeshTimestamp(startBD.dateStr, '00:00');
  const finalLoopDate = createBangladeshTimestamp(endBD.dateStr, '23:59');

  let totalWorkingMs = 0;
  let totalOvertimeMs = 0;
  let totalIntervalsCount = 0;
  const breakdown: TaskWorkingIntervalBreakdown[] = [];

  while (currentLoopDate.getTime() <= finalLoopDate.getTime()) {
    const currentBD = getBangladeshDateTime(currentLoopDate);
    const dateStr = currentBD.dateStr;

    // Get eligible intervals on this date
    const dayIntervals = getEligibleIntervalsForDay(
      technicianId,
      dateStr,
      attendanceRecords,
      overtimeRequests,
      shiftAssignments,
      shifts,
      task.id
    );

    for (const interval of dayIntervals) {
      // Intersection of [taskStartMs, taskEndMs] with [interval.startMs, interval.endMs]
      const effectiveStart = Math.max(taskStartMs, interval.startMs);
      const effectiveEnd = Math.min(taskEndMs, interval.endMs);

      if (effectiveEnd > effectiveStart) {
        let intervalWorkMs = effectiveEnd - effectiveStart;

        // Subtract any overlapping HOLD intervals
        for (const hold of holdIntervals) {
          const holdOverlapStart = Math.max(effectiveStart, hold.startMs);
          const holdOverlapEnd = Math.min(effectiveEnd, hold.endMs);
          if (holdOverlapEnd > holdOverlapStart) {
            intervalWorkMs -= (holdOverlapEnd - holdOverlapStart);
          }
        }

        if (intervalWorkMs > 0) {
          totalWorkingMs += intervalWorkMs;
          if (interval.type === 'OVERTIME') {
            totalOvertimeMs += intervalWorkMs;
          }
          totalIntervalsCount++;
          breakdown.push({
            date: dateStr,
            shiftCode: interval.shiftCode,
            startTime: getBangladeshDateTime(effectiveStart).timeStr,
            endTime: getBangladeshDateTime(effectiveEnd).timeStr,
            durationMinutes: Math.floor(intervalWorkMs / (60 * 1000)),
            type: interval.type,
            isApprovedOvertime: interval.type === 'OVERTIME'
          });
        }
      }
    }

    // Advance by 1 calendar day (24 hours)
    currentLoopDate = new Date(currentLoopDate.getTime() + (24 * 60 * 60 * 1000));
  }

  const accumulatedWorkingMinutes = Math.floor(totalWorkingMs / (60 * 1000));
  const accumulatedOvertimeMinutes = Math.floor(totalOvertimeMs / (60 * 1000));

  // Determine current active shift and interval at refNowMs
  const todayBD = getBangladeshDateTime(new Date(refNowMs));
  const todayDateStr = todayBD.dateStr;
  const { shift: activeShift, isWeeklyOff } = getTechnicianShiftForDate(technicianId, todayDateStr, shiftAssignments, shifts);

  const todayIntervals = getEligibleIntervalsForDay(
    technicianId,
    todayDateStr,
    attendanceRecords,
    overtimeRequests,
    shiftAssignments,
    shifts,
    task.id
  );

  const currentActiveInterval = todayIntervals.find(i => refNowMs >= i.startMs && refNowMs < i.endMs);
  const isWithinActiveShift = !!currentActiveInterval && currentActiveInterval.type === 'NORMAL';
  const hasActiveOvertime = !!currentActiveInterval && currentActiveInterval.type === 'OVERTIME';

  // Check if there is a pending overtime request for this task today
  const hasPendingOvertime = overtimeRequests.some(ot => 
    ot.status === 'PENDING' &&
    String(ot.technicianId || '').trim() === String(technicianId).trim() &&
    String(ot.taskId || '').trim() === String(task.id).trim()
  );

  // Remaining and Overtime
  const remainingMinutes = Math.max(0, estimatedMinutes - accumulatedWorkingMinutes);
  const overTimeMinutes = Math.max(0, accumulatedWorkingMinutes - estimatedMinutes);
  const isTimeExceeded = accumulatedWorkingMinutes > estimatedMinutes;

  // Determine intelligent timer status
  let timerStatus: TaskWorkingTimeResult['timerStatus'] = 'RUNNING';
  let statusExplanation = 'Active: Working within duty shift';

  if (task.status === 'COMPLETED') {
    timerStatus = 'COMPLETED';
    statusExplanation = `Completed in ${formatMinutes(accumulatedWorkingMinutes)} (Estimated: ${formatMinutes(estimatedMinutes)})`;
  } else if (task.status === 'HOLD') {
    timerStatus = 'HOLD';
    statusExplanation = 'Task is currently ON HOLD by supervisor';
  } else if (hasActiveOvertime) {
    timerStatus = 'OVERTIME_APPROVED';
    statusExplanation = `🟣 Overtime Active: Approved working period until ${getBangladeshDateTime(currentActiveInterval.endMs).timeStr}`;
  } else if (hasPendingOvertime) {
    timerStatus = 'OVERTIME_PENDING';
    statusExplanation = '🟠 Overtime Pending: Awaiting supervisor approval';
  } else if (isTimeExceeded) {
    timerStatus = 'TIME_EXCEEDED';
    statusExplanation = `🔴 Time Exceeded: Exceeded estimated duration by ${formatMinutes(overTimeMinutes)}. Supervisor extension available.`;
  } else if (!isWithinActiveShift) {
    timerStatus = 'PAUSED_SHIFT_END';
    if (isWeeklyOff) {
      statusExplanation = '🟡 Paused: Weekly Holiday / Off-Duty Day';
    } else {
      statusExplanation = `🟡 Auto-Paused: Outside active shift (${activeShift.startTime} – ${activeShift.endTime}). Resumes on next check-in.`;
    }
  } else if (totalIntervalsCount > 1) {
    timerStatus = 'RESUMED';
    statusExplanation = `🔵 Resumed Multi-Day Task: Continuing within ${activeShift.name} (Day ${totalIntervalsCount})`;
  } else {
    timerStatus = 'RUNNING';
    statusExplanation = `🟢 Running: Within ${activeShift.name}`;
  }

  const progressPercent = Math.min(100, Math.round((accumulatedWorkingMinutes / estimatedMinutes) * 100));

  return {
    accumulatedWorkingMinutes,
    accumulatedWorkingMs: totalWorkingMs,
    accumulatedOvertimeMinutes,
    approvedOvertimeMinutes,
    remainingMinutes,
    overTimeMinutes,
    estimatedMinutes,
    originalEstimatedMinutes,
    revisedEstimatedMinutes,
    progressPercent: task.status === 'COMPLETED' ? 100 : progressPercent,
    timerStatus,
    statusExplanation,
    isWithinActiveShift,
    hasActiveOvertime,
    hasPendingOvertime,
    isTimeExceeded,
    activeShift,
    sessionsCount: totalIntervalsCount,
    breakdown
  };
}

/**
 * Calculates advanced multi-metric performance score based on:
 * - Time Efficiency (30%)
 * - Task Completion Rate (25%)
 * - Quality & Rework Rate (25%)
 * - On-Time Completion (10%)
 * - Supervisor Evaluation (10%)
 */
export function calculatePerformanceScore(
  stats: {
    estimatedMinutes: number;
    actualMinutes: number;
    completedTasksCount: number;
    totalAssignedTasksCount: number;
    averageQualityRating?: number; // 1 to 5 scale
    reworkCount?: number;
    onTimeTasksCount: number;
    supervisorRating?: number; // 1 to 5 scale or 0-100
  },
  config: PerformanceConfig = DEFAULT_PERFORMANCE_CONFIG
) {
  // 1. Time Efficiency (Capped at 200% to prevent unfair skewing)
  const estMins = Math.max(1, stats.estimatedMinutes);
  const actMins = Math.max(1, stats.actualMinutes);
  const rawEfficiency = (estMins / actMins) * 100;
  const timeEfficiencyScore = Math.min(200, Math.max(0, rawEfficiency));

  // 2. Task Completion Rate (0 - 100%)
  const totalTasks = Math.max(1, stats.totalAssignedTasksCount);
  const completionRate = Math.min(100, Math.max(0, (stats.completedTasksCount / totalTasks) * 100));

  // 3. Quality & Rework (0 - 100%)
  // Default 5-star is 100%. Each rework deducts 15%.
  const baseQuality = stats.averageQualityRating ? (stats.averageQualityRating / 5) * 100 : 85;
  const reworkPenalty = (stats.reworkCount || 0) * 15;
  const qualityScore = Math.max(0, Math.min(100, baseQuality - reworkPenalty));

  // 4. On-Time Completion Rate (0 - 100%)
  const completedTasks = Math.max(1, stats.completedTasksCount);
  const onTimeRate = Math.min(100, Math.max(0, (stats.onTimeTasksCount / completedTasks) * 100));

  // 5. Supervisor Evaluation (0 - 100%)
  let supervisorScore = 90; // Default good rating
  if (stats.supervisorRating !== undefined) {
    supervisorScore = stats.supervisorRating <= 5 
      ? (stats.supervisorRating / 5) * 100 
      : Math.min(100, stats.supervisorRating);
  }

  // Composite Weighted Score
  const totalWeight = config.timeEfficiencyWeight + 
                      config.taskCompletionWeight + 
                      config.qualityWeight + 
                      config.onTimeCompletionWeight + 
                      config.supervisorEvalWeight;

  const weightedScore = (
    (timeEfficiencyScore * (config.timeEfficiencyWeight / totalWeight)) +
    (completionRate * (config.taskCompletionWeight / totalWeight)) +
    (qualityScore * (config.qualityWeight / totalWeight)) +
    (onTimeRate * (config.onTimeCompletionWeight / totalWeight)) +
    (supervisorScore * (config.supervisorEvalWeight / totalWeight))
  );

  return {
    compositeScore: Math.round(weightedScore * 10) / 10,
    timeEfficiencyScore: Math.round(timeEfficiencyScore * 10) / 10,
    completionRate: Math.round(completionRate * 10) / 10,
    qualityScore: Math.round(qualityScore * 10) / 10,
    onTimeRate: Math.round(onTimeRate * 10) / 10,
    supervisorScore: Math.round(supervisorScore * 10) / 10
  };
}
