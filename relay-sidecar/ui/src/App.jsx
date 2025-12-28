import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Shield, Key, Globe, Settings, CheckCircle, AlertTriangle, Cpu, Smartphone, QrCode, Network, Monitor, Radio } from 'lucide-react';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { nip19, nip04, SimplePool } from 'nostr-tools';
import { QRCodeSVG } from 'qrcode.react';

const API_BASE = '/api';

export default function App() {
  const [initialized, setInitialized] = useState(null);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [torStatus, setTorStatus] = useState(null);
  const [networkProbe, setNetworkProbe] = useState({ ipv4: null, ipv6: null });
  const [admins, setAdmins] = useState([]);
  const [inviteNpub, setInviteNpub] = useState('');
  const [loginMode, setLoginMode] = useState('nip07');
  const [nip46Uri, setNip46Uri] = useState('');
  const [tempSk, setTempSk] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('idle');

  const [setupData, setSetupData] = useState({
    adminPubkey: '',
    serviceNsec: '',
    serviceNpub: '',
    config: {
      service_id: 'relay',
      locator_id: 'relay-locator',
      endpoints: [],
      publication_relays: ['wss://relay.damus.io'],
      refresh_interval_minutes: 360,
      ncc02_expiry_days: 3,
      ncc05_ttl_hours: 12,
      authorized_recipients: [],
      service_mode: 'public',
      generate_self_signed: false,
      primary_protocol_preference: 'ip' // 'ip' or 'onion'
    }
  });

  useEffect(() => {
    checkStatus();
    checkTor();
    if (initialized) fetchAdmins();
  }, [initialized]);

  useEffect(() => {
    if (step === 3) probeNetwork();
  }, [step]);

  const fetchAdmins = async () => {
    try {
      const res = await axios.get(`${API_BASE}/admins`);
      setAdmins(res.data);
    } catch (e) {}
  };

  const probeNetwork = async () => {
    try {
      const res = await axios.get(`${API_BASE}/network/probe`);
      setNetworkProbe(res.data);
    } catch (e) {}
  };

  const inviteAdmin = async () => {
    try {
      await axios.post(`${API_BASE}/admin/invite`, {
        npub: inviteNpub,
        publicUrl: window.location.origin
      });
      setInviteNpub('');
      fetchAdmins();
      alert("Invite sent!");
    } catch (e) {
      alert("Failed to invite: " + e.message);
    }
  };

  const removeAdmin = async (pubkey) => {
    if (!confirm("Remove this admin?")) return;
    try {
      await axios.delete(`${API_BASE}/admin/${pubkey}`);
      fetchAdmins();
    } catch (e) {}
  };

  const checkStatus = async () => {
    try {
      const res = await axios.get(`${API_BASE}/setup/status`);
      setInitialized(res.data.initialized);
      setLoading(false);
    } catch (e) {
      console.error(e);
    }
  };

  const checkTor = async () => {
    try {
      const res = await axios.get(`${API_BASE}/tor/status`);
      setTorStatus(res.data);
    } catch (e) {}
  };

  const connectNIP07 = async () => {
    if (!window.nostr) {
      alert("NIP-07 extension (like Alby or Nos2x) not found.");
      return;
    }
    try {
      const pubkey = await window.nostr.getPublicKey();
      setSetupData({ ...setupData, adminPubkey: pubkey });
      setStep(2);
    } catch (e) {
      alert("Login failed: " + e.message);
    }
  };

  const startNIP46 = async () => {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const pool = new SimplePool();
    const relays = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];
    
    setTempSk(sk);
    setConnectionStatus('listening');
    const metadata = { name: 'NCC-06 Sidecar', description: 'Nostr Service Discovery Agent' };
    const uri = `nostrconnect://${pk}?relay=${encodeURIComponent(relays[0])}&metadata=${encodeURIComponent(JSON.stringify(metadata))}`;
    
    setNip46Uri(uri);
    setLoginMode('nip46');

    const sub = pool.subscribeMany(relays, [{
      kinds: [24133],
      '#p': [pk]
    }], {
      onevent: async (event) => {
        try {
          const decrypted = await nip04.decrypt(sk, event.pubkey, event.content);
          const response = JSON.parse(decrypted);
          
          if (response.method === 'connect' || response.result) {
            setSetupData(prev => ({ ...prev, adminPubkey: event.pubkey }));
            setConnectionStatus('connected');
            sub.close();
            pool.close(relays);
            setStep(2);
          }
        } catch (e) {
          console.error("[NIP-46] Decryption failed:", e);
        }
      }
    });
  };

  const handleNIP46Complete = (input) => {
    let pubkey = input;
    if (input.startsWith('npub1')) {
      try { pubkey = nip19.decode(input).data; } catch (e) { alert("Invalid npub"); return; }
    }
    if (!pubkey.match(/^[a-f0-9]{64}$/)) {
      alert("Invalid hex pubkey");
      return;
    }
    setSetupData({ ...setupData, adminPubkey: pubkey });
    setStep(2);
  };

  const generateServiceKey = async () => {
    const res = await axios.get(`${API_BASE}/service/generate-key`);
    setSetupData({ 
      ...setupData, 
      serviceNsec: res.data.nsec,
      serviceNpub: res.data.npub
    });
  };

  const completeSetup = async () => {
    try {
      await axios.post(`${API_BASE}/setup/init`, setupData);
      setInitialized(true);
    } catch (e) {
      alert("Setup failed: " + e.message);
    }
  };

  if (loading) return <div className="flex h-screen items-center justify-center">Loading...</div>;

  if (initialized) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 font-sans">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold mb-8 text-slate-900 tracking-tight">NCC-06 Sidecar Admin</h1>
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
            <h2 className="text-xl font-semibold mb-4 flex items-center text-slate-800">
              <CheckCircle className="text-green-500 mr-2" /> System Healthy
            </h2>
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 bg-blue-50 rounded-xl border border-blue-100">
                <p className="text-[10px] uppercase tracking-wider text-blue-600 font-bold mb-1">Service Identity</p>
                <p className="font-mono text-xs truncate text-blue-900">{setupData.serviceNpub || 'Configured'}</p>
              </div>
              <div className="p-4 bg-purple-50 rounded-xl border border-purple-100">
                <p className="text-[10px] uppercase tracking-wider text-purple-600 font-bold mb-1">Endpoints</p>
                <p className="text-xs font-medium text-purple-900">Auto-detecting IP & Onion</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
                <p className="text-[10px] uppercase tracking-wider text-gray-600 font-bold mb-1">Tor Status</p>
                <p className="text-xs font-medium text-gray-900">{torStatus?.running ? 'Connected' : 'Not Detected'}</p>
              </div>
            </div>
          </div>

          <div className="mt-8 bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
            <h2 className="text-xl font-semibold mb-4 flex items-center text-slate-800">
              <Shield className="text-blue-500 mr-2" /> Manage Team
            </h2>
            
            <div className="flex space-x-2 mb-6">
              <input 
                type="text" 
                placeholder="npub1..."
                value={inviteNpub}
                onChange={(e) => setInviteNpub(e.target.value)}
                className="flex-1 bg-gray-50 border border-gray-300 rounded-xl p-2.5 text-sm focus:border-blue-500 outline-none transition-all"
              />
              <button 
                onClick={inviteAdmin}
                className="bg-blue-600 text-white px-6 py-2.5 rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors shadow-sm"
              >
                Send Invite
              </button>
            </div>

            <div className="space-y-3">
              {admins.map(admin => (
                <div key={admin.pubkey} className="flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-200 hover:border-gray-300 transition-colors">
                  <div>
                    <p className="font-mono text-xs text-slate-700 truncate max-w-xs">{admin.pubkey}</p>
                    <span className={`text-[10px] uppercase font-black tracking-widest ${admin.status === 'active' ? 'text-green-600' : 'text-amber-600'}`}>
                      {admin.status}
                    </span>
                  </div>
                  <button 
                    onClick={() => removeAdmin(admin.pubkey)}
                    className="text-red-500 hover:text-red-700 text-xs font-bold uppercase tracking-tighter"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-4 font-sans">
      <div className="max-w-md w-full bg-slate-800 rounded-3xl shadow-2xl overflow-hidden border border-slate-700">
        <div className="bg-gradient-to-br from-blue-600 to-indigo-700 p-8 text-center relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 blur-2xl" />
          <h1 className="text-2xl font-black tracking-tight">NCC-06 Sidecar</h1>
          <p className="text-blue-100 text-sm mt-1 font-medium opacity-80">Discovery Layer Setup</p>
        </div>

        <div className="p-8">
          {step === 1 && (
            <div className="space-y-8 animate-in fade-in zoom-in-95 duration-300">
              <div className="bg-blue-500/10 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto border border-blue-500/20">
                <Shield className="w-10 h-10 text-blue-400" />
              </div>
              <div className="text-center">
                <h2 className="text-xl font-bold text-slate-100">Welcome Administrator</h2>
                <p className="text-slate-400 text-sm mt-2 leading-relaxed px-4">Connect your personal Nostr identity to securely manage this service.</p>
              </div>

              <div className="grid grid-cols-2 gap-2 bg-slate-900 p-1.5 rounded-2xl border border-slate-700">
                <button 
                  onClick={() => setLoginMode('nip07')}
                  className={`flex items-center justify-center py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${loginMode === 'nip07' ? 'bg-slate-700 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  <Cpu className="w-3 h-3 mr-2" /> Extension
                </button>
                <button 
                  onClick={() => { setLoginMode('nip46'); if(!nip46Uri) startNIP46(); }}
                  className={`flex items-center justify-center py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${loginMode === 'nip46' ? 'bg-slate-700 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  <Smartphone className="w-3 h-3 mr-2" /> Remote
                </button>
              </div>

              {loginMode === 'nip07' ? (
                <button 
                  onClick={connectNIP07}
                  className="w-full bg-white text-slate-900 font-black text-sm py-4 px-4 rounded-2xl hover:bg-slate-100 transition-all shadow-xl active:scale-[0.98]"
                >
                  LOGIN WITH EXTENSION
                </button>
              ) : (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
                  <div className="bg-white p-5 rounded-3xl flex justify-center shadow-2xl mx-auto w-fit">
                    <QRCodeSVG value={nip46Uri} size={160} />
                  </div>
                  <div className="text-center space-y-3">
                    <div className="flex items-center justify-center space-x-2">
                      <div className={`w-2 h-2 rounded-full ${connectionStatus === 'listening' ? 'bg-blue-500 animate-pulse' : 'bg-green-500'}`} />
                      <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest">
                        {connectionStatus === 'listening' ? 'Waiting for Signer...' : 'Success'}
                      </p>
                    </div>
                    <code className="block p-3 bg-slate-900 rounded-xl border border-slate-700 text-[9px] break-all font-mono text-blue-300 select-all leading-tight">
                      {nip46Uri}
                    </code>
                  </div>
                  <div className="pt-4 border-t border-slate-700/50">
                    <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-3 text-center">Manual Fallback</p>
                    <div className="flex space-x-2">
                      <input 
                        type="text" 
                        placeholder="Paste pubkey if not detected"
                        className="flex-1 bg-slate-900 border border-slate-700 rounded-xl p-3 text-[10px] focus:border-blue-500 outline-none text-white font-mono"
                        onKeyDown={(e) => { if(e.key === 'Enter') handleNIP46Complete(e.target.value); }}
                      />
                      <button 
                        onClick={(e) => handleNIP46Complete(e.currentTarget.previousSibling.value)}
                        className="bg-slate-700 px-4 rounded-xl text-[10px] font-black"
                      >
                        GO
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="flex items-center space-x-3 text-blue-400">
                <Key className="w-6 h-6" />
                <h2 className="text-xl font-bold text-slate-100">Service Identity</h2>
              </div>
              <p className="text-slate-400 text-sm leading-relaxed">Generate a unique cryptographic identity for your service. This is distinct from your administrator account.</p>
              
              {!setupData.serviceNsec ? (
                <button 
                  onClick={generateServiceKey}
                  className="w-full bg-blue-600 text-white font-black text-sm py-4 px-4 rounded-2xl hover:bg-blue-500 transition-all shadow-lg shadow-blue-900/20"
                >
                  GENERATE NEW SERVICE KEY
                </button>
              ) : (
                <div className="space-y-6">
                  <div className="p-4 bg-slate-900 rounded-2xl border border-slate-700 border-l-4 border-l-orange-500">
                    <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-2">Private Key (Keep Secret!)</p>
                    <p className="font-mono text-[10px] break-all text-orange-400 leading-tight">{setupData.serviceNsec}</p>
                  </div>
                  <button 
                    onClick={() => setStep(3)}
                    className="w-full bg-green-600 text-white font-black text-sm py-4 px-4 rounded-2xl hover:bg-green-500 transition-all shadow-lg"
                  >
                    I'VE SAVED IT, CONTINUE
                  </button>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="flex items-center space-x-3 text-blue-400">
                <Globe className="w-6 h-6" />
                <h2 className="text-xl font-bold text-slate-100">Network Discovery</h2>
              </div>
              
              <div className="space-y-4">
                <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest">Select Primary Discovery Path</p>
                
                <div className="grid grid-cols-1 gap-3">
                  {/* Onion Option */}
                  <button 
                    onClick={() => setSetupData(d => ({ ...d, config: { ...d.config, primary_protocol_preference: 'onion' } }))}
                    className={`flex items-center p-4 rounded-2xl border transition-all text-left ${setupData.config.primary_protocol_preference === 'onion' ? 'bg-indigo-600/20 border-indigo-500 shadow-indigo-900/20' : 'bg-slate-900/50 border-slate-700 opacity-60 hover:opacity-100'}`}
                  >
                    <Radio className={`w-5 h-5 mr-4 ${setupData.config.primary_protocol_preference === 'onion' ? 'text-indigo-400' : 'text-slate-600'}`} />
                    <div className="flex-1">
                      <p className="font-bold text-sm">Tor (Onion)</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">Location-hiding, DNS-optional.</p>
                    </div>
                    {torStatus?.running ? <CheckCircle className="w-4 h-4 text-green-500" /> : <AlertTriangle className="w-4 h-4 text-amber-500" />}
                  </button>

                  {/* IP Option */}
                  <button 
                    onClick={() => setSetupData(d => ({ ...d, config: { ...d.config, primary_protocol_preference: 'ip' } }))}
                    className={`flex items-center p-4 rounded-2xl border transition-all text-left ${setupData.config.primary_protocol_preference === 'ip' ? 'bg-blue-600/20 border-blue-500 shadow-blue-900/20' : 'bg-slate-900/50 border-slate-700 opacity-60 hover:opacity-100'}`}
                  >
                    <Radio className={`w-5 h-5 mr-4 ${setupData.config.primary_protocol_preference === 'ip' ? 'text-blue-400' : 'text-slate-600'}`} />
                    <div className="flex-1">
                      <p className="font-bold text-sm">Internet Protocol (IP)</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">Clearnet. Prefers IPv6, falls back to IPv4.</p>
                    </div>
                    {networkProbe.ipv4 ? <CheckCircle className="w-4 h-4 text-green-500" /> : <AlertTriangle className="w-4 h-4 text-amber-500" />}
                  </button>
                </div>

                <div className="p-4 bg-slate-900/80 rounded-2xl border border-slate-700">
                  <div className="flex items-center space-x-2 text-slate-400 mb-3">
                    <Monitor className="w-3 h-3" />
                    <span className="text-[9px] font-black uppercase tracking-tighter">Detected Endpoints</span>
                  </div>
                  <div className="space-y-2 font-mono text-[9px]">
                    <div className="flex justify-between">
                      <span className="text-slate-500">IPv4:</span>
                      <span className="text-blue-300">{networkProbe.ipv4 || 'Detecting...'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">IPv6:</span>
                      <span className="text-blue-300">{networkProbe.ipv6 || 'None detected'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Tor:</span>
                      <span className={torStatus?.running ? 'text-green-400' : 'text-slate-600'}>
                        {torStatus?.running ? 'Available' : 'Not running'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-4">
                <button 
                  onClick={() => setStep(4)}
                  className="w-full bg-blue-600 text-white font-black text-sm py-4 px-4 rounded-2xl hover:bg-blue-500 transition-all shadow-lg"
                >
                  NEXT: SECURITY & PRIVACY
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="flex items-center space-x-3 text-blue-400">
                <Settings className="w-6 h-6" />
                <h2 className="text-xl font-bold text-slate-100">Security & Privacy</h2>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <button 
                    onClick={() => setSetupData(d => ({ ...d, config: { ...d.config, service_mode: d.config.service_mode === 'private' ? 'public' : 'private' } }))}
                    className={`p-4 rounded-2xl border transition-all text-left ${setupData.config.service_mode === 'private' ? 'bg-purple-600/20 border-purple-500' : 'bg-slate-900 border-slate-700 opacity-60'}`}
                  >
                    <p className="font-bold text-xs">Private Mode</p>
                    <p className="text-[9px] text-slate-400 mt-1">Encrypted locators.</p>
                  </button>

                  <button 
                    onClick={() => setSetupData(d => ({ ...d, config: { ...d.config, generate_self_signed: !d.config.generate_self_signed } }))}
                    className={`p-4 rounded-2xl border transition-all text-left ${setupData.config.generate_self_signed ? 'bg-blue-600/20 border-blue-500' : 'bg-slate-900 border-slate-700 opacity-60'}`}
                  >
                    <p className="font-bold text-xs">Auto-TLS</p>
                    <p className="text-[9px] text-slate-400 mt-1">Self-signed cert.</p>
                  </button>
                </div>

                {setupData.config.service_mode === 'private' && (
                  <div className="animate-in fade-in slide-in-from-top-2">
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Authorized Recipients (npubs)</label>
                    <textarea 
                      placeholder="npub1..., npub1..."
                      className="w-full bg-slate-900 border border-slate-700 rounded-2xl p-3 text-[10px] font-mono h-24 focus:border-blue-500 outline-none text-white leading-relaxed"
                      onChange={(e) => setSetupData({
                        ...setupData,
                        config: { 
                          ...setupData.config, 
                          authorized_recipients: e.target.value.split(',').map(s => s.trim()).filter(Boolean) 
                        }
                      })}
                    />
                    <p className="text-[9px] text-indigo-400 mt-2 italic px-1">Separate with commas. If empty, only you can decrypt.</p>
                  </div>
                )}
              </div>

              <div className="pt-4">
                <button 
                  onClick={completeSetup}
                  className="w-full bg-blue-600 text-white font-black text-sm py-4 px-4 rounded-2xl hover:bg-blue-500 transition-all shadow-xl shadow-blue-900/40"
                >
                  FINISH & LAUNCH
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
