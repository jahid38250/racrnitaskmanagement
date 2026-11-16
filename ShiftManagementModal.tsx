import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, 
  Clock, 
  Plus, 
  Users, 
  Calendar, 
  Check, 
  Edit2, 
  Trash2, 
  AlertCircle, 
  Settings,
  ShieldAlert
} from 'lucide-react';
import { ShiftConfiguration, TechnicianShiftAssignment, User } from './types';
import { toast } from 'sonner';

interface ShiftManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: string;
  users: User[];
  onShiftsUpdated?: () => void;
}

export const ShiftManagementModal: React.FC<ShiftManagementModalProps> = ({
  isOpen,
  onClose,
  token,
  users,
  onShiftsUpdated
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'shifts' | 'assign' | 'roster'>('shifts');
  const [shifts, setShifts] = useState<ShiftConfiguration[]>([]);
  const [assignments, setAssignments] = useState<TechnicianShiftAssignment[]>([]);
  const [loading, setLoading] = useState(false);

  // New Shift form state
  const [shiftCode, setShiftCode] = useState('');
  const [shiftName, setShiftName] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('18:00');
  const [breakMinutes, setBreakMinutes] = useState(0);
  const [isDefault, setIsDefault] = useState(false);

  // Assignment form state
  const [selectedTechs, setSelectedTechs] = useState<string[]>([]);
  const [assignShiftCode, setAssignShiftCode] = useState('SHIFT_B');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [assignNotes, setAssignNotes] = useState('');
  const [isTemporary, setIsTemporary] = useState(false);

  const technicians = users.filter(u => u.role === 'TECHNICIAN');

  const fetchData = async () => {
    setLoading(true);
    try {
      const [shiftsRes, assignRes] = await Promise.all([
        fetch('/api/shifts', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/shifts/assignments', { headers: { Authorization: `Bearer ${token}` } })
      ]);
      if (shiftsRes.ok) {
        const data = await shiftsRes.json();
        setShifts(data);
      }
      if (assignRes.ok) {
        const data = await assignRes.json();
        setAssignments(data);
      }
    } catch (err: any) {
      console.error('Error fetching shift data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchData();
    }
  }, [isOpen]);

  const handleCreateShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shiftCode || !shiftName || !startTime || !endTime) {
      toast.error('All fields are required');
      return;
    }

    try {
      const res = await fetch('/api/shifts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          code: shiftCode.trim().toUpperCase(),
          name: shiftName.trim(),
          startTime,
          endTime,
          breakDurationMinutes: Number(breakMinutes) || 0,
          isDefault
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create shift');
      }

      toast.success('Shift configuration saved');
      setShiftCode('');
      setShiftName('');
      setBreakMinutes(60);
      setIsDefault(false);
      fetchData();
      if (onShiftsUpdated) onShiftsUpdated();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleAssignShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedTechs.length === 0) {
      toast.error('Please select at least one technician');
      return;
    }

    try {
      const res = await fetch('/api/shifts/assignments/bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          technicianIds: selectedTechs,
          defaultShiftCode: assignShiftCode,
          shiftCode: assignShiftCode,
          effectiveFrom: effectiveFrom || undefined,
          effectiveTo: effectiveTo || undefined,
          isTemporary,
          notes: assignNotes || undefined
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to assign shift');
      }

      toast.success(`Assigned ${selectedTechs.length} technician(s) to ${assignShiftCode}`);
      setSelectedTechs([]);
      setAssignNotes('');
      fetchData();
      if (onShiftsUpdated) onShiftsUpdated();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-4xl bg-slate-900 border border-white/20 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10 bg-slate-800/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/20 text-blue-400 border border-blue-500/30">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Smart Shift Management</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Configure duty shifts, assign individual/team duty schedules, and set holiday policies
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

        {/* Navigation Tabs */}
        <div className="flex border-b border-white/10 bg-black/20 px-6 gap-4">
          <button
            onClick={() => setActiveSubTab('shifts')}
            className={`py-3 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
              activeSubTab === 'shifts'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <Clock className="w-4 h-4" />
            Shift Configurations ({shifts.length})
          </button>
          <button
            onClick={() => setActiveSubTab('assign')}
            className={`py-3 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
              activeSubTab === 'assign'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <Users className="w-4 h-4" />
            Assign Shifts
          </button>
          <button
            onClick={() => setActiveSubTab('roster')}
            className={`py-3 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
              activeSubTab === 'roster'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <Calendar className="w-4 h-4" />
            Technician Roster ({assignments.length})
          </button>
        </div>

        {/* Content Area */}
        <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-6">
          {activeSubTab === 'shifts' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Existing Shifts List */}
              <div className="md:col-span-2 space-y-3">
                <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider">
                  Configured Duty Shifts
                </h3>
                <div className="space-y-3">
                  {shifts.map(s => (
                    <div
                      key={s.id}
                      className="p-4 rounded-xl bg-white/5 border border-white/10 hover:border-white/20 transition-all flex items-center justify-between"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white text-base">{s.name}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                            {s.code}
                          </span>
                          {s.isDefault && (
                            <span className="text-[10px] px-2 py-0.5 rounded font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              DEFAULT (Walton Standard)
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 mt-1 font-mono">
                          Duty Hours: {s.startTime} – {s.endTime}
                          {s.breakDurationMinutes > 0 && ` • Break: ${s.breakDurationMinutes}m`}
                        </p>
                      </div>
                      {loading && <span className="text-[10px] text-gray-500">Syncing...</span>}
                    </div>
                  ))}
                </div>
              </div>

              {/* Add Custom Shift */}
              <div className="bg-slate-800/40 p-4 rounded-xl border border-white/10 space-y-4">
                <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2">
                  <Plus className="w-4 h-4 text-blue-400" /> Add Custom Shift
                </h3>
                <form onSubmit={handleCreateShift} className="space-y-3 text-xs">
                  <div>
                    <label className="block text-gray-400 mb-1">Shift Code</label>
                    <input
                      type="text"
                      placeholder="e.g. SHIFT_D"
                      value={shiftCode}
                      onChange={e => setShiftCode(e.target.value)}
                      className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-white"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-gray-400 mb-1">Shift Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Night Overlap Shift"
                      value={shiftName}
                      onChange={e => setShiftName(e.target.value)}
                      className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-white"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-gray-400 mb-1">Start Time (BST)</label>
                      <input
                        type="time"
                        value={startTime}
                        onChange={e => setStartTime(e.target.value)}
                        className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-white"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-gray-400 mb-1">End Time (BST)</label>
                      <input
                        type="time"
                        value={endTime}
                        onChange={e => setEndTime(e.target.value)}
                        className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-white"
                        required
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-gray-300 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={isDefault}
                      onChange={e => setIsDefault(e.target.checked)}
                      className="rounded bg-slate-900 border-white/20"
                    />
                    <span>Set as System Default Shift</span>
                  </label>
                  <button
                    type="submit"
                    className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold transition-colors mt-2"
                  >
                    Save Shift
                  </button>
                </form>
              </div>
            </div>
          )}

          {activeSubTab === 'assign' && (
            <form onSubmit={handleAssignShift} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Select Technicians */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-bold text-gray-300">
                      Select Technicians ({selectedTechs.length} selected)
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        if (selectedTechs.length === technicians.length) setSelectedTechs([]);
                        else setSelectedTechs(technicians.map(t => t.employeeId));
                      }}
                      className="text-xs text-blue-400 hover:underline"
                    >
                      {selectedTechs.length === technicians.length ? 'Deselect All' : 'Select All'}
                    </button>
                  </div>
                  <div className="max-h-60 overflow-y-auto custom-scrollbar border border-white/10 rounded-xl p-2 bg-slate-950/40 space-y-1">
                    {technicians.map(tech => {
                      const isSel = selectedTechs.includes(tech.employeeId);
                      return (
                        <div
                          key={tech.employeeId}
                          onClick={() => {
                            if (isSel) setSelectedTechs(selectedTechs.filter(id => id !== tech.employeeId));
                            else setSelectedTechs([...selectedTechs, tech.employeeId]);
                          }}
                          className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors text-xs ${
                            isSel ? 'bg-blue-600/25 border border-blue-500/40' : 'hover:bg-white/5 border border-transparent'
                          }`}
                        >
                          <div>
                            <span className="font-bold text-white">{tech.name}</span>
                            <span className="text-gray-400 ml-2 font-mono">({tech.employeeId})</span>
                          </div>
                          <span className="text-gray-400">{tech.department || 'RAC R&I'}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Assignment Options */}
                <div className="space-y-4 bg-slate-800/30 p-4 rounded-xl border border-white/10 text-xs">
                  <div>
                    <label className="block text-gray-300 font-bold mb-1">Target Shift</label>
                    <select
                      value={assignShiftCode}
                      onChange={e => setAssignShiftCode(e.target.value)}
                      className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-white"
                    >
                      {shifts.map(s => (
                        <option key={s.code} value={s.code}>
                          {s.name} ({s.startTime} – {s.endTime})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-gray-400 mb-1">Effective From (Optional)</label>
                      <input
                        type="date"
                        value={effectiveFrom}
                        onChange={e => setEffectiveFrom(e.target.value)}
                        className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-400 mb-1">Effective To (Optional)</label>
                      <input
                        type="date"
                        value={effectiveTo}
                        onChange={e => setEffectiveTo(e.target.value)}
                        className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-white"
                      />
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isTemporary}
                      onChange={e => setIsTemporary(e.target.checked)}
                      className="rounded bg-slate-900 border-white/20"
                    />
                    <span>Temporary Shift Schedule Change</span>
                  </label>

                  <div>
                    <label className="block text-gray-400 mb-1">Duty Notes / Reason</label>
                    <input
                      type="text"
                      placeholder="e.g. Weekly rotation / specialized lab assignment"
                      value={assignNotes}
                      onChange={e => setAssignNotes(e.target.value)}
                      className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-white"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition-colors"
                  >
                    Apply Shift Assignment
                  </button>
                </div>
              </div>
            </form>
          )}

          {activeSubTab === 'roster' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider">
                Current Shift Assignments
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {technicians.map(tech => {
                  const assignment = assignments.find(a => a.technicianId === tech.employeeId);
                  const currentShiftCode = assignment?.defaultShiftCode || 'SHIFT_B';
                  const shift = shifts.find(s => s.code === currentShiftCode);
                  const hasOverrides = Array.isArray(assignment?.temporaryOverrides) && assignment!.temporaryOverrides!.length > 0;

                  return (
                    <div
                      key={tech.employeeId}
                      className="p-3.5 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white text-sm">{tech.name}</span>
                          <span className="text-[10px] text-gray-400 font-mono">({tech.employeeId})</span>
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {shift ? `${shift.name} (${shift.startTime} – ${shift.endTime})` : currentShiftCode}
                        </p>
                        {hasOverrides && (
                          <span className="inline-block mt-1 text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            Temporary Rotation ({assignment!.temporaryOverrides!.length} day override)
                          </span>
                        )}
                      </div>
                      <span className="text-xs px-2.5 py-1 rounded-md font-mono font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                        {currentShiftCode}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};
