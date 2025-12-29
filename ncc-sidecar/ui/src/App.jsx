import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Shield, Key, Globe, Plus, Trash2, Activity, Box, 
  ChevronRight, Smartphone, QrCode, Terminal, 
  Copy, Check, AlertCircle, RefreshCw, LogOut, ExternalLink,
  Radio
} from 'lucide-react';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { nip19, nip04, SimplePool } from 'nostr-tools';
import { QRCodeSVG } from 'qrcode.react';

const API_BASE = '/api';

const SERVICE_TYPES = [
  { id: 'relay', label: 'Nostr Relay', icon: <Radio className="w-4 h-4" />, defaultId: 'relay' },
  { id: 'blossom', label: 'Blossom Media', icon: <Box className="w-4 h-4" />, defaultId: 'media' },
  { id: 'nwc', label: 'Lightning (NWC)', icon: <Smartphone className="w-4 h-4" />, defaultId: 'nwc' },
  { id: 'custom', label: 'Custom API', icon: <Terminal className="w-4 h-4" />, defaultId: 'service' }
];

export default function App() {
  const [initialized, setInitialized] = useState(null);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loginMode, setLoginMode] = useState('choice');
  const [nip46Uri, setNip46Uri] = useState('');
  const [manualPubkey, setManualPubkey] = useState('');
  const [localNsec, setLocalNsec] = useState('');
  const [copied, setCopied] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('idle');
  const [showNewServiceModal, setShowNewServiceModal] = useState(false);
  const [proxyCheckResult, setProxyCheckResult] = useState(null);

  const checkProxy = async () => {
    try {
      setProxyCheckResult({ loading: true });
      const res = await axios.get(`${API_BASE}/network/detect-proxy`);
      setProxyCheckResult(res.data);
    } catch (e) {
      setProxyCheckResult({ error: e.message });
    }
  };

  const [setupData, setSetupData] = useState({
    adminPubkey: localStorage.getItem('ncc_admin_pk') || '',
    service: { type: 'custom', name: 'Identity Manager', service_id: 'sidecar', service_nsec: '' },
    config: {
      refresh_interval_minutes: 360,
      ncc02_expiry_days: 14,
      ncc05_ttl_hours: 12,
      service_mode: 'public',
      protocols: { ipv4: true, ipv6: true, tor: true },
      primary_protocol: 'ipv4'
    }
  });

  const [newService, setNewService] = useState({
    type: 'relay',
    name: '',
    service_id: 'relay',
    service_nsec: '',
    config: {
      refresh_interval_minutes: 360,
      ncc02_expiry_days: 14,
      ncc05_ttl_hours: 12,
      service_mode: 'public',
      protocols: { ipv4: true, ipv6: true, tor: true },
      primary_protocol: 'ipv4',
      profile: { about: '', picture: '' }
    }
  });

  useEffect(() => {
    checkStatus();
    if (initialized) {
      fetchServices();
      const interval = setInterval(fetchServices, 10000); // Polling logs/services every 10s
      return () => clearInterval(interval);
    }
  }, [initialized]);

  const fetchServices = async () => {
    try {
      const res = await axios.get(`${API_BASE}/services`);
      setServices(res.data);
      const logRes = await axios.get(`${API_BASE}/status`);
      if (logRes.data.logs) setLogs(logRes.data.logs);
    } catch (e) {}
  };

  const checkStatus = async () => {
    try {
      const res = await axios.get(`${API_BASE}/setup/status`);
      setInitialized(res.data.initialized);
      setLoading(false);
    } catch (e) { console.error(e); }
  };

  const fromNsecLocal = (nsec) => {
    try {
      const decoded = nip19.decode(nsec);
      return decoded.data;
    } catch (e) { return null; }
  };

  const saveAdminPk = (pk) => {
    setSetupData(prev => ({ ...prev, adminPubkey: pk }));
    localStorage.setItem('ncc_admin_pk', pk);
  };

  const startNIP46 = async () => {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const pool = new SimplePool();
    const relays = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band'];
    setConnectionStatus('listening');
    
    const relayParams = relays.map(r => `relay=${encodeURIComponent(r)}`).join('&');
    const uri = `nostrconnect://${pk}?${relayParams}&metadata=${encodeURIComponent(JSON.stringify({name: 'NCC Sidecar'}))}`;
    
    setNip46Uri(uri);
    setLoginMode('nip46');

    const sub = pool.subscribeMany(relays, [{ kinds: [24133], '#p': [pk] }], {
      onevent: async (event) => {
        try {
          const decrypted = await nip04.decrypt(sk, event.pubkey, event.content);
          const parsed = JSON.parse(decrypted);
          if (parsed.result === 'ack' || parsed.method === 'connect') {
            saveAdminPk(event.pubkey);
            sub.close();
            startProvisioning();
          }
        } catch (e) {}
      }
    });
  };

  const [provisioningProgress, setProvisioningProgress] = useState(0);
  const [provisioningLogs, setProvisioningLogs] = useState([]);

  const startProvisioning = async () => {
    setStep(2);
    const logsList = [
      "Initializing secure enclave...",
      "Generating unique Node Identity (Nostr)...",
      "Creating self-signed TLS certificates...",
      "Probing local network interfaces...",
      "Detecting Tor Onion service status...",
      "Finalizing discovery profile..."
    ];

    for (let i = 0; i < logsList.length; i++) {
      setProvisioningLogs(prev => [...prev, logsList[i]]);
      setProvisioningProgress(((i + 1) / logsList.length) * 100);
      await new Promise(r => setTimeout(r, 800));
    }

    try {
      await axios.post(`${API_BASE}/setup/init`, {
        adminPubkey: setupData.adminPubkey,
        config: setupData.config
      });
      setInitialized(true);
    } catch (e) {
      alert("Provisioning failed: " + e.message);
    }
  };

  const handleAddService = async () => {
    try {
      await axios.post(`${API_BASE}/service/add`, newService);
      setShowNewServiceModal(false);
      setNewService({ ...newService, name: '', service_nsec: '' });
      fetchServices();
    } catch (e) { alert("Failed to add service: " + e.message); }
  };

  const handleDeleteService = async (id) => {
    if (!confirm("Are you sure you want to delete this discovery profile?")) return;
    try {
      await axios.delete(`${API_BASE}/service/${id}`);
      fetchServices();
    } catch (e) { alert("Failed to delete service: " + e.message); }
  };

  const copyToClipboard = (text) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading || initialized === null) return (
    <div className="flex h-screen items-center justify-center bg-slate-950">
      <motion.div 
        animate={{ scale: [1, 1.1, 1], opacity: [0.5, 1, 0.5] }} 
        transition={{ repeat: Infinity, duration: 2 }}
        className="text-blue-500 font-black tracking-widest uppercase text-sm"
      >
        Connecting to Sidecar...
      </motion.div>
    </div>
  );

  if (initialized) {
    const sidecarNode = services.find(s => s.type === 'sidecar');
    const managedServices = services.filter(s => s.type !== 'sidecar');

    return (
      <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans selection:bg-blue-100 pb-20">
        <nav className="border-b border-slate-200 bg-white/80 backdrop-blur-md sticky top-0 z-50">
          <div className="max-w-6xl mx-auto px-6 h-20 flex justify-between items-center">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center shadow-lg shadow-slate-900/20">
                <Shield className="w-5 h-5 text-white" />
              </div>
              <div>
                <span className="text-lg font-black tracking-tighter uppercase block leading-none">NCC-06</span>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Sidecar Manager</span>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="hidden md:flex flex-col items-end mr-4">
                <span className="text-[10px] font-black text-slate-400 uppercase">Admin Authority</span>
                <span className="text-xs font-mono text-slate-600">{setupData.adminPubkey.slice(0, 8)}...{setupData.adminPubkey.slice(-8)}</span>
              </div>
              <button onClick={() => { localStorage.clear(); window.location.reload(); }} className="p-2 text-slate-400 hover:text-red-500 transition-colors">
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </nav>

        <main className="max-w-6xl mx-auto px-6 py-12">
          {sidecarNode && (
            <motion.section 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-16 bg-slate-900 rounded-[2.5rem] p-8 md:p-12 text-white shadow-2xl shadow-slate-900/40 relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 p-12 opacity-5 pointer-events-none">
                <Shield className="w-64 h-64" />
              </div>

              <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-8">
                <div className="space-y-4">
                  <div className="flex items-center space-x-3">
                    <div className="px-3 py-1 bg-blue-500 rounded-full text-[10px] font-black uppercase tracking-widest">Core Node</div>
                    <div className="flex items-center space-x-1.5">
                      <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 2 }} className="w-2 h-2 bg-green-500 rounded-full shadow-[0_0_10px_rgba(34,197,94,0.5)]" />
                      <span className="text-[10px] font-bold text-green-400 uppercase">System Online</span>
                    </div>
                  </div>
                  <h2 className="text-4xl font-black tracking-tight leading-none">Management Identity</h2>
                  <div className="flex items-center space-x-2 text-slate-400 font-mono text-sm">
                    {sidecarNode.service_nsec && (
                      <>
                        <span>{nip19.npubEncode(getPublicKey(fromNsecLocal(sidecarNode.service_nsec))).slice(0, 24)}...</span>
                        <button onClick={() => copyToClipboard(nip19.npubEncode(getPublicKey(fromNsecLocal(sidecarNode.service_nsec))))} className="hover:text-white transition-colors">
                          {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full md:w-auto">
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col justify-between relative overflow-hidden min-w-[200px]">
                    {sidecarNode.state?.is_probing && (
                      <motion.div 
                        initial={{ x: '-100%' }}
                        animate={{ x: '100%' }}
                        transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                        className="absolute top-0 left-0 h-0.5 w-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]"
                      />
                    )}
                    <span className="text-[9px] font-black text-slate-500 uppercase mb-2 tracking-widest flex justify-between items-center">
                      Active Endpoints
                      {sidecarNode.state?.is_probing && (
                        <span className="text-[8px] text-blue-400 animate-pulse lowercase font-medium">probing...</span>
                      )}
                    </span>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {sidecarNode.state?.last_inventory?.map((ep, i) => (
                        <div key={i} className="flex items-center space-x-1.5 bg-slate-800 px-2 py-1 rounded-md border border-white/5">
                          <div className={`w-1.5 h-1.5 rounded-full ${ep.family === 'onion' ? 'bg-purple-400' : 'bg-blue-400'}`} />
                          <span className="text-[9px] font-bold uppercase">{ep.family}</span>
                        </div>
                      ))}
                      {sidecarNode.config?.protocols?.tor && !sidecarNode.state?.last_inventory?.some(e => e.family === 'onion') && (
                        <div className={`flex items-center space-x-1.5 bg-slate-800 px-2 py-1 rounded-md border ${sidecarNode.state?.tor_status?.running ? 'border-yellow-500/30' : 'border-red-500/30'}`} title={sidecarNode.state?.tor_status?.running ? "Tor running but no Onion Service configured" : "Tor not detected"}>
                          <div className={`w-1.5 h-1.5 rounded-full ${sidecarNode.state?.tor_status?.running ? 'bg-yellow-500' : 'bg-red-500 animate-pulse'}`} />
                          <span className={`text-[9px] font-bold uppercase ${sidecarNode.state?.tor_status?.running ? 'text-yellow-500' : 'text-red-500'}`}>TOR</span>
                        </div>
                      )}
                      {(!sidecarNode.state?.last_inventory || sidecarNode.state.last_inventory.length === 0) && (!sidecarNode.config?.protocols?.tor || sidecarNode.state?.last_inventory?.some(e => e.family === 'onion')) && (
                        <p className="text-[10px] text-slate-500 font-medium italic">
                          {sidecarNode.state?.is_probing ? 'Probing network...' : 'No active endpoints detected'}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-4 min-w-[200px]">
                    <span className="text-[9px] font-black text-slate-500 uppercase mb-2 tracking-widest flex items-center">
                      <Key className="w-3 h-3 mr-1" /> TLS Security
                    </span>
                    <div className="mt-1">
                      <p className="text-[10px] font-bold text-blue-400 uppercase tracking-tighter">Self-Signed Active</p>
                      <p className="text-[10px] text-slate-500 font-medium truncate max-w-[120px]">{sidecarNode.state?.last_published_ncc02_id?.slice(0, 16) || 'Pending...'}</p>
                    </div>
                  </div>
                </div>
              </div>
            </motion.section>
          )}

          <header className="flex flex-col md:flex-row md:items-end justify-between mb-12 gap-6">
            <div>
              <h2 className="text-3xl font-black tracking-tight text-slate-900">Managed Services</h2>
              <p className="text-slate-500 font-medium mt-1">Active discovery profiles for hosted applications.</p>
            </div>
            <motion.button 
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setShowNewServiceModal(true)}
              className="bg-blue-600 text-white px-8 py-4 rounded-2xl font-bold flex items-center shadow-xl shadow-blue-600/20 hover:bg-blue-700 transition-all"
            >
              <Plus className="w-5 h-5 mr-2" /> NEW SERVICE PROFILE
            </motion.button>
          </header>

          <AnimatePresence>
            {showNewServiceModal && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setShowNewServiceModal(false)}
                  className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
                />
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 20 }}
                  className="relative bg-white rounded-[3rem] shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200"
                >
                  <div className="bg-slate-900 p-8 text-white flex justify-between items-center">
                    <h2 className="text-2xl font-black tracking-tight">New Profile</h2>
                    <button onClick={() => setShowNewServiceModal(false)} className="text-slate-400 hover:text-white transition-colors">
                      <Plus className="w-6 h-6 rotate-45" />
                    </button>
                  </div>
                  <div className="p-8 space-y-6 max-h-[70vh] overflow-y-auto">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Type</label>
                      <div className="grid grid-cols-2 gap-3">
                        {SERVICE_TYPES.map(t => (
                          <button 
                            key={t.id}
                            onClick={() => setNewService(d => ({ ...d, type: t.id, service_id: t.defaultId }))}
                            className={`p-4 rounded-2xl border transition-all flex items-center space-x-3 ${newService.type === t.id ? 'bg-blue-600/10 border-blue-500 text-blue-600' : 'bg-slate-50 border-slate-100 text-slate-400 hover:border-slate-200'}`}
                          >
                            {t.icon}
                            <span className="text-[10px] font-black uppercase tracking-widest">{t.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Visibility</label>
                      <div className="flex bg-slate-50 p-1 rounded-2xl border border-slate-100">
                        {['public', 'private'].map(m => (
                          <button 
                            key={m} 
                            onClick={() => setNewService(d => ({ ...d, config: { ...d.config, service_mode: m } }))} 
                            className={`flex-1 py-3 rounded-xl text-xs font-bold uppercase transition-all ${newService.config.service_mode === m ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Service Identity</label>
                      <input 
                        type="text" placeholder="Service Name (e.g. My Relay)" 
                        className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-5 text-sm font-bold outline-none focus:border-blue-500/50 transition-colors mb-2"
                        value={newService.name}
                        onChange={(e) => setNewService(d => ({ ...d, name: e.target.value }))}
                      />
                      <input 
                        type="text" placeholder="About / Bio (Optional)" 
                        className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 text-xs font-medium outline-none focus:border-blue-500/50 transition-colors mb-2"
                        value={newService.config.profile?.about || ''}
                        onChange={(e) => setNewService(d => ({ ...d, config: { ...d.config, profile: { ...d.config.profile, about: e.target.value } } }))}
                      />
                      <input 
                        type="text" placeholder="Picture URL (Optional)" 
                        className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 text-xs font-medium outline-none focus:border-blue-500/50 transition-colors"
                        value={newService.config.profile?.picture || ''}
                        onChange={(e) => setNewService(d => ({ ...d, config: { ...d.config, profile: { ...d.config.profile, picture: e.target.value } } }))}
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Secret Key (NSEC)</label>
                      <div className="flex space-x-2">
                        <input 
                          type="password" placeholder="nsec1..." 
                          className="flex-1 bg-slate-50 border border-slate-100 rounded-2xl p-5 text-xs font-mono outline-none focus:border-blue-500/50 transition-colors"
                          value={newService.service_nsec}
                          onChange={(e) => setNewService(d => ({ ...d, service_nsec: e.target.value }))}
                        />
                        {newService.service_nsec && (
                          <button 
                            onClick={() => copyToClipboard(newService.service_nsec)}
                            className="bg-slate-100 text-slate-600 p-5 rounded-2xl hover:bg-slate-200 transition-all"
                          >
                            {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                          </button>
                        )}
                        <button 
                          onClick={async () => {
                            const res = await axios.get(`${API_BASE}/service/generate-key`);
                            setNewService(d => ({ ...d, service_nsec: res.data.nsec }));
                          }}
                          className="bg-slate-900 text-white p-5 rounded-2xl hover:bg-slate-800 transition-all"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Service Port</label>
                        <input 
                          type="number" placeholder="e.g. 80" 
                          className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-5 text-sm font-bold outline-none focus:border-blue-500/50 transition-colors"
                          value={newService.config.port || ''}
                          onChange={(e) => setNewService(d => ({ ...d, config: { ...d.config, port: parseInt(e.target.value) } }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Priority</label>
                        <input 
                          type="number" placeholder="1" 
                          className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-5 text-sm font-bold outline-none focus:border-blue-500/50 transition-colors"
                          value={newService.config.priority || 1}
                          onChange={(e) => setNewService(d => ({ ...d, config: { ...d.config, priority: parseInt(e.target.value) } }))}
                        />
                      </div>
                    </div>

                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Environment Check</span>
                        <button onClick={checkProxy} className="text-[10px] font-bold text-blue-500 hover:text-blue-600 flex items-center">
                           {proxyCheckResult?.loading && <RefreshCw className="w-3 h-3 mr-1 animate-spin" />} Detect Reverse Proxy
                        </button>
                      </div>
                      {proxyCheckResult && !proxyCheckResult.loading && (
                        <div className="text-[10px] font-mono p-2 bg-white rounded-xl border border-slate-100">
                            {proxyCheckResult.detected ? (
                                <div className="text-green-600 flex items-center">
                                    <Check className="w-3 h-3 mr-1.5" />
                                    <span>Proxy Detected ({proxyCheckResult.details?.['x-forwarded-proto'] || 'HTTP'})</span>
                                </div>
                            ) : (
                                <div className="text-slate-500 flex items-center">
                                    <Globe className="w-3 h-3 mr-1.5" />
                                    <span>Direct Connection (Public IP)</span>
                                </div>
                            )}
                            <div className="mt-1 text-slate-400 text-[9px] break-all">
                                Host: {proxyCheckResult.details?.host}
                            </div>
                        </div>
                      )}
                    </div>

                    <button 
                      onClick={handleAddService}
                      disabled={!newService.name || !newService.service_nsec}
                      className="w-full bg-blue-600 disabled:opacity-50 text-white font-black py-5 rounded-3xl shadow-xl shadow-blue-600/20 hover:bg-blue-700 transition-all"
                    >
                      ADD DISCOVERY PROFILE
                    </button>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <AnimatePresence>
              {managedServices.map((s, i) => (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  key={s.id} 
                  className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-200 hover:shadow-2xl hover:border-slate-300 transition-all group relative overflow-hidden"
                >
                  <div className="flex justify-between items-start mb-8 relative z-10">
                    <div className="w-14 h-14 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-900 border border-slate-100 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
                      <Box className="w-7 h-7" />
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{s.type}</span>
                      <div className="flex items-center space-x-1">
                        <motion.div 
                          animate={{ opacity: [0.3, 1, 0.3] }}
                          transition={{ repeat: Infinity, duration: 2 }}
                          className="w-2 h-2 bg-green-500 rounded-full" 
                        />
                        <span className="text-[10px] font-bold text-green-600 uppercase">Active</span>
                      </div>
                    </div>
                  </div>

                  <div className="mb-8 relative z-10">
                    <h3 className="text-xl font-black text-slate-900 leading-tight mb-1">{s.name}</h3>
                    <p className="text-xs font-mono text-slate-400 truncate">{s.service_id}</p>
                  </div>

                  <div className="space-y-4 relative z-10">
                    <div className="flex flex-wrap gap-2">
                      {s.state?.last_inventory?.map((ep, idx) => (
                        <div key={idx} className="flex items-center space-x-1.5 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">
                          <div className={`w-1.5 h-1.5 rounded-full ${ep.family === 'onion' ? 'bg-purple-500' : ep.family === 'ipv6' ? 'bg-blue-500' : 'bg-green-500'}`} />
                          <span className="text-[9px] font-black uppercase text-slate-500">{ep.family}</span>
                        </div>
                      ))}
                      {s.config?.protocols?.tor && !s.state?.last_inventory?.some(e => e.family === 'onion') && (
                        <div className={`flex items-center space-x-1.5 bg-slate-100 px-2.5 py-1 rounded-lg border ${s.state?.tor_status?.running ? 'border-yellow-500/50' : 'border-red-500/50'}`} title={s.state?.tor_status?.running ? "Tor running but no Onion Service configured" : "Tor not detected"}>
                          <div className={`w-1.5 h-1.5 rounded-full ${s.state?.tor_status?.running ? 'bg-yellow-500' : 'bg-red-500 animate-pulse'}`} />
                          <span className={`text-[9px] font-black uppercase ${s.state?.tor_status?.running ? 'text-yellow-600' : 'text-red-500'}`}>TOR</span>
                        </div>
                      )}
                      {(!s.state?.last_inventory || s.state.last_inventory.length === 0) && (!s.config?.protocols?.tor || s.state?.last_inventory?.some(e => e.family === 'onion')) && (
                        <p className="text-[9px] text-slate-400 italic">
                          {s.state?.is_probing ? 'Probing...' : 'No active endpoints'}
                        </p>
                      )}
                    </div>

                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 flex justify-between">
                        Discovery Fingerprint (K)
                        <Activity className="w-3 h-3 text-blue-500" />
                      </p>
                      <code className="text-[10px] text-slate-600 font-mono break-all leading-relaxed line-clamp-2">
                        {s.state?.last_published_ncc02_id || 'Waiting for cycle...'}
                      </code>
                    </div>

                    <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 px-1 uppercase tracking-tighter">
                      <span>Last Update</span>
                      <span className="text-slate-900">{s.state?.last_full_publish_timestamp ? new Date(s.state.last_full_publish_timestamp).toLocaleTimeString() : 'Pending'}</span>
                    </div>
                  </div>
                  
                  <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                      onClick={() => handleDeleteService(s.id)}
                      className="p-2 text-slate-300 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          <section className="mt-20">
            <div className="flex items-center space-x-3 mb-6">
              <Terminal className="w-5 h-5 text-slate-400" />
              <h2 className="text-xl font-black text-slate-900 tracking-tight">System Logs</h2>
            </div>
            <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden font-mono text-[10px]">
              <div className="max-h-60 overflow-y-auto p-6 space-y-2">
                {logs.length > 0 ? (
                  logs.map((log, i) => (
                    <div key={i} className="flex space-x-4 border-b border-slate-50 pb-2 last:border-0">
                      <span className="text-slate-400 shrink-0">{new Date(log.timestamp).toLocaleTimeString()}</span>
                      <span className={`font-bold shrink-0 ${log.level === 'error' ? 'text-red-500' : 'text-blue-500'}`}>{log.level.toUpperCase()}</span>
                      <span className="text-slate-600">{log.message}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-slate-400 italic">No system logs available yet.</p>
                )}
              </div>
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6 font-sans">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-xl w-full"
      >
        <div className="bg-slate-900 rounded-[3rem] shadow-2xl border border-white/5 overflow-hidden">
          <div className="h-2 bg-slate-800 w-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${(step / 3) * 100}%` }}
              className="h-full bg-gradient-to-r from-blue-600 to-indigo-500"
            />
          </div>

          <div className="p-12">
            <AnimatePresence mode="wait">
              {step === 1 && (
                <motion.div 
                  key="step1"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-10"
                >
                  <div className="space-y-2 text-center">
                    <div className="w-20 h-20 bg-blue-500/10 rounded-[2rem] flex items-center justify-center mx-auto border border-blue-500/20 mb-6">
                      <Shield className="w-10 h-10 text-blue-400" />
                    </div>
                    <h1 className="text-4xl font-black tracking-tight leading-none">Initialize Node</h1>
                    <p className="text-slate-400 font-medium">Connect your admin identity to provision the Sidecar.</p>
                  </div>

                  {loginMode === 'choice' && (
                    <div className="grid grid-cols-1 gap-4">
                      {[
                        { id: 'nip07', label: 'Browser Extension', icon: <Smartphone className="w-5 h-5 text-blue-400" />, desc: 'Use Alby, Nos2x, or similar', action: () => { if(window.nostr) { window.nostr.getPublicKey().then(pk => { saveAdminPk(pk); startProvisioning(); }); } else alert("Extension not found"); } },
                        { id: 'nip46', label: 'Remote Signer', icon: <QrCode className="w-5 h-5 text-indigo-400" />, desc: 'Connect via Amber, Nex, or Bunker', action: startNIP46 },
                        { id: 'advanced', label: 'Advanced Options', icon: <Terminal className="w-5 h-5 text-slate-400" />, desc: 'Manual Pubkey or NSEC entry', action: () => setLoginMode('advanced') }
                      ].map(m => (
                        <button key={m.id} onClick={m.action} className="flex items-center justify-between p-6 bg-slate-800/50 rounded-3xl border border-white/5 hover:bg-slate-800 hover:border-white/10 transition-all group">
                          <div className="flex items-center space-x-5 text-left">
                            <div className="w-12 h-12 bg-slate-900 rounded-2xl flex items-center justify-center border border-white/5">{m.icon}</div>
                            <div>
                              <p className="font-bold text-white">{m.label}</p>
                              <p className="text-xs text-slate-500 font-medium">{m.desc}</p>
                            </div>
                          </div>
                          <ChevronRight className="w-5 h-5 text-slate-600 group-hover:text-white transition-colors" />
                        </button>
                      ))}
                    </div>
                  )}

                  {loginMode === 'nip46' && (
                    <div className="space-y-8 animate-in fade-in zoom-in-95 text-center">
                      <div className="bg-white p-8 rounded-[3rem] w-fit mx-auto shadow-[0_0_50px_rgba(37,99,235,0.2)]">
                        <QRCodeSVG value={nip46Uri} size={220} />
                      </div>
                      <div className="flex justify-center">
                        <button 
                          onClick={() => copyToClipboard(nip46Uri)}
                          className="flex items-center space-x-2 bg-slate-800 px-4 py-2 rounded-full text-[10px] font-black uppercase text-slate-400 hover:text-white transition-colors"
                        >
                          {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                          <span>{copied ? 'Copied URI' : 'Copy Connection URI'}</span>
                        </button>
                      </div>
                      <div className="space-y-4">
                        <p className="text-xs font-black text-blue-400 animate-pulse uppercase tracking-widest">Awaiting Signer Approval</p>
                        <div className="max-w-[280px] mx-auto">
                          <input 
                            type="text" placeholder="Or paste Pubkey manually" 
                            className="w-full bg-slate-800 border border-white/5 rounded-2xl p-4 text-[10px] font-mono outline-none text-white focus:border-blue-500 transition-colors"
                            value={manualPubkey}
                            onChange={(e) => setManualPubkey(e.target.value)}
                          />
                          {manualPubkey && (
                            <button onClick={() => { saveAdminPk(manualPubkey); startProvisioning(); }} className="w-full mt-3 bg-slate-800 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest border border-blue-500/30 text-blue-400">Force Connection</button>
                          )}
                        </div>
                      </div>
                      <button onClick={() => setLoginMode('choice')} className="text-slate-500 font-bold text-xs uppercase tracking-widest hover:text-white transition-colors">Back to Options</button>
                    </div>
                  )}

                  {loginMode === 'advanced' && (
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
                      <div className="p-6 bg-red-500/5 border border-red-500/10 rounded-3xl flex items-start space-x-4">
                        <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-xs font-bold text-red-500 uppercase tracking-tight mb-1">Security Notice</p>
                          <p className="text-xs text-slate-400 leading-relaxed">Direct NSEC entry should only be used in trusted, local-only environments.</p>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <input 
                          type="password" placeholder="nsec1..." 
                          className="w-full bg-slate-800 border border-white/5 rounded-2xl p-5 text-sm font-mono outline-none focus:border-red-500/50 transition-colors"
                          value={localNsec}
                          onChange={(e) => setLocalNsec(e.target.value)}
                        />
                        <button onClick={() => {
                          try {
                            const pk = localNsec.startsWith('nsec1') ? getPublicKey(nip19.decode(localNsec).data) : getPublicKey(new Uint8Array(localNsec.match(/.{1,2}/g).map(byte => parseInt(byte, 16))));
                            saveAdminPk(pk);
                            startProvisioning();
                          } catch(e) { alert("Invalid Key"); }
                        }} className="w-full bg-white text-slate-900 font-black py-5 rounded-3xl shadow-xl hover:bg-slate-100 transition-all">START PROVISIONING</button>
                      </div>
                      <button onClick={() => setLoginMode('choice')} className="text-slate-500 font-bold text-xs uppercase tracking-widest hover:text-white transition-colors text-center">Return to Safety</button>
                    </div>
                  )}
                </motion.div>
              )}

              {step === 2 && (
                <motion.div 
                  key="step2"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="space-y-10"
                >
                  <div className="space-y-2 text-center">
                    <motion.div 
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 4, ease: "linear" }}
                      className="w-24 h-24 bg-gradient-to-tr from-blue-600 to-indigo-500 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-2xl shadow-blue-500/20 mb-8"
                    >
                      <RefreshCw className="w-10 h-10 text-white" />
                    </motion.div>
                    <h1 className="text-3xl font-black tracking-tight">Provisioning Node</h1>
                    <p className="text-slate-400 font-medium italic">Automating secure identity and network discovery...</p>
                  </div>

                  <div className="space-y-6">
                    <div className="h-3 bg-slate-800 rounded-full overflow-hidden border border-white/5">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${provisioningProgress}%` }}
                        className="h-full bg-gradient-to-r from-blue-600 to-indigo-400"
                      />
                    </div>

                    <div className="bg-slate-950/50 rounded-3xl p-6 border border-white/5 font-mono text-[10px] space-y-2 h-40 overflow-y-auto">
                      {provisioningLogs.map((log, i) => (
                        <motion.div 
                          initial={{ opacity: 0, x: -5 }}
                          animate={{ opacity: 1, x: 0 }}
                          key={i} 
                          className="flex items-center space-x-2"
                        >
                          <span className="text-blue-500 font-black">›</span>
                          <span className="text-slate-300">{log}</span>
                          {i === provisioningLogs.length - 1 && i < 5 && <span className="w-1 h-3 bg-blue-500 animate-pulse" />}
                          {i < provisioningLogs.length - 1 && <Check className="w-3 h-3 text-green-500 ml-auto" />}
                        </motion.div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
        
        <p className="text-center mt-8 text-slate-600 text-[10px] font-black uppercase tracking-[0.3em] opacity-50">
          Identity Discovery Node • v1.0.0
        </p>
      </motion.div>
    </div>
  );
}