import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Shield, Key, Globe, Plus, Trash2, Activity, Box, 
  ChevronRight, Smartphone, QrCode, Terminal, 
  Copy, Check, AlertCircle, RefreshCw, LogOut, ExternalLink,
  Radio, Menu
} from 'lucide-react';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { nip19, nip04, nip44, SimplePool } from 'nostr-tools';
import { QRCodeSVG } from 'qrcode.react';

const toHex = (bytes) => Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
const hexToBytes = (hex) => new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

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
  const [stylesReady, setStylesReady] = useState(false);
  const [services, setServices] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loginMode, setLoginMode] = useState('choice');
  const [nip46Uri, setNip46Uri] = useState('');
  const [manualPubkey, setManualPubkey] = useState('');
  const [localNsec, setLocalNsec] = useState('');
  const [copiedMap, setCopiedMap] = useState({});
  const [connectionStatus, setConnectionStatus] = useState('idle');
  const [showNewServiceModal, setShowNewServiceModal] = useState(false);
  const [proxyCheckResult, setProxyCheckResult] = useState(null);
  const [networkAvailability, setNetworkAvailability] = useState({ ipv4: false, ipv6: false, tor: false });
  const [editServiceId, setEditServiceId] = useState(null);
  const [showMenu, setShowMenu] = useState(false);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [admins, setAdmins] = useState([]);
  const [inviteNpub, setInviteNpub] = useState('');
  const [relayStatus, setRelayStatus] = useState({});
  const [nip46Logs, setNip46Logs] = useState([]);

  const addNip46Log = (msg) => {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setNip46Logs(prev => [...prev.slice(-4), `[${time}] ${msg}`]);
  };

  const fetchAdmins = async () => {
    try {
      const res = await axios.get(`${API_BASE}/admins`);
      setAdmins(res.data);
    } catch (e) {}
  };

  const handleInviteAdmin = async () => {
    if (!inviteNpub) return;
    try {
      await axios.post(`${API_BASE}/admin/invite`, { npub: inviteNpub });
      setInviteNpub('');
      fetchAdmins();
      alert("Invite sent via Nostr DM!");
    } catch (e) { alert(e.message); }
  };

  const handleRemoveAdmin = async (pubkey) => {
    if (!confirm("Remove this admin?")) return;
    try {
      await axios.delete(`${API_BASE}/admin/${pubkey}`);
      fetchAdmins();
    } catch (e) { alert(e.message); }
  };

  const checkNetworkAvailability = async () => {
    try {
      const [netRes, torRes] = await Promise.all([
        axios.get(`${API_BASE}/network/probe`),
        axios.get(`${API_BASE}/tor/status`)
      ]);
      setNetworkAvailability({
        ipv4: !!netRes.data.ipv4,
        ipv6: !!netRes.data.ipv6,
        tor: !!torRes.data.running
      });
    } catch (e) {
      console.warn("Network probe failed:", e);
    }
  };

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
    // Ensure styles are parsed before revealing the UI
    const timer = setTimeout(() => setStylesReady(true), 500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    checkStatus();
    checkNetworkAvailability();
    if (initialized) {
      fetchServices();
      const interval = setInterval(fetchServices, 10000); // Polling logs/services every 10s
      return () => clearInterval(interval);
    }
  }, [initialized]);

  const fetchServices = async () => {
    try {
      const res = await axios.get(`${API_BASE}/services`);
      setServices(prev => {
        // Optimization: prevent re-renders if data is identical
        if (JSON.stringify(prev) === JSON.stringify(res.data)) return prev;
        return res.data;
      });
      
      const logRes = await axios.get(`${API_BASE}/status`);
      if (logRes.data.logs) {
        setLogs(prev => {
          if (JSON.stringify(prev) === JSON.stringify(logRes.data.logs)) return prev;
          return logRes.data.logs;
        });
      }
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

  const verifyAndSaveAdmin = async (pk) => {
    if (initialized) {
      try {
        const res = await axios.get(`${API_BASE}/admins`);
        const isAdmin = res.data.some(a => a.pubkey === pk);
        if (!isAdmin) {
          alert("Unauthorized: This identity is not an administrator of this node.");
          return false;
        }
      } catch (e) {
        alert("Verification failed: " + e.message);
        return false;
      }
    }
    saveAdminPk(pk);
    handleAuthComplete();
    return true;
  };

  const handleAuthComplete = () => {
    if (!initialized) {
      startProvisioning();
    }
  };

  const startNIP46 = async () => {
    const sk = generateSecretKey();
    const pkRaw = getPublicKey(sk);
    const pk = (typeof pkRaw === 'string') ? pkRaw : toHex(pkRaw);
    
    const pool = new SimplePool();
    const relays = [
      'wss://relay.nsec.app',
      'wss://offchain.pub',
      'wss://nos.lol',
      'wss://relay.damus.io',
      'wss://relay.primal.net',
      'wss://relay.nostr.band'
    ];
    
    setConnectionStatus('listening');
    setRelayStatus(Object.fromEntries(relays.map(r => [r, 'connecting'])));
    setNip46Logs([]);
    addNip46Log("Initializing secure channel...");
    
    const uri = `nostrconnect://${pk}?${relays.map(r => `relay=${encodeURIComponent(r)}`).join('&')}&metadata=${encodeURIComponent(JSON.stringify({ name: 'NCC Sidecar' }))}`;
    setNip46Uri(uri);
    setLoginMode('nip46');

    const handleEvent = async (event) => {
      try {
        addNip46Log("Received response!");
        let decrypted;
        try {
          decrypted = await nip04.decrypt(sk, event.pubkey, event.content);
        } catch (err) {
          const conversationKey = nip44.getConversationKey(sk, hexToBytes(event.pubkey));
          decrypted = nip44.decrypt(event.content, conversationKey);
        }
        const parsed = JSON.parse(decrypted);
        if (parsed.result || parsed.method === 'connect') {
          const adminPk = (parsed.result && parsed.result !== 'ack') ? parsed.result : event.pubkey;
          addNip46Log("Verifying authority...");
          const success = await verifyAndSaveAdmin(adminPk);
          if (success) {
            addNip46Log("Handshake complete!");
            pool.destroy();
          } else {
            addNip46Log("Verification failed.");
          }
        }
      } catch (e) {
        console.warn("[NIP-46] Error:", e.message);
      }
    };

    // Subscribe to each relay individually for maximum compatibility
    relays.forEach(async (url) => {
      try {
        const relay = await pool.ensureRelay(url);
        setRelayStatus(prev => ({ ...prev, [url]: 'connected' }));
        addNip46Log(`Listening on ${url.split('//')[1]}`);
        
        const sub = relay.sub([{ kinds: [24133], "#p": [pk] }]);
        sub.on('event', handleEvent);
        sub.on('eose', () => console.log(`[NIP-46] EOSE from ${url}`));
      } catch (e) {
        setRelayStatus(prev => ({ ...prev, [url]: 'failed' }));
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

  const handleCloseModal = () => {
    setShowNewServiceModal(false);
    setEditServiceId(null);
    setNewService({ 
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
  };

  const handleSaveService = async () => {
    try {
      if (editServiceId) {
        await axios.put(`${API_BASE}/service/${editServiceId}`, newService);
      } else {
        await axios.post(`${API_BASE}/service/add`, newService);
      }
      setShowNewServiceModal(false);
      setEditServiceId(null);
      setNewService({ 
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
      fetchServices();
    } catch (e) { alert(`Failed to ${editServiceId ? 'update' : 'add'} service: ` + e.message); }
  };

  const handleEditService = (service) => {
    setEditServiceId(service.id);
    setNewService({
        type: service.type,
        name: service.name,
        service_id: service.service_id,
        service_nsec: service.service_nsec,
        config: service.config
    });
    setShowNewServiceModal(true);
  };

  const handleDeleteService = async (id) => {
    if (!confirm("Are you sure you want to delete this discovery profile?")) return;
    try {
      await axios.delete(`${API_BASE}/service/${id}`);
      fetchServices();
      if (showNewServiceModal) setShowNewServiceModal(false);
    } catch (e) { alert("Failed to delete service: " + e.message); }
  };

  const copyToClipboard = (text, key) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedMap(prev => ({ ...prev, [key]: true }));
    setTimeout(() => setCopiedMap(prev => ({ ...prev, [key]: false })), 2000);
  };

  const isDataReady = initialized === false || (initialized === true && services.some(s => s.type === 'sidecar'));

  useEffect(() => {
    if (services.length > 0) {
      console.log("[UI] Services loaded:", services.map(s => `${s.name} (${s.type})`));
    }
  }, [services]);

  if (loading || !stylesReady || initialized === null || !isDataReady) return null;

  const isAuthenticated = initialized && setupData.adminPubkey;

  if (isAuthenticated) {
    const sidecarNode = services.find(s => s.type === 'sidecar');
    const managedServices = services.filter(s => s.type !== 'sidecar');
    const onionEndpoint = sidecarNode?.state?.last_inventory?.find(e => e.family === 'onion');

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
              <div className="relative">
                {showMenu && <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />}
                <button onClick={() => setShowMenu(!showMenu)} className="p-2 text-slate-400 hover:text-blue-500 transition-colors relative z-50">
                  <Menu className="w-5 h-5" />
                </button>
                {showMenu && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="absolute top-full right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-slate-100 overflow-hidden z-50"
                  >
                    <button onClick={() => { setShowMenu(false); handleEditService(sidecarNode); }} className="w-full text-left px-4 py-3 text-xs font-bold text-slate-600 hover:bg-slate-50 hover:text-blue-600 transition-colors">
                      Node Settings
                    </button>
                    <button onClick={() => { setShowMenu(false); setShowAdminModal(true); fetchAdmins(); }} className="w-full text-left px-4 py-3 text-xs font-bold text-slate-600 hover:bg-slate-50 hover:text-blue-600 border-t border-slate-50 transition-colors">
                      Administrators
                    </button>
                  </motion.div>
                )}
              </div>
              <button onClick={() => { localStorage.clear(); window.location.reload(); }} className="p-2 text-slate-400 hover:text-red-500 transition-colors">
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </nav>

        <main className="max-w-6xl mx-auto px-6 py-12">
          {sidecarNode && (
            <section 
              onClick={() => handleEditService(sidecarNode)}
              className="mb-16 bg-slate-900 rounded-[2.5rem] p-8 md:p-12 text-white shadow-2xl shadow-slate-900/40 relative overflow-hidden cursor-pointer border-2 border-blue-500/20"
            >
              <div className="absolute top-0 right-0 p-12 opacity-5 pointer-events-none">
                <Shield className="w-64 h-64" />
              </div>

              <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-8">
                <div className="space-y-4">
                  <div className="flex items-center space-x-3">
                    <div className="px-3 py-1 bg-blue-500 rounded-full text-[10px] font-black uppercase tracking-widest">Core Node</div>
                    <div className="flex items-center space-x-1.5">
                      <div className="w-2 h-2 bg-green-500 rounded-full shadow-[0_0_10px_rgba(34,197,94,0.5)] animate-pulse" />
                      <span className="text-[10px] font-bold text-green-400 uppercase">System Online</span>
                    </div>
                  </div>
                  <h2 
                    className="text-4xl font-black tracking-tight leading-none hover:text-blue-400 transition-colors"
                  >
                    Management Identity
                  </h2>
                  <div className="flex flex-col space-y-1 text-slate-400 font-mono text-sm">
                    {(() => {
                      const sk = fromNsecLocal(sidecarNode.service_nsec);
                      if (!sk) return <span className="text-red-400">Invalid Key</span>;
                      const npub = nip19.npubEncode(getPublicKey(sk));
                      return (
                        <div className="flex items-center space-x-2">
                          <span>{npub.slice(0, 24)}...</span>
                          <button onClick={(e) => { e.stopPropagation(); copyToClipboard(npub, 'npub'); }} className="hover:text-white transition-colors">
                            {copiedMap['npub'] ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </div>
                      );
                    })()}
                    {onionEndpoint && (
                      <div className="flex items-center space-x-2 text-purple-400 text-[10px] bg-purple-500/10 w-fit px-2 py-0.5 rounded-md border border-purple-500/20">
                        <Globe className="w-3 h-3" />
                        <span>{onionEndpoint.url}</span>
                        <button onClick={(e) => { e.stopPropagation(); copyToClipboard(onionEndpoint.url, 'onion'); }} className="hover:text-white transition-colors">
                          {copiedMap['onion'] ? <Check className="w-2.5 h-2.5 text-green-500" /> : <Copy className="w-2.5 h-2.5" />}
                        </button>
                      </div>
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
            </section>
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
                  onClick={handleCloseModal}
                  className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
                />
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 20 }}
                  className="relative bg-white rounded-[3rem] shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200"
                >
                  <div className="bg-slate-900 p-8 text-white flex justify-between items-center">
                    <h2 className="text-2xl font-black tracking-tight">{editServiceId ? 'Edit Profile' : 'New Profile'}</h2>
                    <button onClick={handleCloseModal} className="text-slate-400 hover:text-white transition-colors">
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
                            onClick={() => copyToClipboard(newService.service_nsec, 'nsec')}
                            className="bg-slate-100 text-slate-600 p-5 rounded-2xl hover:bg-slate-200 transition-all"
                          >
                            {copiedMap['nsec'] ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
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

                    <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Network Protocols</label>
                        <div className="flex space-x-2">
                            {['ipv4', 'ipv6', 'tor'].map(p => {
                                const isAvailable = networkAvailability[p];
                                return (
                                    <button
                                        key={p}
                                        disabled={!isAvailable}
                                        onClick={() => setNewService(d => ({ ...d, config: { ...d.config, protocols: { ...d.config.protocols, [p]: !d.config.protocols[p] } } }))}
                                        className={`flex-1 py-3 rounded-xl border flex items-center justify-center space-x-2 transition-all ${
                                            !isAvailable ? 'bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed' :
                                            newService.config.protocols[p] ? 'bg-blue-50 border-blue-200 text-blue-600 shadow-sm' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                                        }`}
                                    >
                                        <div className={`w-2 h-2 rounded-full ${!isAvailable ? 'bg-slate-300' : newService.config.protocols[p] ? 'bg-blue-500' : 'bg-slate-200'}`} />
                                        <span className="text-xs font-bold uppercase">{p}</span>
                                    </button>
                                );
                            })}
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

                    {editServiceId && (
                        <div className="bg-red-50 p-4 rounded-2xl border border-red-100 space-y-3">
                            <span className="text-[10px] font-black text-red-400 uppercase tracking-widest">Danger Zone</span>
                            <div className="flex space-x-2">
                                <button onClick={async () => {
                                    if(!confirm('Regenerate NSEC? This will invalidate existing identity.')) return;
                                    const res = await axios.get(`${API_BASE}/service/generate-key`);
                                    setNewService(d => ({ ...d, service_nsec: res.data.nsec }));
                                }} className="flex-1 py-2 bg-white border border-red-200 text-red-500 rounded-xl text-[10px] font-bold hover:bg-red-50">ROTATE NSEC</button>
                                
                                <button onClick={() => {
                                    if(!confirm('Rotate Onion Address? This will happen on next save.')) return;
                                    setNewService(d => ({ ...d, config: { ...d.config, onion_private_key: undefined } }));
                                }} className="flex-1 py-2 bg-white border border-red-200 text-red-500 rounded-xl text-[10px] font-bold hover:bg-red-50">ROTATE ONION</button>
                            </div>
                        </div>
                    )}

                    <button 
                      onClick={handleSaveService}
                      disabled={!newService.name || !newService.service_nsec}
                      className="w-full bg-blue-600 disabled:opacity-50 text-white font-black py-5 rounded-3xl shadow-xl shadow-blue-600/20 hover:bg-blue-700 transition-all"
                    >
                      {editServiceId ? 'UPDATE PROFILE' : 'ADD DISCOVERY PROFILE'}
                    </button>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {showAdminModal && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setShowAdminModal(false)}
                  className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
                />
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 20 }}
                  className="relative bg-white rounded-[3rem] shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200"
                >
                  <div className="bg-slate-900 p-8 text-white flex justify-between items-center">
                    <h2 className="text-2xl font-black tracking-tight">Administrators</h2>
                    <button onClick={() => setShowAdminModal(false)} className="text-slate-400 hover:text-white transition-colors">
                      <Plus className="w-6 h-6 rotate-45" />
                    </button>
                  </div>
                  <div className="p-8 space-y-8">
                    <div className="space-y-3">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Invite New Admin</label>
                      <div className="flex space-x-2">
                        <input 
                          type="text" placeholder="Paste npub..." 
                          className="flex-1 bg-slate-50 border border-slate-100 rounded-2xl p-4 text-xs font-mono outline-none focus:border-blue-500/50 transition-colors"
                          value={inviteNpub}
                          onChange={(e) => setInviteNpub(e.target.value)}
                        />
                        <button onClick={handleInviteAdmin} className="bg-blue-600 text-white px-6 rounded-2xl font-bold text-[10px] hover:bg-blue-700 transition-colors">SEND INVITE</button>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Authority Management</label>
                      <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-2">
                        {admins.map((admin, idx) => (
                          <div key={admin.pubkey} className="flex items-center justify-between bg-slate-50 p-4 rounded-2xl border border-slate-100 group">
                            <div className="space-y-1">
                              <p className="text-[10px] font-mono font-bold text-slate-600">{nip19.npubEncode(admin.pubkey).slice(0, 16)}...{nip19.npubEncode(admin.pubkey).slice(-8)}</p>
                              <div className="flex items-center space-x-2">
                                <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded ${admin.status === 'active' ? 'bg-green-100 text-green-600' : 'bg-yellow-100 text-yellow-600'}`}>{admin.status}</span>
                                {idx === 0 && <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-blue-100 text-blue-600">Primary Owner</span>}
                              </div>
                            </div>
                            <div className="flex items-center space-x-1">
                                <button onClick={() => copyToClipboard(nip19.npubEncode(admin.pubkey), `admin-${idx}`)} className="p-2 text-slate-300 hover:text-blue-500 transition-colors">
                                    {copiedMap[`admin-${idx}`] ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                                </button>
                                {idx !== 0 && (
                                    <button onClick={() => handleRemoveAdmin(admin.pubkey)} className="p-2 text-slate-300 hover:text-red-500 transition-colors">
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
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

                  <div className="mb-8 relative z-10 cursor-pointer hover:opacity-70 transition-opacity" onClick={() => handleEditService(s)}>
                    <h3 className="text-xl font-black text-slate-900 leading-tight mb-1">{s.name}</h3>
                    <p className="text-xs font-mono text-slate-400 truncate">{s.service_id}</p>
                  </div>

                  <div className="space-y-4 relative z-10">
                    <div className="space-y-2">
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Public Identity</div>
                      {s.service_nsec && (
                        <div className="flex items-center space-x-2 text-slate-500 font-mono text-xs">
                          <span>{nip19.npubEncode(getPublicKey(fromNsecLocal(s.service_nsec))).slice(0, 20)}...</span>
                          <button onClick={(e) => { e.stopPropagation(); copyToClipboard(nip19.npubEncode(getPublicKey(fromNsecLocal(s.service_nsec))), `npub-${s.id}`); }} className="hover:text-blue-500 transition-colors">
                            {copiedMap[`npub-${s.id}`] ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Endpoints</span>
                        {s.config?.protocols?.tor && !s.state?.last_inventory?.some(e => e.family === 'onion') && (
                           <div className={`flex items-center space-x-1 px-1.5 py-0.5 rounded border ${s.state?.tor_status?.running ? 'border-yellow-500/50 bg-yellow-50 text-yellow-600' : 'border-red-500/50 bg-red-50 text-red-500'}`} title={s.state?.tor_status?.running ? "Tor running but no Onion Service configured" : "Tor not detected"}>
                             <div className={`w-1 h-1 rounded-full ${s.state?.tor_status?.running ? 'bg-yellow-500' : 'bg-red-500 animate-pulse'}`} />
                             <span className="text-[8px] font-bold uppercase">TOR</span>
                           </div>
                        )}
                      </div>
                      
                      {s.state?.last_inventory?.length > 0 ? (
                        <div className="space-y-1.5">
                          {s.state.last_inventory.map((ep, idx) => (
                            <div key={idx} className="flex items-center justify-between bg-slate-50 px-2 py-1.5 rounded-lg border border-slate-100 text-[10px] font-mono text-slate-600">
                              <div className="flex items-center space-x-2 truncate">
                                <div className={`w-1.5 h-1.5 rounded-full ${ep.family === 'onion' ? 'bg-purple-500' : 'bg-blue-500'}`} />
                                <span className="truncate max-w-[180px]">{ep.url}</span>
                              </div>
                              <button onClick={(e) => { e.stopPropagation(); copyToClipboard(ep.url, `ep-${s.id}-${idx}`); }} className="ml-2 hover:text-blue-500 transition-colors shrink-0">
                                {copiedMap[`ep-${s.id}-${idx}`] ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[10px] text-slate-400 italic">
                          {s.state?.is_probing ? 'Probing...' : 'No active endpoints'}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 px-1 uppercase tracking-tighter pt-2 border-t border-slate-100">
                      <span>Last Update</span>
                      <span className="text-slate-900">{s.state?.last_full_publish_timestamp ? new Date(s.state.last_full_publish_timestamp).toLocaleTimeString() : 'Pending'}</span>
                    </div>
                  </div>
                  
                  <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                      onClick={(e) => { e.stopPropagation(); handleDeleteService(s.id); }}
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
                    <h1 className="text-4xl font-black tracking-tight leading-none">{initialized ? 'Connect Identity' : 'Initialize Node'}</h1>
                    <p className="text-slate-400 font-medium">{initialized ? 'Login to manage your services.' : 'Connect your admin identity to provision the Sidecar.'}</p>
                  </div>

                  {loginMode === 'choice' && (
                    <div className="grid grid-cols-1 gap-4">
                      {[
                        { id: 'nip07', label: 'Browser Extension', icon: <Smartphone className="w-5 h-5 text-blue-400" />, desc: 'Use Alby, Nos2x, or similar', action: () => { if(window.nostr) { window.nostr.getPublicKey().then(pk => { verifyAndSaveAdmin(pk); }); } else alert("Extension not found"); } },
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
                      
                      <div className="space-y-4">
                        <div className="flex justify-center flex-wrap gap-2">
                          {Object.entries(relayStatus).map(([url, status]) => (
                            <div key={url} className="flex items-center space-x-1.5 px-2 py-1 rounded-full bg-slate-800 border border-white/5" title={url}>
                              <div className={`w-1.5 h-1.5 rounded-full ${status === 'connected' ? 'bg-green-500' : status === 'failed' ? 'bg-red-500' : 'bg-blue-500 animate-pulse'}`} />
                              <span className="text-[8px] font-bold text-slate-400 uppercase">{url.split('//')[1]}</span>
                            </div>
                          ))}
                        </div>

                        <button 
                          onClick={() => copyToClipboard(nip46Uri, 'nip46')}
                          className="flex items-center space-x-2 bg-slate-800 px-4 py-2 rounded-full text-[10px] font-black uppercase text-slate-400 hover:text-white transition-colors mx-auto"
                        >
                          {copiedMap['nip46'] ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                          <span>{copiedMap['nip46'] ? 'Copied URI' : 'Copy Connection URI'}</span>
                        </button>
                      </div>

                      <div className="space-y-4">
                        <p className="text-xs font-black text-blue-400 animate-pulse uppercase tracking-widest">Awaiting Signer Approval</p>
                        
                        {/* NEW: Connection Logs */}
                        <div className="bg-slate-950/50 rounded-2xl p-4 border border-white/5 font-mono text-[9px] text-left space-y-1 max-w-[280px] mx-auto">
                          {nip46Logs.length > 0 ? (
                            nip46Logs.map((log, i) => (
                              <div key={i} className="text-slate-400 truncate">
                                <span className="text-blue-500 mr-1">›</span> {log}
                              </div>
                            ))
                          ) : (
                            <div className="text-slate-600 italic">Establishing secure channel...</div>
                          )}
                        </div>

                        <p className="text-[10px] text-slate-500 max-w-[300px] mx-auto leading-relaxed italic">
                          If your app approved but this screen didn't change, your app's response might not have reached these relays. You can paste your <b>npub</b> below to continue.
                        </p>
                        <div className="max-w-[280px] mx-auto">
                          <input 
                            type="text" placeholder="Or paste Pubkey manually" 
                            className="w-full bg-slate-800 border border-white/5 rounded-2xl p-4 text-[10px] font-mono outline-none text-white focus:border-blue-500 transition-colors"
                            value={manualPubkey}
                            onChange={(e) => setManualPubkey(e.target.value)}
                          />
                          {manualPubkey && (
                            <button onClick={async () => { 
                              try {
                                const pk = manualPubkey.startsWith('npub1') ? fromNpub(manualPubkey) : manualPubkey;
                                const finalPk = (typeof pk === 'string') ? pk : toHex(pk);
                                await verifyAndSaveAdmin(finalPk); 
                              } catch (e) { alert("Invalid npub/hex"); }
                            }} className="w-full mt-3 bg-slate-800 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest border border-blue-500/30 text-blue-400">Force Connection</button>
                          )}
                        </div>
                      </div>
                      <button onClick={() => setLoginMode('choice')} className="text-slate-500 font-bold text-xs uppercase tracking-widest hover:text-white transition-colors">Try Different Method</button>
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
                            verifyAndSaveAdmin(pk);
                          } catch(e) { alert("Invalid Key"); }
                        }} className="w-full bg-white text-slate-900 font-black py-5 rounded-3xl shadow-xl hover:bg-slate-100 transition-all">{initialized ? 'CONNECT' : 'START PROVISIONING'}</button>
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