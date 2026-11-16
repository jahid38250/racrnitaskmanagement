import React, { useState } from 'react';
import { motion } from 'motion/react';
import { 
  X, 
  Clock, 
  PlusCircle, 
  AlertTriangle, 
  History, 
  CheckCircle2 
} from 'lucide-react';
import { Task } from './types';
import { formatMinutes } from './workingTimeEngine';
import { toast } from 'sonner';

interface TimeExtensionModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: Task | null;
  token: string;
  onExtended?: (updatedTask: Task) => void;
}

export const TimeExtensionModal: React.FC<TimeExtensionModalProps> = ({
  isOpen,
  onClose,
  task,
  token,
  onExtended
}) => {
  const [additionalMinutes, setAdditionalMinutes] = useState(120); // 2 hours
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen || !task) return null;

  const currentDurationStr = task.revisedEstimatedDuration || task.estimatedDuration || '60m';
  const originalDurationStr = task.originalEstimatedDuration || task.estimatedDuration || '60m';

  const handleExtendDuration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      toast.error('Please provide a reason for extending the estimated working duration');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}/extend-time`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          additionalMinutes: Number(additionalMinutes),
          reason: reason.trim()
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to extend task time');
      }

      const updatedTask = await res.json();
      toast.success(`Task duration extended by +${formatMinutes(additionalMinutes)}!`);
      if (onExtended) onExtended(updatedTask);
      onClose();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-lg bg-slate-900 border border-white/20 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10 bg-slate-800/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/20 text-blue-400 border border-blue-500/30">
              <PlusCircle className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Extend Estimated Duration</h2>
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

        <form onSubmit={handleExtendDuration} className="p-6 space-y-5 text-xs">
          {/* Duration Summary Comparison */}
          <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-white/5 border border-white/10 text-center">
            <div>
              <p className="text-[10px] text-gray-400 uppercase">Original Estimated Time</p>
              <p className="font-mono text-sm font-bold text-gray-300 mt-1">{originalDurationStr}</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-400 uppercase">Current Estimated Time</p>
              <p className="font-mono text-sm font-bold text-blue-300 mt-1">{currentDurationStr}</p>
            </div>
          </div>

          <div>
            <label className="block text-gray-300 font-bold mb-1.5">
              Additional Approved Working Time
            </label>
            <select
              value={additionalMinutes}
              onChange={e => setAdditionalMinutes(Number(e.target.value))}
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2.5 text-white font-mono text-sm"
            >
              <option value={30}>+30 Minutes (0.5 Hour)</option>
              <option value={60}>+60 Minutes (1 Hour)</option>
              <option value={120}>+120 Minutes (2 Hours)</option>
              <option value={180}>+180 Minutes (3 Hours)</option>
              <option value={240}>+240 Minutes (4 Hours)</option>
              <option value={300}>+300 Minutes (5 Hours)</option>
              <option value={480}>+480 Minutes (8 Hours)</option>
              <option value={600}>+600 Minutes (10 Hours)</option>
            </select>
          </div>

          <div>
            <label className="block text-gray-300 font-bold mb-1.5">
              Reason / Technical Justification for Extension
            </label>
            <textarea
              required
              rows={3}
              placeholder="e.g. Unforeseen complex diagnostic issue encountered during performance testing..."
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="w-full bg-slate-800 border border-white/10 rounded-lg p-3 text-white"
            />
          </div>

          {/* Extension Audit History */}
          {Array.isArray(task.extensionHistory) && task.extensionHistory.length > 0 && (
            <div className="space-y-2 border-t border-white/10 pt-3">
              <p className="text-[11px] font-bold text-gray-400 flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-amber-400" />
                Previous Extensions ({task.extensionHistory.length})
              </p>
              <div className="space-y-1.5 max-h-28 overflow-y-auto custom-scrollbar">
                {task.extensionHistory.map(ext => (
                  <div key={ext.id} className="p-2 rounded bg-white/5 text-[10px] space-y-0.5">
                    <div className="flex justify-between items-center font-mono">
                      <span className="text-emerald-400 font-bold">+{ext.additionalMinutes}m</span>
                      <span className="text-gray-400">{ext.extendedBy}</span>
                    </div>
                    <p className="text-gray-300">{ext.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold transition-colors disabled:opacity-50"
            >
              {submitting ? 'Extending...' : 'Authorize Time Extension'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
};
