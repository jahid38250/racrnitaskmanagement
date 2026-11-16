import React, { useState, useEffect, useContext } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Clock, 
  Play, 
  Pause, 
  AlertTriangle, 
  CheckCircle2, 
  PlusCircle, 
  Calendar, 
  Zap, 
  Info,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { 
  Task, 
  Attendance, 
  OvertimeRequest, 
  TechnicianShiftAssignment, 
  ShiftConfiguration 
} from './types';
import { 
  formatMinutes, 
  calculateTaskWorkingTime,
  DEFAULT_SHIFTS 
} from './workingTimeEngine';

export interface TaskTimerContextValue {
  attendanceRecords: Attendance[];
  overtimeRequests: OvertimeRequest[];
  shiftAssignments: TechnicianShiftAssignment[];
  shifts: ShiftConfiguration[];
  technicians?: Array<{ id?: string; employeeId: string; name?: string }>;
  userRole?: string;
  onOpenOvertime?: (task: Task) => void;
  onOpenExtension?: (task: Task) => void;
}

export const TaskTimerContext = React.createContext<TaskTimerContextValue>({
  attendanceRecords: [],
  overtimeRequests: [],
  shiftAssignments: [],
  shifts: DEFAULT_SHIFTS,
  technicians: []
});

interface SmartTaskTimerProps {
  task: Task;
  userRole?: string;
  attendanceRecords?: Attendance[];
  overtimeRequests?: OvertimeRequest[];
  shiftAssignments?: TechnicianShiftAssignment[];
  shifts?: ShiftConfiguration[];
  technicians?: Array<{ id?: string; employeeId: string; name?: string }>;
  onOpenOvertime?: (task: Task) => void;
  onOpenExtension?: (task: Task) => void;
  compact?: boolean;
}

