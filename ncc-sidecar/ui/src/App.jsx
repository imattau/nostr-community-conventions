import React, { useState, useMemo } from 'react';
import {
  Shield, Menu, LogOut, RefreshCw, Cloud, CloudOff, Copy, Check, Plus, Sun, Moon
} from 'lucide-react';
import { motion as Motion, AnimatePresence } from 'framer-motion';
import { nip19 } from 'nostr-tools';
import { getPublicKey } from 'nostr-tools/pure';

// Components
import Button from './components/common/Button';
import ServiceCard from './components/dashboard/ServiceCard';
import SystemLogs from './components/dashboard/SystemLogs';
import ConnectIdentity from './components/dashboard/ConnectIdentity';
import ProvisioningWizard from './components/dashboard/ProvisioningWizard';
import NewServiceModal from './components/dashboard/NewServiceModal';
import NodeSettingsModal from './components/dashboard/NodeSettingsModal';
import AdminsModal from './components/dashboard/AdminsModal';
import SidecarProfileModal from './components/dashboard/SidecarProfileModal';

// Hooks & API
import { useSidecar } from './hooks/useSidecar';
import { useTheme } from './hooks/useTheme';
import { useAdminNodeList } from './hooks/useAdminNodeList';
import { sidecarApi } from './api';
const formatTimeWithZone = (value) => {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  }).format(new Date(value));
};

