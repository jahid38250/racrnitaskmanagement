import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { 
  X, 
  Clock, 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  User, 
  Calendar,
  Zap,
  Info
} from 'lucide-react';
import { Task, OvertimeRequest } from './types';
import { formatMinutes } from './workingTimeEngine';
import { toast } from 'sonner';

interface OvertimeModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: Task | null;
  token: string;
  userRole?: string;
  userName?: string;
  userEmployeeId?: string;
  onOvertimeUpdated?: () => void;
}

export const OvertimeModal: React.FC<OvertimeModalProps> = ({
  isOpen,
  onClose,
  task,
  token,
  userRole,
  userName,
  userEmployeeId,
  onOvertimeUpdated
}) => {
  const [requests, setRequests] = useState<OvertimeRequest[]>([]);
  const [durationMinutes, setDurationMinutes] = useState(120); // 2 hours default
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const isSupervisor = ['SUPER_ADMIN', 'CBO', 'DCBO', 'HOD', 'DHOD', 'IN_CHARGE', 'MODEL_MANAGER', 'OFFICER', 'ENGINEER'].includes(userRole || '');

  const fetchOvertimeRequests = async () => {
    if (!task) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/overtime?taskId=${task.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setRequests(data);
      }
    } catch (err: any) {
      console.error('Error fetching overtime:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && task) {
      fetchOvertimeRequests();
    }
  }, [isOpen, task]);

  const handleRequestOvertime = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!task) return;
    if (!reason.trim()) {
      toast.error('Please provide an overtime justification reason');
      return;
    }

    try {
      const res = await fetch('/api/overtime/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          taskId: task.id,
          technicianId: userRole === 'TECHNICIAN' ? userEmployeeId : task.assignedTo,
          durationMinutes: Number(durationMinutes),
          reason: reason.trim(),
          autoApprove: isSupervisor // Instant approval if submitted directly by supervisor
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to request overtime');
      }

      toast.success(isSupervisor ? 'Overtime approved and timer extended!' : 'Overtime request submitted for supervisor approval');
      setReason('');
      fetchOvertimeRequests();
      if (onOvertimeUpdated) onOvertimeUpdated();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleApprove = async (id: string, approvedDuration?: number) => {
    try {
      const res = await fetch(`/api/overtime/${id}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          approvedDurationMinutes: approvedDuration
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to approve overtime');
      }

      toast.success('Overtime approved. Task timer resumed!');
      fetchOvertimeRequests();
      if (onOvertimeUpdated) onOvertimeUpdated();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleReject = async (id: string) => {
    try {
      const res = await fetch(`/api/overtime/${id}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ reason: rejectReason.trim() || 'Rejected by supervisor' })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to reject overtime');
      }

      toast.info('Overtime rejected.');
      setRejectingId(null);
      setRejectReason('');
      fetchOvertimeRequests();
      if (onOvertimeUpdated) onOvertimeUpdated();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  if (!isOpen || !task) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-2xl bg-slate-900 border border-white/20 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10 bg-slate-800/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-purple-500/20 text-purple-400 border border-purple-500/30">
              <Zap className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Supervisor Overtime Management</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Task #{task.taskId || task.id} • {task.title}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto custom-scrollbar space-y-6">
          {/* Overtime Request Form */}
          <form onSubmit={handleRequestOvertime} className="p-4 rounded-xl bg-slate-800/40 border border-white/10 space-y-4">
            <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2">
              <Clock className="w-4 h-4 text-purple-400" />
              {isSupervisor ? 'Grant Approved Overtime' : 'Request Overtime Work Extension'}
            </h3>

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block text-gray-400 mb-1">Overtime Duration</label>
                <select
                  value={durationMinutes}
                  onChange={e => setDurationMinutes(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-white font-mono"
                >
                  <option value={30}>30 Minutes (0.5 Hour)</option>
                  <option value={60}>60 Minutes (1 Hour)</option>
                  <option value={90}>90 Minutes (1.5 Hours)</option>
                  <option value={120}>120 Minutes (2 Hours)</option>
                  <option value={180}>180 Minutes (3 Hours)</option>
                  <option value={240}>240 Minutes (4 Hours)</option>
                </select>
              </div>

              <div>
                <label className="block text-gray-400 mb-1">Target Assignee</label>
                <input
                  type="text"
                  disabled
                  value={task.assignedTo || 'Unassigned'}
                  className="w-full bg-slate-900/60 border border-white/5 rounded-lg px-3 py-2 text-gray-400 text-xs"
                />
              </div>
            </div>

            <div>
              <label className="block text-gray-400 text-xs mb-1">
                Overtime Justification / Remaining Workload
              </label>
              <textarea
                required
                rows={2}
                placeholder="Explain the critical testing or calibration that requires extended working hours..."
                value={reason}
                onChange={e => setReason(e.target.value)}
                className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-white text-xs"
              />
            </div>

            <button
              type="submit"
              className="w-full py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs transition-colors flex items-center justify-center gap-2"
            >
              <Zap className="w-4 h-4" />
              <span>{isSupervisor ? 'Grant & Authorize Overtime' : 'Submit Overtime Request'}</span>
            </button>
          </form>

          {/* Overtime History & Pending Approvals */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider">
              Overtime Approval History ({requests.length})
            </h3>

            {requests.length === 0 ? (
              <p className="text-xs text-gray-500 italic text-center py-4">
                No overtime requests logged for this task yet.
              </p>
            ) : (
              <div className="space-y-3">
                {requests.map(r => (
                  <div
                    key={r.id}
                    className="p-4 rounded-xl bg-white/5 border border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                          r.status === 'APPROVED'
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                            : r.status === 'REJECTED'
                            ? 'bg-red-500/20 text-red-300 border-red-500/30'
                            : 'bg-orange-500/20 text-orange-300 border-orange-500/30'
                        }`}>
                          {r.status}
                        </span>
                        <span className="font-bold text-white text-sm">
                          +{formatMinutes(r.approvedDurationMinutes || r.durationMinutes)}
                        </span>
                        <span className="text-gray-400 font-mono">({r.date})</span>
                      </div>
                      <p className="text-gray-300">{r.reason}</p>
                      <div className="text-[10px] text-gray-500 flex items-center gap-3">
                        <span>Requested by: {r.requestedBy || userName || 'Staff'}</span>
                        {r.approvedBy && <span>Approved by: {r.approvedBy}</span>}
                      </div>
                    </div>

                    {/* Supervisor Approval Actions */}
                    {isSupervisor && r.status === 'PENDING' && (
                      <div className="flex flex-col gap-2 shrink-0">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleApprove(r.id)}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-1 transition-colors"
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                            <span>Approve</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRejectingId(rejectingId === r.id ? null : r.id);
                              setRejectReason('');
                            }}
                            className="px-3 py-1.5 rounded-lg bg-red-600/30 hover:bg-red-600/40 text-red-300 border border-red-500/40 font-bold flex items-center gap-1 transition-colors"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Reject</span>
                          </button>
                        </div>
                        {rejectingId === r.id && (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={rejectReason}
                              onChange={e => setRejectReason(e.target.value)}
                              placeholder="Reason..."
                              className="bg-slate-900 border border-white/15 rounded px-2 py-1 text-[11px] text-white"
                            />
                            <button
                              type="button"
                              onClick={() => handleReject(r.id)}
                              className="px-2 py-1 rounded bg-red-600 text-white font-bold text-[10px]"
                            >
                              Confirm
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
};