export const SmartTaskTimer: React.FC<SmartTaskTimerProps> = ({
  task,
  userRole,
  attendanceRecords,
  overtimeRequests,
  shiftAssignments,
  shifts,
  technicians,
  onOpenOvertime,
  onOpenExtension,
  compact = false
}) => {
  const ctx = useContext(TaskTimerContext);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [, setTick] = useState(0);

  const effectiveRole = userRole ?? ctx.userRole;
  const effectiveAttendance = attendanceRecords ?? ctx.attendanceRecords;
  const effectiveOvertime = overtimeRequests ?? ctx.overtimeRequests;
  const effectiveAssignments = shiftAssignments ?? ctx.shiftAssignments;
  const effectiveShifts = (shifts && shifts.length > 0 ? shifts : ctx.shifts) || DEFAULT_SHIFTS;
  const effectiveTechnicians = technicians ?? ctx.technicians;
  const effectiveOpenOvertime = onOpenOvertime ?? ctx.onOpenOvertime;
  const effectiveOpenExtension = onOpenExtension ?? ctx.onOpenExtension;

  // Live timer tick for active tasks
  useEffect(() => {
    const isCompleted = (task.status || '').toUpperCase() === 'COMPLETED';
    const isHold = (task.status || '').toUpperCase() === 'HOLD';
    const isRunning = (task.status || '').toUpperCase() === 'RUNNING';

    if (isCompleted || isHold || !isRunning) {
      return;
    }

    const interval = setInterval(() => {
      setTick(t => t + 1);
    }, 10000); // Update UI every 10s cleanly

    return () => clearInterval(interval);
  }, [task.status]);

  // Compute timing using canonical workingTimeEngine signature
  const timing = calculateTaskWorkingTime(task, {
    now: new Date(),
    attendanceRecords: effectiveAttendance,
    overtimeRequests: effectiveOvertime,
    shiftAssignments: effectiveAssignments,
    shifts: effectiveShifts,
    technicians: effectiveTechnicians
  });

  const workingTimeStr = formatMinutes(timing.accumulatedWorkingMinutes);
  const estimatedTimeStr = formatMinutes(timing.estimatedMinutes);
  const remainingTimeStr = formatMinutes(timing.remainingMinutes);
  const overTimeStr = formatMinutes(timing.overTimeMinutes);
  const shiftCodeLabel = (timing.activeShift?.code || task.assignedShiftCode || 'SHIFT_B').replace('SHIFT_', 'Shift ');

  // Determine badge styling based on timerStatus
  const getBadgeConfig = () => {
    switch (timing.timerStatus) {
      case 'RUNNING':
        return {
          icon: Play,
          text: 'RUNNING',
          bg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
          dot: 'bg-emerald-400 animate-ping',
          color: 'bg-emerald-500'
        };
      case 'PAUSED_SHIFT_END':
        return {
          icon: Pause,
          text: 'PAUSED – SHIFT ENDED',
          bg: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
          dot: 'bg-amber-400',
          color: 'bg-amber-500'
        };
      case 'HOLD':
        return {
          icon: Pause,
          text: 'ON HOLD',
          bg: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
          dot: 'bg-amber-400',
          color: 'bg-amber-500'
        };
      case 'RESUMED':
        return {
          icon: Zap,
          text: 'RESUMED',
          bg: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
          dot: 'bg-blue-400 animate-pulse',
          color: 'bg-blue-500'
        };
      case 'OVERTIME_PENDING':
        return {
          icon: Clock,
          text: 'OVERTIME PENDING',
          bg: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
          dot: 'bg-orange-400 animate-pulse',
          color: 'bg-orange-500'
        };
      case 'OVERTIME_APPROVED':
        return {
          icon: Zap,
          text: 'OVERTIME APPROVED',
          bg: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
          dot: 'bg-purple-400 animate-ping',
          color: 'bg-purple-500'
        };
      case 'TIME_EXCEEDED':
        return {
          icon: AlertTriangle,
          text: 'TIME EXCEEDED',
          bg: 'bg-red-500/20 text-red-400 border-red-500/40 animate-pulse',
          dot: 'bg-red-500',
          color: 'bg-red-500'
        };
      case 'COMPLETED':
      default:
        return {
          icon: CheckCircle2,
          text: 'COMPLETED',
          bg: 'bg-gray-500/15 text-gray-300 border-gray-500/30',
          dot: 'bg-gray-400',
          color: 'bg-gray-500'
        };
    }
  };

  const badge = getBadgeConfig();
  const isSupervisor = ['SUPER_ADMIN', 'CBO', 'DCBO', 'HOD', 'DHOD', 'IN_CHARGE', 'MODEL_MANAGER', 'OFFICER', 'ENGINEER'].includes(effectiveRole || '');

  if (compact) {
    return (
      <div className="space-y-1.5 w-full">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold border ${badge.bg}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
            {badge.text}
          </span>
          <span className="font-mono text-gray-300 text-[11px] font-semibold">
            {workingTimeStr} / {estimatedTimeStr}
          </span>
        </div>
        <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
          <motion.div 
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(100, timing.progressPercent)}%` }}
            className={`h-full ${badge.color} transition-all duration-500`}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 bg-slate-900/60 p-3.5 rounded-xl border border-white/10 backdrop-blur-md">
      {/* Header with Status Badge and Shift Info */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold border ${badge.bg}`}>
            <span className={`w-2 h-2 rounded-full ${badge.dot}`} />
            <badge.icon className="w-3.5 h-3.5" />
            {badge.text}
          </span>
          <span className="text-[10px] text-gray-400 font-mono bg-white/5 px-2 py-1 rounded border border-white/5">
            {shiftCodeLabel}
          </span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1.5">
          {effectiveOpenOvertime && timing.timerStatus !== 'COMPLETED' && (
            <button
              type="button"
              onClick={() => effectiveOpenOvertime(task)}
              className="text-[11px] px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 flex items-center gap-1 transition-colors cursor-pointer"
              title="Request or Approve Overtime"
            >
              <Clock className="w-3 h-3" />
              <span>OT</span>
            </button>
          )}

          {isSupervisor && effectiveOpenExtension && timing.timerStatus !== 'COMPLETED' && (
            <button
              type="button"
              onClick={() => effectiveOpenExtension(task)}
              className={`text-[11px] px-2 py-1 rounded flex items-center gap-1 border transition-colors cursor-pointer ${
                timing.isTimeExceeded 
                  ? 'bg-red-500/25 hover:bg-red-500/35 text-red-300 border-red-500/40 animate-pulse' 
                  : 'bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border-blue-500/30'
              }`}
              title="Extend Estimated Working Duration"
            >
              <PlusCircle className="w-3 h-3" />
              <span>Extend</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowBreakdown(!showBreakdown)}
            className="text-[11px] px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white flex items-center gap-1 border border-white/5 transition-colors cursor-pointer"
            title="View Working Intervals Breakdown"
          >
            {showBreakdown ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* Time Metrics Grid */}
      <div className="grid grid-cols-3 gap-2 text-center bg-black/20 p-2 rounded-lg border border-white/5">
        <div>
          <p className="text-[10px] text-gray-400 uppercase tracking-wider">Working Time</p>
          <p className="font-mono text-sm font-bold text-white mt-0.5">{workingTimeStr}</p>
        </div>
        <div>
          <p className="text-[10px] text-gray-400 uppercase tracking-wider">Estimated</p>
          <p className="font-mono text-sm font-bold text-blue-300 mt-0.5">{estimatedTimeStr}</p>
        </div>
        <div>
          <p className="text-[10px] text-gray-400 uppercase tracking-wider">
            {timing.isTimeExceeded ? 'Exceeded' : 'Remaining'}
          </p>
          <p className={`font-mono text-sm font-bold mt-0.5 ${timing.isTimeExceeded ? 'text-red-400' : 'text-emerald-400'}`}>
            {timing.isTimeExceeded ? `+${overTimeStr}` : remainingTimeStr}
          </p>
        </div>
      </div>

      {/* Approved Overtime Banner (if any) */}
      {timing.approvedOvertimeMinutes > 0 && (
        <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-xs">
          <span className="text-purple-300 flex items-center gap-1.5 font-medium">
            <Zap className="w-3.5 h-3.5 text-purple-400" />
            Approved Overtime: +{formatMinutes(timing.approvedOvertimeMinutes)}
          </span>
          <span className="text-purple-300/80 font-mono text-[11px]">
            Accumulated: {formatMinutes(timing.accumulatedOvertimeMinutes)}
          </span>
        </div>
      )}

      {/* Progress Bar */}
      <div className="space-y-1">
        <div className="flex justify-between items-center text-[10px] text-gray-400 font-mono">
          <span>Working Progress</span>
          <span className={timing.isTimeExceeded ? 'text-red-400 font-bold' : 'text-gray-300'}>
            {timing.progressPercent}%
          </span>
        </div>
        <div className="w-full bg-white/10 h-2 rounded-full overflow-hidden">
          <motion.div 
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(100, timing.progressPercent)}%` }}
            className={`h-full ${badge.color} transition-all duration-500`}
          />
        </div>
      </div>

      {/* Contextual Explanation Banner */}
      {timing.statusExplanation && (
        <div className={`p-2 rounded-lg text-[11px] flex items-start gap-2 border leading-relaxed ${
          timing.timerStatus === 'TIME_EXCEEDED'
            ? 'bg-red-500/10 border-red-500/20 text-red-200'
            : timing.timerStatus === 'PAUSED_SHIFT_END' || timing.timerStatus === 'HOLD'
            ? 'bg-amber-500/10 border-amber-500/20 text-amber-200'
            : timing.timerStatus === 'OVERTIME_APPROVED'
            ? 'bg-purple-500/10 border-purple-500/20 text-purple-200'
            : 'bg-blue-500/10 border-blue-500/20 text-blue-200'
        }`}>
          <Info className="w-4 h-4 shrink-0 mt-0.5 opacity-80" />
          <span>{timing.statusExplanation}</span>
        </div>
      )}

      {/* Expandable Breakdown of Daily Intervals */}
      <AnimatePresence>
        {showBreakdown && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden border-t border-white/10 pt-2.5 space-y-2"
          >
            <p className="text-[11px] font-bold text-gray-300 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-blue-400" />
              Eligible Working Intervals Log ({timing.breakdown.length}):
            </p>
            {timing.breakdown.length === 0 ? (
              <p className="text-[10px] text-gray-500 italic">No working intervals accumulated yet.</p>
            ) : (
              <div className="space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar">
                {timing.breakdown.map((b, idx) => (
                  <div key={idx} className="flex justify-between items-center text-[10px] bg-white/5 px-2 py-1 rounded">
                    <div>
                      <span className="font-semibold text-gray-200">{b.date}</span>
                      <span className="text-gray-400 ml-1.5">({b.shiftCode.replace('SHIFT_', 'Shift ')})</span>
                      {b.isApprovedOvertime && (
                        <span className="ml-1.5 px-1 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 font-bold">
                          OT
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-gray-300">
                      <span>{b.startTime} - {b.endTime}</span>
                      <span className="text-emerald-400 font-bold ml-2">+{formatMinutes(b.durationMinutes)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
