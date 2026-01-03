import React, { useState, useEffect } from 'react';
import { 
  ChevronRight, Copy, Eye, RefreshCw 
} from 'lucide-react';
import { sidecarApi } from '../../api';
import Modal from '../common/Modal';
import Button from '../common/Button';

const formatBytes = (bytes = 0) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`;
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

const NodeSettingsModal = ({ 
  isOpen, 
  onClose, 
  appConfig, 
  sidecarService, 
  onRefresh,
  backupSyncStatus,
  lastBackupSyncTime,
  backupSyncError,
  onSyncBackup,
  copyToClipboard
}) => {
  const [activeSection, setActiveSection] = useState(null);
  const [dbInfo, setDbInfo] = useState(null);
  
  // DB States
  const [dbCurrentPassword, setDbCurrentPassword] = useState('');
  const [dbNewPassword, setDbNewPassword] = useState('');
  const [dbExportPassword, setDbExportPassword] = useState('');
  const [dbImportPassword, setDbImportPassword] = useState('');
  const [dbWipePassword, setDbWipePassword] = useState('');
  const [dbLoading, setDbLoading] = useState(null); // 'password', 'export', 'import', 'wipe'
  
  // Backup States
  const [listBackupEvent, setListBackupEvent] = useState('');
  const [listBackupImportValue, setListBackupImportValue] = useState('');
  const [listBackupMessage, setListBackupMessage] = useState('');
  const [backupLoading, setBackupLoading] = useState(null); // 'generate', 'restore'

  // Node Actions States
  const [rotatingOnion, setRotatingOnion] = useState(false);
  const [regeneratingTls, setRegeneratingTls] = useState(false);
  const [showNodeNsec, setShowNodeNsec] = useState(false);
  const [protocolLoading, setProtocolLoading] = useState(null);
  const [remoteLoading, setRemoteLoading] = useState(false);

  useEffect(() => {
    if (isOpen && activeSection === 'database') {
      const loadDbInfo = async () => {
        try {
          const info = await sidecarApi.getDbInfo();
          setDbInfo(info);
        } catch (err) {
          console.warn("Failed to load DB info", err);
        }
      };
      loadDbInfo();
    }
  }, [isOpen, activeSection]);

  const toggleSection = (section) => {
    setActiveSection(prev => prev === section ? null : section);
  };

  // --- Handlers ---

  const handleToggleAllowRemote = async () => {
    setRemoteLoading(true);
    try {
      const newVal = !appConfig.allow_remote;
      await sidecarApi.updateAllowRemote(newVal);
      onRefresh();
    } catch (err) {
      alert("Failed: " + err.message);
    } finally {
      setRemoteLoading(false);
    }
  };

  const handleToggleProtocol = async (protocol) => {
    setProtocolLoading(protocol);
    try {
      const current = appConfig.protocols || {};
      await sidecarApi.updateProtocols({ ...current, [protocol]: !current[protocol] });
      onRefresh();
    } catch (err) {
      alert("Failed: " + err.message);
    } finally {
      setProtocolLoading(null);
    }
  };

  // Node Identity Handlers
  const handleNodeGenerateIdentity = async () => {
    if (!sidecarService) return;
    if (!confirm('Regenerate management identity? You will need to re-login.')) return;
    try {
      const keyRes = await sidecarApi.generateKey();
      await sidecarApi.updateService(sidecarService.id, { service_nsec: keyRes.nsec });
      alert('Identity regenerated. Save the new key!');
      onRefresh();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleNodeRotateOnion = async () => {
    if (!sidecarService) return;
    setRotatingOnion(true);
    try {
      // Clear onion key to force rotation on next publish
      await sidecarApi.updateService(sidecarService.id, { 
        config: { ...sidecarService.config, onion_private_key: null } 
      });
      alert('Onion rotation requested. Address will change after next publish.');
      onRefresh();
    } catch (err) {
      alert(err.message);
    } finally {
      setRotatingOnion(false);
    }
  };

  const handleNodeRegenerateTls = async () => {
    if (!sidecarService) return;
    setRegeneratingTls(true);
    try {
      await sidecarApi.regenerateTls(sidecarService.id);
      onRefresh();
    } catch (err) {
      alert(err.message);
    } finally {
      setRegeneratingTls(false);
    }
  };

  // DB Handlers
  const handleSetDbPassword = async () => {
    setDbLoading('password');
    try {
      await sidecarApi.updateDbPassword({ currentPassword: dbCurrentPassword, newPassword: dbNewPassword });
      setDbCurrentPassword('');
      setDbNewPassword('');
      const info = await sidecarApi.getDbInfo();
      setDbInfo(info);
      alert('Database password updated.');
    } catch (err) {
      alert(err.message);
    } finally {
      setDbLoading(null);
    }
  };

  const handleExportDb = async () => {
    setDbLoading('export');
    try {
      const response = await sidecarApi.exportDb(dbExportPassword);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'sidecar.db');
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      alert("Export failed. Check password.");
    } finally {
      setDbLoading(null);
    }
  };

  const handleImportDb = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.db';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = async (evt) => {
        const base64 = evt.target.result.split(',')[1];
        setDbLoading('import');
        try {
          await sidecarApi.importDb({ data: base64, password: dbImportPassword });
          alert('Database imported successfully.');
          window.location.reload();
        } catch (_err) {
          alert("Import failed: " + _err.message);
        } finally {
          setDbLoading(null);
        }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const handleWipeDb = async () => {
    if (!confirm("Are you sure you want to WIPE the database? This is irreversible.")) return;
    setDbLoading('wipe');
    try {
      await sidecarApi.wipeDb(dbWipePassword);
      window.location.reload();
    } catch (err) {
      alert(err.message);
    } finally {
      setDbLoading(null);
    }
  };

  // Backup Handlers
  const handleGenerateBackup = async () => {
    setBackupLoading('generate');
    setListBackupMessage('');
    try {
      const res = await sidecarApi.getBackupList();
      setListBackupEvent(JSON.stringify(res.event, null, 2));
      setListBackupMessage('Backup event generated.');
    } catch (err) {
      setListBackupMessage('Failed: ' + err.message);
    } finally {
      setBackupLoading(null);
    }
  };

  const handleRestoreBackup = async () => {
    if (!listBackupImportValue.trim()) return;
    setBackupLoading('restore');
    setListBackupMessage('');
    try {
      const event = JSON.parse(listBackupImportValue);
      await sidecarApi.restoreBackupList(event);
      setListBackupMessage('Backup restored successfully.');
      onRefresh();
    } catch (err) {
      setListBackupMessage('Restore failed: ' + err.message);
    } finally {
      setBackupLoading(null);
    }
  };

  const nodeInventory = sidecarService?.state?.last_inventory || [];
  const nodeOnion = nodeInventory.find(e => e.family === 'onion')?.url || '';
  const nodeTls = nodeInventory.find(e => e.tlsFingerprint || e.k);
  const nodeTlsValue = nodeTls?.tlsFingerprint || nodeTls?.k || '';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Node Settings" maxWidth="max-w-3xl">
      <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-2">
        
        {/* --- Remote Access --- */}
        <div className="rounded-2xl border border-slate-100 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-black text-slate-700 uppercase tracking-tight">Remote Access</p>
              <p className="text-[11px] text-slate-400 max-w-sm">
                Allow accessing this dashboard from other devices on the local network.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-lg ${appConfig.allow_remote ? 'bg-green-100 text-green-600' : 'bg-slate-100 text-slate-500'}`}>
                {appConfig.allow_remote ? 'Enabled' : 'Local Only'}
              </span>
              <button 
                onClick={handleToggleAllowRemote} 
                disabled={remoteLoading}
                className={`w-12 h-6 rounded-full transition-colors relative ${appConfig.allow_remote ? 'bg-blue-600' : 'bg-slate-200'}`}
              >
                <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${appConfig.allow_remote ? 'translate-x-6' : ''}`} />
              </button>
            </div>
          </div>
        </div>

        {/* --- Endpoints --- */}
        <div className="rounded-2xl border border-slate-100 p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-black text-slate-700 uppercase tracking-tight">Endpoint Availability</p>
              <p className="text-[11px] text-slate-400 max-w-sm">
                Control which protocols the Sidecar creates endpoints for.
              </p>
            </div>
            <button onClick={() => toggleSection('protocols')} className="p-2 rounded-full bg-slate-100 text-slate-500">
              <ChevronRight className={`w-3 h-3 transition-transform ${activeSection === 'protocols' ? 'rotate-90' : ''}`} />
            </button>
          </div>
          {activeSection === 'protocols' && (
            <div className="mt-4 grid grid-cols-3 gap-3">
              {['ipv4', 'ipv6', 'tor'].map(p => {
                const isActive = appConfig.protocols?.[p] !== false;
                return (
                  <button
                    key={p}
                    onClick={() => handleToggleProtocol(p)}
                    disabled={protocolLoading === p}
                    className={`py-3 rounded-xl border font-bold text-xs uppercase transition-colors flex items-center justify-center gap-2 ${
                      isActive 
                        ? 'bg-blue-50 border-blue-200 text-blue-600 dark:bg-blue-500/20 dark:border-blue-500/50 dark:text-blue-300' 
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500'
                    }`}
                  >
                    {protocolLoading === p ? <RefreshCw className="w-3 h-3 animate-spin" /> : 
                     <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-blue-500 dark:bg-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.5)]' : 'bg-slate-300 dark:bg-slate-600'}`} />
                    }
                    {p}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* --- Database --- */}
        <div className="rounded-2xl border border-slate-100 p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-black text-slate-700 uppercase tracking-tight">Database Management</p>
              <p className="text-[11px] text-slate-400 max-w-sm">
                Export, import, or reset the embedded SQLite database.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[10px] uppercase tracking-[0.4em] text-slate-400">
                {dbInfo?.passwordProtected ? 'Passworded' : 'Unprotected'}
              </span>
              <button onClick={() => toggleSection('database')} className="p-2 rounded-full bg-slate-100 text-slate-500">
                <ChevronRight className={`w-3 h-3 transition-transform ${activeSection === 'database' ? 'rotate-90' : ''}`} />
              </button>
            </div>
          </div>
          {activeSection === 'database' && (
            <div className="mt-4 space-y-6">
              <div className="grid grid-cols-3 gap-3 text-[11px] text-slate-500 bg-slate-50 p-3 rounded-xl">
                <div><p className="uppercase text-[9px] tracking-widest text-slate-400">File</p>{dbInfo?.path || '...'}</div>
                <div><p className="uppercase text-[9px] tracking-widest text-slate-400">Size</p>{formatBytes(dbInfo?.size)}</div>
                <div><p className="uppercase text-[9px] tracking-widest text-slate-400">Modified</p>{formatDateTimeWithZone(dbInfo?.modifiedAt)}</div>
              </div>

              {/* DB Password */}
              <div className="space-y-2">
                <p className="text-[10px] uppercase tracking-widest text-slate-500">Database Password</p>
                <div className="flex gap-2">
                  <input type="password" placeholder="Current" value={dbCurrentPassword} onChange={e => setDbCurrentPassword(e.target.value)} className="w-full p-3 rounded-xl border text-xs" />
                  <input type="password" placeholder="New" value={dbNewPassword} onChange={e => setDbNewPassword(e.target.value)} className="w-full p-3 rounded-xl border text-xs" />
                </div>
                <Button onClick={handleSetDbPassword} loading={dbLoading === 'password'} className="w-full">Update Password</Button>
              </div>

              {/* Import/Export */}
              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-100">
                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-widest text-slate-500">Export</p>
                  <input type="password" placeholder="Export Password" value={dbExportPassword} onChange={e => setDbExportPassword(e.target.value)} className="w-full p-3 rounded-xl border text-xs" />
                  <Button onClick={handleExportDb} loading={dbLoading === 'export'} className="w-full">Export .DB</Button>
                </div>
                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-widest text-slate-500">Import</p>
                  <input type="password" placeholder="Import Password" value={dbImportPassword} onChange={e => setDbImportPassword(e.target.value)} className="w-full p-3 rounded-xl border text-xs" />
                  <Button onClick={handleImportDb} loading={dbLoading === 'import'} variant="success" className="w-full">Import .DB</Button>
                </div>
              </div>

              {/* Wipe */}
              <div className="pt-4 border-t border-slate-100">
                <input type="password" placeholder="Password to Wipe" value={dbWipePassword} onChange={e => setDbWipePassword(e.target.value)} className="w-full p-3 rounded-xl border text-xs mb-2" />
                <Button onClick={handleWipeDb} loading={dbLoading === 'wipe'} variant="danger" className="w-full">Wipe Database</Button>
              </div>
            </div>
          )}
        </div>

        {/* --- Backup --- */}
        <div className="rounded-2xl border border-slate-100 p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-black text-slate-700 uppercase tracking-tight">Nostr Backup</p>
              <div className="flex items-center gap-2 mt-1">
                <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${backupSyncStatus === 'synced' ? 'bg-green-100 text-green-600' : 'bg-slate-100 text-slate-500'}`}>
                  {backupSyncStatus === 'synced' ? 'Synced' : backupSyncStatus}
                </span>
                {lastBackupSyncTime && <span className="text-[10px] text-slate-400">Last: {formatDateTimeWithZone(lastBackupSyncTime)}</span>}
              </div>
            </div>
            <button onClick={() => toggleSection('backup')} className="p-2 rounded-full bg-slate-100 text-slate-500">
              <ChevronRight className={`w-3 h-3 transition-transform ${activeSection === 'backup' ? 'rotate-90' : ''}`} />
            </button>
          </div>
          {activeSection === 'backup' && (
            <div className="mt-4 space-y-4">
              <Button onClick={() => onSyncBackup(true)} variant="secondary" className="w-full" disabled={backupSyncStatus === 'syncing'}>
                {backupSyncStatus === 'syncing' ? 'Syncing...' : 'Force Sync Remote Backup'}
              </Button>
              {backupSyncError && <p className="text-[10px] text-red-500 font-mono">{backupSyncError}</p>}
              
              <div className="pt-4 border-t border-slate-100 space-y-4">
                 <Button onClick={handleGenerateBackup} loading={backupLoading === 'generate'} className="w-full">Generate List Backup</Button>
                 {listBackupEvent && (
                   <textarea readOnly value={listBackupEvent} className="w-full h-24 p-3 bg-slate-50 rounded-xl text-[10px] font-mono" />
                 )}
                 
                 <div className="space-y-2">
                   <textarea 
                     placeholder="Paste backup event JSON..." 
                     value={listBackupImportValue} 
                     onChange={e => setListBackupImportValue(e.target.value)}
                     className="w-full h-24 p-3 bg-slate-50 rounded-xl text-[10px] font-mono" 
                   />
                   <Button onClick={handleRestoreBackup} loading={backupLoading === 'restore'} variant="success" className="w-full">Restore from List</Button>
                 </div>
                 {listBackupMessage && <p className="text-[10px] text-slate-500 italic">{listBackupMessage}</p>}
              </div>
            </div>
          )}
        </div>

        {/* --- Identity --- */}
        <div className="rounded-2xl border border-slate-100 p-4">
           <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-black text-slate-700 uppercase tracking-tight">Identity & Keys</p>
              <p className="text-[11px] text-slate-400 max-w-sm">Manage the Sidecar's cryptographic identity.</p>
            </div>
            <button onClick={() => toggleSection('identity')} className="p-2 rounded-full bg-slate-100 text-slate-500">
              <ChevronRight className={`w-3 h-3 transition-transform ${activeSection === 'identity' ? 'rotate-90' : ''}`} />
            </button>
           </div>
           {activeSection === 'identity' && (
             <div className="mt-4 space-y-4">
               <div className="space-y-2">
                 <p className="text-[10px] uppercase tracking-widest text-slate-500">Management Key (NSEC)</p>
                 <div className="flex gap-2">
                    <input type={showNodeNsec ? 'text' : 'password'} readOnly value={sidecarService?.service_nsec || ''} className="flex-1 p-3 bg-slate-50 rounded-xl text-xs font-mono" />
                    <button onClick={() => setShowNodeNsec(!showNodeNsec)} className="p-3 bg-slate-100 rounded-xl"><Eye className="w-4 h-4 text-slate-600" /></button>
                    <button onClick={handleNodeGenerateIdentity} className="p-3 bg-slate-900 text-white rounded-xl"><RefreshCw className="w-4 h-4" /></button>
                 </div>
               </div>
               <div className="space-y-2">
                 <p className="text-[10px] uppercase tracking-widest text-slate-500">Onion Address</p>
                 <div className="flex gap-2">
                    <input type="text" readOnly value={nodeOnion} className="flex-1 p-3 bg-slate-50 rounded-xl text-xs font-mono" />
                    <button onClick={() => copyToClipboard(nodeOnion, 'onion')} className="p-3 bg-slate-100 rounded-xl"><Copy className="w-4 h-4 text-slate-600" /></button>
                    <button onClick={handleNodeRotateOnion} disabled={rotatingOnion} className="p-3 bg-slate-100 rounded-xl"><RefreshCw className={`w-4 h-4 text-slate-600 ${rotatingOnion ? 'animate-spin' : ''}`} /></button>
                 </div>
               </div>
                <div className="space-y-2">
                 <p className="text-[10px] uppercase tracking-widest text-slate-500">TLS Fingerprint</p>
                 <div className="flex gap-2">
                    <input type="text" readOnly value={nodeTlsValue} className="flex-1 p-3 bg-slate-50 rounded-xl text-xs font-mono" />
                    <button onClick={() => copyToClipboard(nodeTlsValue, 'tls')} className="p-3 bg-slate-100 rounded-xl"><Copy className="w-4 h-4 text-slate-600" /></button>
                    <button onClick={handleNodeRegenerateTls} disabled={regeneratingTls} className="p-3 bg-slate-100 rounded-xl"><RefreshCw className={`w-4 h-4 text-slate-600 ${regeneratingTls ? 'animate-spin' : ''}`} /></button>
                 </div>
               </div>
             </div>
           )}
        </div>

      </div>
      <div className="mt-6 flex justify-end">
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
};

export default NodeSettingsModal;