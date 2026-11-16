import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { 
  TrendingUp, 
  Award, 
  Clock, 
  CheckCircle2, 
  AlertTriangle, 
  ShieldCheck, 
  Zap, 
  Calendar, 
  Filter,
  Sliders,
  Settings,
  ChevronRight,
  Layers,
  Sparkles
} from 'lucide-react';
import { PerformanceConfig } from './types';
import { toast } from 'sonner';

interface TeamPerformanceDashboardProps {
  token: string;
  userRole?: string;
  isExecutive?: boolean;
}

export const TeamPerformanceDashboard: React.FC<TeamPerformanceDashboardProps> = ({
  token,
  userRole,
  isExecutive
}) => {
  const currentDate = new Date();
  const currentMonth = currentDate.getMonth() + 1;
  const currentYear = currentDate.getFullYear();

  const [period, setPeriod] = useState<'monthly' | 'weekly' | 'daily'>('monthly');
  const [selectedMonth, setSelectedMonth] = useState<number>(currentMonth);
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [config, setConfig] = useState<PerformanceConfig | null>(null);

  const fetchPerformance = async () => {
    setLoading(true);
    try {
      let url = `/api/analytics/team-performance?period=${period}`;
      if (period === 'monthly') {
        url += `&month=${selectedMonth}&year=${selectedYear}`;
      }
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const payload = await res.json();
        setData(payload);
      }
    } catch (err: any) {
      console.error('Failed to load performance analytics:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/performance/config', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const c = await res.json();
        setConfig(c);
      }
    } catch {}
  };

  useEffect(() => {
    fetchPerformance();
  }, [period, selectedMonth, selectedYear]);

  useEffect(() => {
    fetchConfig();
  }, []);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config) return;
    try {
      const res = await fetch('/api/performance/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(config)
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update config');
      }
      toast.success('Performance weights updated');
      setShowConfigModal(false);
      fetchPerformance();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const summary = data?.summary || {};
  const awards = data?.awards || {};
  const rankings = data?.rankings || [];

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  return (
    <div className="space-y-8">
      {/* Header and Filter Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <TrendingUp className="text-blue-400 w-8 h-8" />
            Smart Team Performance Engine
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Intelligent attendance-based working time efficiency and multi-factor technician rankings
          </p>
        </div>

        {/* Period & Filter Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Period selector */}
          <div className="flex bg-slate-900 border border-white/10 rounded-xl p-1 text-xs">
            <button
              onClick={() => setPeriod('daily')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-colors ${
                period === 'daily' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              Today
            </button>
            <button
              onClick={() => setPeriod('weekly')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-colors ${
                period === 'weekly' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              Weekly
            </button>
            <button
              onClick={() => setPeriod('monthly')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-colors ${
                period === 'monthly' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              Monthly
            </button>
          </div>

          {/* Month selector (when monthly) */}
          {period === 'monthly' && (
            <div className="flex items-center gap-2 bg-slate-900 border border-white/10 rounded-xl px-3 py-1.5 text-xs">
              <Calendar className="w-3.5 h-3.5 text-blue-400" />
              <select
                value={selectedMonth}
                onChange={e => setSelectedMonth(Number(e.target.value))}
                className="bg-transparent text-white font-bold outline-none cursor-pointer"
              >
                {monthNames.map((name, i) => (
                  <option key={i + 1} value={i + 1} className="bg-slate-900 text-white">
                    {name} {selectedYear} {i + 1 === currentMonth ? '(Running)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Configure weights button for executives */}
          {(userRole === 'SUPER_ADMIN' || userRole === 'HOD' || userRole === 'DHOD' || isExecutive) && (
            <button
              onClick={() => setShowConfigModal(true)}
              className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-gray-200 border border-white/10 flex items-center gap-2 text-xs font-semibold transition-colors"
              title="Configure Weighted Performance Model"
            >
              <Sliders className="w-3.5 h-3.5 text-amber-400" />
              <span>Model Weights</span>
            </button>
          )}
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <div className="p-4 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md">
          <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Productive Work</p>
          <p className="text-2xl font-black text-white mt-1">{summary.actualWorkingHours || 0}h</p>
          <p className="text-[10px] text-gray-500 mt-0.5">Est: {summary.estimatedHours || 0}h</p>
        </div>

        <div className="p-4 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md">
          <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Average Efficiency</p>
          <p className="text-2xl font-black text-blue-400 mt-1">{summary.averageEfficiency || 100}%</p>
          <p className="text-[10px] text-gray-500 mt-0.5">Speed Cap: 130%</p>
        </div>

        <div className="p-4 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md">
          <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Approved Overtime</p>
          <p className="text-2xl font-black text-purple-400 mt-1">{summary.approvedOvertimeHours || 0}h</p>
          <p className="text-[10px] text-gray-500 mt-0.5">Authorized extensions</p>
        </div>

        <div className="p-4 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md">
          <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Tasks Completed</p>
          <p className="text-2xl font-black text-emerald-400 mt-1">{summary.completedTasks || 0}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">Total Tasks: {summary.totalTasks || 0}</p>
        </div>

        <div className="p-4 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md">
          <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Active Workload</p>
          <p className="text-2xl font-black text-amber-400 mt-1">{summary.runningTasks || 0}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">Pending: {summary.pendingTasks || 0}</p>
        </div>

        <div className="p-4 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md">
          <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Team Performance</p>
          <p className="text-2xl font-black text-white mt-1">{summary.averageTeamScore || 0}/100</p>
          <p className="text-[10px] text-emerald-400 mt-0.5">Composite Weighted</p>
        </div>
      </div>

      {/* Awards Showcase */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-gradient-to-br from-amber-500/20 to-amber-900/10 border border-amber-500/30 flex items-center gap-3">
          <div className="p-3 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/40">
            <Award className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] text-amber-300 font-bold uppercase tracking-wider">Top Performer</p>
            <p className="text-base font-black text-white">{awards.topPerformer?.technicianName || 'N/A'}</p>
            <p className="text-xs text-amber-400/80 font-mono">Score: {awards.topPerformer?.compositeScore || 0}/100</p>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-gradient-to-br from-blue-500/20 to-blue-900/10 border border-blue-500/30 flex items-center gap-3">
          <div className="p-3 rounded-xl bg-blue-500/20 text-blue-400 border border-blue-500/40">
            <Zap className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] text-blue-300 font-bold uppercase tracking-wider">Most Productive</p>
            <p className="text-base font-black text-white">{awards.mostProductive?.technicianName || 'N/A'}</p>
            <p className="text-xs text-blue-400/80 font-mono">{awards.mostProductive?.completedTasks || 0} Tasks Done</p>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-emerald-900/10 border border-emerald-500/30 flex items-center gap-3">
          <div className="p-3 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
            <Clock className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] text-emerald-300 font-bold uppercase tracking-wider">Most Efficient</p>
            <p className="text-base font-black text-white">{awards.mostEfficient?.technicianName || 'N/A'}</p>
            <p className="text-xs text-emerald-400/80 font-mono">{awards.mostEfficient?.timeEfficiencyPercentage || 100}% Efficiency</p>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-gradient-to-br from-purple-500/20 to-purple-900/10 border border-purple-500/30 flex items-center gap-3">
          <div className="p-3 rounded-xl bg-purple-500/20 text-purple-400 border border-purple-500/40">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] text-purple-300 font-bold uppercase tracking-wider">Quality Champion</p>
            <p className="text-base font-black text-white">{awards.qualityChampion?.technicianName || 'N/A'}</p>
            <p className="text-xs text-purple-400/80 font-mono">0 Rework / 100% Quality</p>
          </div>
        </div>
      </div>

      {/* Leaderboard Table */}
      <div className="rounded-2xl bg-slate-900/80 border border-white/10 overflow-hidden shadow-2xl">
        <div className="p-5 border-b border-white/10 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Award className="text-blue-400 w-5 h-5" /> Technician Performance Leaderboard
          </h2>
          <span className="text-xs text-gray-400 font-mono">
            Weighted Model: Efficiency (30%) • Completion (25%) • Quality (25%) • On-Time (10%) • Eval (10%)
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-white/5 text-gray-400 uppercase text-[10px] tracking-wider border-b border-white/10">
              <tr>
                <th className="py-3 px-4">Rank</th>
                <th className="py-3 px-4">Technician</th>
                <th className="py-3 px-4 text-center">Shift</th>
                <th className="py-3 px-4 text-center">Tasks Done</th>
                <th className="py-3 px-4 text-center">Working Hours</th>
                <th className="py-3 px-4 text-center">Overtime</th>
                <th className="py-3 px-4 text-center">Time Efficiency</th>
                <th className="py-3 px-4 text-center">Completion Rate</th>
                <th className="py-3 px-4 text-center">Quality Rate</th>
                <th className="py-3 px-4 text-center font-bold text-white">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rankings.map((r: any) => (
                <tr key={r.technicianId} className="hover:bg-white/5 transition-colors">
                  <td className="py-3.5 px-4 font-bold">
                    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs ${
                      r.rank === 1 ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-black' :
                      r.rank === 2 ? 'bg-slate-300/20 text-slate-200 border border-slate-300/40 font-bold' :
                      r.rank === 3 ? 'bg-amber-700/20 text-amber-600 border border-amber-700/40 font-bold' :
                      'text-gray-400'
                    }`}>
                      {r.rank}
                    </span>
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="font-bold text-white text-sm">{r.technicianName}</div>
                    <div className="text-[10px] text-gray-400 font-mono">{r.technicianId} • {r.department}</div>
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-blue-500/10 text-blue-300 border border-blue-500/20 font-bold">
                      {r.assignedShift?.replace('SHIFT_', 'Shift ')}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-center font-mono">
                    <span className="font-bold text-emerald-400">{r.completedTasks}</span> / {r.totalTasks}
                  </td>
                  <td className="py-3.5 px-4 text-center font-mono">
                    <span className="font-bold text-white">{r.actualWorkingHours}h</span>
                    <span className="text-gray-500 text-[10px]"> / {r.estimatedHours}h</span>
                  </td>
                  <td className="py-3.5 px-4 text-center font-mono">
                    {r.approvedOvertimeHours > 0 ? (
                      <span className="text-purple-300 font-bold">+{r.approvedOvertimeHours}h</span>
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    <span className={`font-mono font-bold ${
                      r.timeEfficiencyPercentage >= 100 ? 'text-emerald-400' :
                      r.timeEfficiencyPercentage >= 80 ? 'text-blue-400' : 'text-amber-400'
                    }`}>
                      {r.timeEfficiencyPercentage}%
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-center font-mono text-gray-300">
                    {r.completionRatePercentage}%
                  </td>
                  <td className="py-3.5 px-4 text-center font-mono">
                    <span className={r.reworkIncidents > 0 ? 'text-amber-400' : 'text-emerald-400'}>
                      {r.qualityRatePercentage}%
                    </span>
                    {r.reworkIncidents > 0 && (
                      <span className="block text-[9px] text-red-400">({r.reworkIncidents} rework)</span>
                    )}
                  </td>
                  <td className="py-3.5 px-4 text-center">
                    <span className="px-3 py-1 rounded-xl bg-blue-500/20 text-white font-black text-sm border border-blue-500/30 font-mono">
                      {r.compositeScore}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Model Weights Configuration Modal */}
      {showConfigModal && config && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md bg-slate-900 border border-white/20 rounded-2xl p-6 shadow-2xl space-y-4 text-xs"
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Sliders className="w-5 h-5 text-amber-400" />
                Configure Performance Model Weights
              </h3>
              <button onClick={() => setShowConfigModal(false)} className="text-gray-400 hover:text-white">
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveConfig} className="space-y-3">
              <div>
                <label className="block text-gray-300 font-bold mb-1">Time Efficiency Weight (%)</label>
                <input
                  type="number"
                  value={config.timeEfficiencyWeight}
                  onChange={e => setConfig({ ...config, timeEfficiencyWeight: Number(e.target.value) })}
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-gray-300 font-bold mb-1">Task Completion Rate Weight (%)</label>
                <input
                  type="number"
                  value={config.taskCompletionWeight}
                  onChange={e => setConfig({ ...config, taskCompletionWeight: Number(e.target.value) })}
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-gray-300 font-bold mb-1">Quality / Rework Rate Weight (%)</label>
                <input
                  type="number"
                  value={config.qualityWeight}
                  onChange={e => setConfig({ ...config, qualityWeight: Number(e.target.value) })}
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-gray-300 font-bold mb-1">On-Time Completion Weight (%)</label>
                <input
                  type="number"
                  value={config.onTimeCompletionWeight}
                  onChange={e => setConfig({ ...config, onTimeCompletionWeight: Number(e.target.value) })}
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white font-mono"
                />
              </div>

              <div>
                <label className="block text-gray-300 font-bold mb-1">Supervisor Evaluation Weight (%)</label>
                <input
                  type="number"
                  value={config.supervisorEvalWeight}
                  onChange={e => setConfig({ ...config, supervisorEvalWeight: Number(e.target.value) })}
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white font-mono"
                />
              </div>

              <div className="pt-2 text-[11px] text-gray-400">
                Sum: {config.timeEfficiencyWeight + config.taskCompletionWeight + config.qualityWeight + config.onTimeCompletionWeight + config.supervisorEvalWeight}% (Must equal 100%)
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowConfigModal(false)}
                  className="px-4 py-2 rounded-lg bg-white/5 text-gray-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white font-bold"
                >
                  Save Model
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
};
