import React, { useMemo } from 'react';
import { Terminal, Activity, Copy, Check } from 'lucide-react';

const formatTimeWithZone = (value) => {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  }).format(new Date(value));
};

const formatDateTimeWithZone = (value) => {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  }).format(new Date(value));
};

const formatLogId = (value) => value ? `${value.slice(0, 8)}...${value.slice(-8)}` : null;

const SystemLogs = ({ 
  logs, 
  loading, 
  onRefresh, 
  onRepublish, 
  isRepublishing, 
  selectedLog, 
  onSelectLog,
  copyToClipboard,
  copiedMap
}) => {
  const parseLogMetadata = (raw) => {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch (metadataErr) {
        console.warn("[Logs] Failed to parse metadata:", metadataErr);
        return { raw };
      }
    }
    return { raw };
  };

  const selectedLogMetadata = useMemo(() => 
    parseLogMetadata(selectedLog?.metadata), 
  [selectedLog]);

  return (
    <section className="mt-20">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <Terminal className="w-5 h-5 text-slate-400" />
          <h2 className="text-xl font-black text-slate-900 tracking-tight">System Logs</h2>
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={onRefresh}
            disabled={loading}
            className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 hover:text-blue-600 transition-colors disabled:opacity-50 disabled:cursor-wait flex items-center gap-2"
          >
            <Activity className={`w-3 h-3 ${loading ? 'animate-spin text-blue-600' : ''}`} />
            {loading ? 'Refreshing…' : 'Refresh Logs'}
          </button>
          <button
            onClick={onRepublish}
            disabled={isRepublishing}
            className="text-[10px] font-black uppercase tracking-[0.3em] px-3 py-2 rounded-full border border-slate-200 hover:border-blue-300 transition-colors disabled:opacity-50 disabled:cursor-wait"
          >
            {isRepublishing ? 'Republishing…' : 'Republish All'}
          </button>
        </div>
      </div>
      
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden font-mono text-[10px]">
        <div className="max-h-60 overflow-y-auto p-6 space-y-2">
          {logs.length > 0 ? (
            logs.map((log, i) => {
              const isActive = selectedLog && selectedLog.id === log.id;
              return (
                <div
                  key={log.id || i}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectLog(isActive ? null : log)}
                  className={`flex space-x-4 border-b border-slate-50 pb-2 last:border-0 cursor-pointer ${isActive ? 'bg-slate-50' : 'hover:bg-slate-50'}`}
                >
                  <span className="text-slate-400 shrink-0">{formatTimeWithZone(log.timestamp)}</span>
                  <span className={`font-bold shrink-0 ${log.level === 'error' ? 'text-red-500' : 'text-blue-500'}`}>{log.level.toUpperCase()}</span>
                  <span className="text-slate-600">{log.message}</span>
                </div>
              );
            })
          ) : (
            <p className="text-slate-400 italic">No system logs available yet.</p>
          )}
        </div>

        {selectedLog && (
          <div className="border-t border-slate-200 bg-slate-50 px-6 py-4 text-[11px] space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[9px] uppercase tracking-[0.4em] text-slate-500">Log Details</p>
                <p className="text-slate-800 text-sm font-semibold">{selectedLog.message}</p>
              </div>
              <button
                onClick={() => onSelectLog(null)}
                className="text-[10px] uppercase tracking-[0.5em] text-slate-400 hover:text-slate-600"
              >
                Close
              </button>
            </div>
            <div className="grid grid-cols-3 gap-4 text-[10px] text-slate-500">
              <div>
                <p className="font-bold text-slate-900 text-xs">{selectedLog.level.toUpperCase()}</p>
                <p className="text-[9px] uppercase tracking-[0.3em] text-slate-500">Level</p>
              </div>
              <div>
                <p className="font-bold text-slate-900 text-xs">{formatDateTimeWithZone(selectedLog.timestamp)}</p>
                <p className="text-[9px] uppercase tracking-[0.3em] text-slate-500">Timestamp</p>
              </div>
              {selectedLogMetadata?.serviceId && (
                <div>
                  <p className="font-bold text-slate-900 text-xs">{selectedLogMetadata.serviceId}</p>
                  <p className="text-[9px] uppercase tracking-[0.3em] text-slate-500">Service</p>
                </div>
              )}
            </div>
            {(selectedLogMetadata?.ncc02 || selectedLogMetadata?.ncc05 || selectedLogMetadata?.kind0) && (
              <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
                {['ncc02','ncc05','kind0'].map(key => {
                  const value = selectedLogMetadata?.[key];
                  if (!value) return null;
                  return (
                    <button
                      key={key}
                      onClick={() => copyToClipboard(value, `log-${key}-${selectedLog.id}`)}
                      className="px-3 py-1 bg-white border border-slate-200 rounded-full text-[10px] text-slate-600 hover:border-blue-300 hover:text-blue-600 transition-colors flex items-center gap-2"
                    >
                      <span>{key.toUpperCase()}: {formatLogId(value)}</span>
                      {copiedMap[`log-${key}-${selectedLog.id}`] ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="bg-white border border-slate-200 rounded-2xl p-3 overflow-x-auto">
              <pre className="text-[10px] whitespace-pre-wrap break-words">
                {selectedLogMetadata ? JSON.stringify(selectedLogMetadata, null, 2) : 'No metadata.'}
              </pre>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default SystemLogs;