export default function App() {
  const {
    initialized,
    loading,
    services,
    logs,
    appConfig,
    admins,
    networkAvailability,
    backupSyncStatus,
    backupSyncError,
    lastBackupSyncTime,
    fetchServices,
    fetchAdmins,
    syncBackup
  } = useSidecar();

  const { theme, toggleTheme } = useTheme();

  const [step, setStep] = useState(1);
  const [adminPubkey, setAdminPubkey] = useState(localStorage.getItem('ncc_admin_pk') || '');
  const [signer, setSigner] = useState(null);
  const [showMenu, setShowMenu] = useState(false);
  const [modalOpen, setModalOpen] = useState({
    newService: false,
    nodeSettings: false,
    admins: false,
    sidecarProfile: false
  });
  const [editService, setEditService] = useState(null);
  const [isRepublishing, setIsRepublishing] = useState(false);
  const [selectedLog, setSelectedLog] = useState(null);
  const [copiedMap, setCopiedMap] = useState({});

  const isAuthenticated = initialized && adminPubkey;
  const sidecarNode = useMemo(() => services.find(s => s.type === 'sidecar'), [services]);
  const managedServices = useMemo(() => services.filter(s => s.type !== 'sidecar'), [services]);

  const sidecarNpub = useMemo(() => {
    if (!sidecarNode?.service_nsec) return null;
    try {
      const decoded = nip19.decode(sidecarNode.service_nsec);
      return nip19.npubEncode(getPublicKey(decoded.data));
    } catch { return null; }
  }, [sidecarNode]);

  // Automatic Node Bookmarking
  useAdminNodeList({ adminPubkey, sidecarNode, signer });

  const copyToClipboard = (text, key) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedMap(prev => ({ ...prev, [key]: true }));
    setTimeout(() => setCopiedMap(prev => ({ ...prev, [key]: false })), 2000);
  };

  const handleAuthSuccess = async (authData) => {
    // Check if authData is object (new style) or string (old style/manual)
    const pk = typeof authData === 'object' ? authData.pubkey : authData;
    const authSigner = typeof authData === 'object' ? authData.signer : null;

    if (initialized) {
      try {
        const adminList = await sidecarApi.getAdmins();
        if (!adminList.some(a => a.pubkey.toLowerCase() === pk.toLowerCase())) {
          alert("Unauthorized: You are not an admin of this node.");
          return;
        }
      } catch (err) {
        alert("Verification failed: " + err.message);
        return;
      }
    }
    
    setAdminPubkey(pk);
    setSigner(authSigner);
    localStorage.setItem('ncc_admin_pk', pk);
    
    if (!initialized) {
      setStep(2); // Start provisioning wizard
    } else {
      syncBackup();
    }
  };

  const handleLogout = () => {
    localStorage.clear();
    window.location.reload();
  };

  const toggleModal = (key, isOpen, service = null) => {
    setModalOpen(prev => ({ ...prev, [key]: isOpen }));
    if (key === 'newService') setEditService(service);
  };

  const handleSaveService = async (serviceData) => {
    try {
      if (serviceData.id) {
        await sidecarApi.updateService(serviceData.id, serviceData);
      } else {
        await sidecarApi.addService(serviceData);
      }
      fetchServices();
      toggleModal('newService', false);
    } catch (err) {
      alert("Save failed: " + err.message);
    }
  };

  const handleDeleteService = async (id) => {
    if (!confirm("Delete this service profile?")) return;
    try {
      await sidecarApi.deleteService(id);
      fetchServices();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleRepublish = async () => {
    setIsRepublishing(true);
    try {
      await sidecarApi.republishAll();
      fetchServices();
    } catch (err) {
      alert("Republish failed: " + err.message);
    } finally {
      setIsRepublishing(false);
    }
  };

  if (loading || initialized === null) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <RefreshCw className="w-10 h-10 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6 font-sans">
        <Motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="max-w-xl w-full">
          <div className="bg-slate-900 rounded-[3rem] shadow-2xl border border-white/5 overflow-hidden p-12">
            {step === 1 ? (
              <ConnectIdentity 
                initialized={initialized} 
                onAuthSuccess={handleAuthSuccess} 
              />
            ) : (
              <ProvisioningWizard 
                adminPubkey={adminPubkey} 
                signer={signer}
                onComplete={() => window.location.reload()} 
              />
            )}
          </div>
        </Motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen selection:bg-blue-100 dark:selection:bg-blue-900 pb-20">
      <nav className="border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-20 flex justify-between items-center">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center shadow-lg">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="text-lg font-black tracking-tighter uppercase block leading-none dark:text-slate-200">NCC-06</span>
              <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Sidecar Manager</span>
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            <button 
              onClick={() => syncBackup(true)}
              className="hidden md:flex flex-col items-end mr-2 group"
              title={backupSyncError ? `Error: ${backupSyncError}` : `Last sync: ${formatTimeWithZone(lastBackupSyncTime)}`}
            >
              <div className="flex items-center gap-1.5">
                <span className={`text-[9px] font-black uppercase tracking-widest ${backupSyncStatus === 'synced' ? 'text-blue-500 dark:text-blue-400' : 'text-slate-400 dark:text-slate-500'}`}>
                  {backupSyncStatus === 'synced' ? 'Backup OK' : backupSyncStatus}
                </span>
                {backupSyncStatus === 'syncing' ? <RefreshCw className="w-4 h-4 animate-spin dark:text-blue-400" /> : 
                 backupSyncStatus === 'error' ? <CloudOff className="w-4 h-4 text-red-500 dark:text-red-400" /> : <Cloud className="w-4 h-4 text-blue-500 dark:text-blue-400" />}
              </div>
            </button>

            <button 
              onClick={toggleTheme} 
              className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
            >
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>

            <div className="relative">
              <button onClick={() => setShowMenu(!showMenu)} className="p-2 text-slate-400 hover:text-blue-500 transition-colors">
                <Menu className="w-5 h-5" />
              </button>
              <AnimatePresence>
                {showMenu && (
                  <Motion.div 
                    initial={{ opacity: 0, y: 10 }} 
                    animate={{ opacity: 1, y: 0 }} 
                    exit={{ opacity: 0, y: 10 }} 
                    className="absolute top-full right-0 mt-2 w-48 bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-100 dark:border-slate-800 overflow-hidden z-50"
                  >
                    <button onClick={() => { setShowMenu(false); toggleModal('nodeSettings', true); }} className="w-full text-left px-4 py-3 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">Node Settings</button>
                    <button onClick={() => { setShowMenu(false); toggleModal('sidecarProfile', true); }} className="w-full text-left px-4 py-3 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">Sidecar Profile</button>
                    <button onClick={() => { setShowMenu(false); toggleModal('admins', true); fetchAdmins(); }} className="w-full text-left px-4 py-3 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 border-t border-slate-50 dark:border-slate-800 transition-colors">Administrators</button>
                  </Motion.div>
                )}
              </AnimatePresence>
            </div>
            <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-red-500 transition-colors"><LogOut className="w-5 h-5" /></button>
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-6 py-12">
        {sidecarNode && (
          <section onClick={() => toggleModal('nodeSettings', true)} className="mb-16 bg-slate-900 dark:bg-slate-800 rounded-[2.5rem] p-8 md:p-12 text-white shadow-2xl relative overflow-hidden cursor-pointer border-2 border-blue-500/20 hover:border-blue-500/40 transition-colors">
            <div className="absolute top-0 right-0 p-12 opacity-5 pointer-events-none"><Shield className="w-64 h-64" /></div>
            <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-8">
              <div className="space-y-4">
                <div className="flex items-center space-x-3">
                  <div className="px-3 py-1 bg-blue-500 rounded-full text-[10px] font-black uppercase tracking-widest">Core Node</div>
                  <div className="flex items-center space-x-1.5">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                    <span className="text-[10px] font-bold text-green-400 uppercase">System Online</span>
                  </div>
                </div>
                <h2 className="text-4xl font-black tracking-tight leading-none">Management Identity</h2>
                <div className="flex flex-col md:flex-row md:items-center gap-4">
                  <p className="text-slate-400 font-mono text-sm">
                    {sidecarNpub ? `${sidecarNpub.slice(0, 16)}...${sidecarNpub.slice(-8)}` : '...'}
                  </p>
                  {sidecarNpub && (
                    <button 
                      onClick={(e) => { e.stopPropagation(); copyToClipboard(sidecarNpub, 'sidecar-npub'); }}
                      className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white rounded-2xl transition-all text-[10px] font-black uppercase tracking-[0.2em] border border-white/10 w-fit"
                    >
                      {copiedMap['sidecar-npub'] ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5 text-blue-400" />}
                      {copiedMap['sidecar-npub'] ? 'Copied to Clipboard' : 'Copy NPUB'}
                    </button>
                  )}
                </div>
              </div>
              <div className="flex gap-4">
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4 min-w-[150px]">
                  <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Active Services</span>
                  <p className="text-2xl font-black">{managedServices.length}</p>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4 min-w-[150px]">
                  <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Tor Status</span>
                  <p className={`text-xs font-bold uppercase mt-1 ${sidecarNode.state?.tor_status?.running ? 'text-green-400' : 'text-red-400'}`}>
                    {sidecarNode.state?.tor_status?.running ? 'Running' : 'Disconnected'}
                  </p>
                </div>
              </div>
            </div>
          </section>
        )}

        <header className="flex flex-col md:flex-row md:items-end justify-between mb-12 gap-6">
          <div>
            <h2 className="text-3xl font-black tracking-tight text-slate-900 dark:text-slate-200">Managed Services</h2>
            <p className="text-slate-500 dark:text-slate-400 font-medium mt-1">Active discovery profiles for hosted applications.</p>
          </div>
          <Button onClick={() => toggleModal('newService', true)} className="px-8 py-4">
            <Plus className="w-5 h-5 mr-2" /> NEW SERVICE PROFILE
          </Button>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {managedServices.map(s => (
            <ServiceCard 
              key={s.id} 
              service={s} 
              onEdit={() => toggleModal('newService', true, s)}
              onDelete={handleDeleteService}
              copyToClipboard={copyToClipboard}
              copiedMap={copiedMap}
            />
          ))}
        </div>

        <SystemLogs 
          logs={logs} 
          loading={loading} 
          onRefresh={fetchServices}
          onRepublish={handleRepublish}
          isRepublishing={isRepublishing}
          selectedLog={selectedLog}
          onSelectLog={setSelectedLog}
          copyToClipboard={copyToClipboard}
          copiedMap={copiedMap}
        />
      </main>

      {/* Modals */}
      <NewServiceModal 
        isOpen={modalOpen.newService} 
        initialService={editService}
        networkAvailability={networkAvailability}
        onClose={() => toggleModal('newService', false)}
        onSave={handleSaveService}
      />
      
      <NodeSettingsModal 
        isOpen={modalOpen.nodeSettings}
        onClose={() => toggleModal('nodeSettings', false)}
        appConfig={appConfig}
        sidecarService={sidecarNode}
        onRefresh={fetchServices}
        backupSyncStatus={backupSyncStatus}
        lastBackupSyncTime={lastBackupSyncTime}
        backupSyncError={backupSyncError}
        onSyncBackup={syncBackup}
        copyToClipboard={copyToClipboard}
        copiedMap={copiedMap}
      />

      <AdminsModal 
        isOpen={modalOpen.admins}
        admins={admins}
        onClose={() => toggleModal('admins', false)}
        onRefresh={fetchAdmins}
        copyToClipboard={copyToClipboard}
        copiedMap={copiedMap}
      />

      <SidecarProfileModal 
        isOpen={modalOpen.sidecarProfile}
        sidecarService={sidecarNode}
        onClose={() => toggleModal('sidecarProfile', false)}
        onRefresh={fetchServices}
      />
    </div>
  );
}
