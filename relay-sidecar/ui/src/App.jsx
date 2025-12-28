import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Shield, Key, Globe, Settings, CheckCircle, AlertTriangle, Cpu, Smartphone, QrCode } from 'lucide-react';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { nip19, nip04, SimplePool } from 'nostr-tools';
import { QRCodeSVG } from 'qrcode.react';

const API_BASE = '/api';

export default function App() {
  const [initialized, setInitialized] = useState(null);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [torStatus, setTorStatus] = useState(null);
  const [admins, setAdmins] = useState([]);
  const [inviteNpub, setInviteNpub] = useState('');
  const [loginMode, setLoginMode] = useState('nip07');
  const [nip46Uri, setNip46Uri] = useState('');
  const [tempSk, setTempSk] = useState(null);

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
      generate_self_signed: false
    }
  });

  useEffect(() => {
    checkStatus();
    checkTor();
    if (initialized) fetchAdmins();
  }, [initialized]);

  const fetchAdmins = async () => {
    try {
      const res = await axios.get(`${API_BASE}/admins`);
      setAdmins(res.data);
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
    const relay = 'wss://relay.damus.io';
    
    setTempSk(sk);
    const metadata = { name: 'NCC-06 Sidecar', description: 'Nostr Service Discovery Agent' };
    const uri = `nostrconnect://${pk}?relay=${encodeURIComponent(relay)}&metadata=${encodeURIComponent(JSON.stringify(metadata))}`;
    
    setNip46Uri(uri);
    setLoginMode('nip46');

    console.log("[NIP-46] Listening for connection on", relay);

    const sub = pool.subscribeMany([relay], [{
      kinds: [24133],
      '#p': [pk]
    }], {
      onevent: async (event) => {
        try {
          const decrypted = await nip04.decrypt(sk, event.pubkey, event.content);
          const response = JSON.parse(decrypted);
          console.log("[NIP-46] Received message:", response);
          
          if (response.method === 'connect' || response.result) {
            console.log("[NIP-46] Connected! Admin Pubkey:", event.pubkey);
            setSetupData(prev => ({ ...prev, adminPubkey: event.pubkey }));
            sub.close();
            pool.close([relay]);
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
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">NCC-06 Sidecar Admin</h1>
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <h2 className="text-xl font-semibold mb-4 flex items-center">
              <CheckCircle className="text-green-500 mr-2" /> System Running
            </h2>
            <p className="text-gray-600 mb-4">Your relay is being kept NCC-06 compliant.</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-blue-50 rounded border border-blue-100">
                <p className="text-sm text-blue-600 font-medium">Service Identity</p>
                <p className="font-mono text-xs truncate text-blue-800">{setupData.serviceNpub || 'Configured'}</p>
              </div>
              <div className="p-4 bg-gray-50 rounded border border-gray-200">
                <p className="text-sm text-gray-600 font-medium">Tor Status</p>
                <p className="text-sm">{torStatus?.running ? 'Connected' : 'Not Detected'}</p>
              </div>
            </div>
          </div>

          <div className="mt-8 bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <h2 className="text-xl font-semibold mb-4 flex items-center">
              <Shield className="text-blue-500 mr-2" /> Manage Team
            </h2>
            
            <div className="flex space-x-2 mb-6">
              <input 
                type="text" 
                placeholder="npub1..."
                value={inviteNpub}
                onChange={(e) => setInviteNpub(e.target.value)}
                className="flex-1 bg-gray-50 border border-gray-300 rounded p-2 text-sm focus:border-blue-500 outline-none"
              />
              <button 
                onClick={inviteAdmin}
                className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-bold hover:bg-blue-700 transition-colors"
              >
                Send Invite
              </button>
            </div>

            <div className="space-y-3">
              {admins.map(admin => (
                <div key={admin.pubkey} className="flex items-center justify-between p-3 bg-gray-50 rounded border border-gray-200">
                  <div>
                    <p className="font-mono text-xs text-gray-600 truncate max-w-xs">{admin.pubkey}</p>
                    <span className={`text-[10px] uppercase font-bold ${admin.status === 'active' ? 'text-green-600' : 'text-amber-600'}`}>
                      {admin.status}
                    </span>
                  </div>
                  <button 
                    onClick={() => removeAdmin(admin.pubkey)}
                    className="text-red-600 hover:text-red-800 text-xs font-medium"
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
    <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-slate-800 rounded-2xl shadow-xl overflow-hidden border border-slate-700">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-6 text-center">
          <h1 className="text-2xl font-bold">NCC-06 Sidecar Setup</h1>
          <p className="text-blue-100 text-sm mt-1">Configure your relay's discovery layer</p>
        </div>

        <div className="p-8">
          {step === 1 && (
            <div className="space-y-6">
              <Shield className="w-16 h-16 mx-auto text-blue-400" />
              <div className="text-center">
                <h2 className="text-xl font-semibold">Welcome Administrator</h2>
                <p className="text-slate-400 text-sm mt-2">Connect your personal Nostr identity to manage this sidecar.</p>
              </div>

              <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-700">
                <button 
                  onClick={() => setLoginMode('nip07')}
                  className={`flex-1 flex items-center justify-center py-2 px-3 rounded-lg text-xs font-bold transition-all ${loginMode === 'nip07' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  <Cpu className="w-3 h-3 mr-2" /> Extension (NIP-07)
                </button>
                <button 
                  onClick={() => { setLoginMode('nip46'); if(!nip46Uri) startNIP46(); }}
                  className={`flex-1 flex items-center justify-center py-2 px-3 rounded-lg text-xs font-bold transition-all ${loginMode === 'nip46' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  <Smartphone className="w-3 h-3 mr-2" /> Remote (NIP-46)
                </button>
              </div>

              {loginMode === 'nip07' ? (
                <button 
                  onClick={connectNIP07}
                  className="w-full bg-white text-slate-900 font-bold py-3 px-4 rounded-lg hover:bg-slate-100 transition-colors flex items-center justify-center shadow-lg"
                >
                  Login with Extension
                </button>
              ) : (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                  <div className="bg-white p-4 rounded-xl flex justify-center shadow-inner">
                    <QRCodeSVG value={nip46Uri} size={180} />
                  </div>
                  <div className="text-center space-y-2">
                    <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Connection URI</p>
                    <code className="block p-2 bg-slate-900 rounded border border-slate-700 text-[10px] break-all font-mono text-blue-300 select-all cursor-pointer">
                      {nip46Uri}
                    </code>
                  </div>
                  <div className="pt-2 border-t border-slate-700">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2 text-center">Waiting for Amber/Signer...</label>
                    <p className="text-[10px] text-slate-400 text-center italic">Scan the QR code and approve the connection. Step 2 will begin automatically.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div className="flex items-center space-x-2 text-blue-400">
                <Key className="w-5 h-5" />
                <h2 className="text-lg font-semibold">Service Identity</h2>
              </div>
              <p className="text-slate-400 text-sm">Generate a unique keypair for your relay. This is different from your admin key.</p>
              
              {!setupData.serviceNsec ? (
                <button 
                  onClick={generateServiceKey}
                  className="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-500 transition-colors shadow-lg"
                >
                  Generate New Service Key
                </button>
              ) : (
                <div className="space-y-4">
                  <div className="p-3 bg-slate-900 rounded border border-slate-700">
                    <p className="text-xs text-slate-500 uppercase font-bold mb-1">Service NSEC (Save this safely!)</p>
                    <p className="font-mono text-xs break-all text-orange-400">{setupData.serviceNsec}</p>
                  </div>
                  <button 
                    onClick={() => setStep(3)}
                    className="w-full bg-green-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-green-500 transition-colors shadow-lg"
                  >
                    I've Saved It, Continue
                  </button>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6">
              <div className="flex items-center space-x-2 text-blue-400">
                <Globe className="w-5 h-5" />
                <h2 className="text-lg font-semibold">Tor & Network</h2>
              </div>
              
              <div className={`p-4 rounded-lg border ${torStatus?.running ? 'bg-green-900/20 border-green-800' : 'bg-amber-900/20 border-amber-800'}`}>
                <div className="flex items-start">
                  {torStatus?.running ? <CheckCircle className="w-5 h-5 text-green-500 mr-2 mt-0.5" /> : <AlertTriangle className="w-5 h-5 text-amber-500 mr-2 mt-0.5" />}
                  <div>
                    <p className="font-medium text-sm">{torStatus?.running ? 'Tor is active' : 'Tor not detected'}</p>
                    {!torStatus?.running && (
                      <p className="text-xs text-amber-200/70 mt-1">{torStatus?.recommendation}</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Primary Relay URL (WSS)</label>
                  <input 
                    type="text" 
                    placeholder="wss://relay.yourdomain.com"
                    className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-sm focus:border-blue-500 outline-none text-white font-mono"
                    onChange={(e) => setSetupData({
                      ...setupData,
                      config: { ...setupData.config, endpoints: [{ url: e.target.value, priority: 1 }] }
                    })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-slate-900 rounded border border-slate-700">
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="rounded text-blue-600"
                        checked={setupData.config.service_mode === 'private'}
                        onChange={(e) => setSetupData({
                          ...setupData,
                          config: { ...setupData.config, service_mode: e.target.checked ? 'private' : 'public' }
                        })}
                      />
                      <span className="text-xs font-medium">Private Mode</span>
                    </label>
                    <p className="text-[10px] text-slate-500 mt-1 leading-tight">Encrypted locators for recipients.</p>
                  </div>

                  <div className="p-3 bg-slate-900 rounded border border-slate-700">
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input 
                        type="checkbox" 
                        className="rounded text-blue-600"
                        checked={setupData.config.generate_self_signed}
                        onChange={(e) => setSetupData({
                          ...setupData,
                          config: { ...setupData.config, generate_self_signed: e.target.checked }
                        })}
                      />
                      <span className="text-xs font-medium">Auto-TLS</span>
                    </label>
                    <p className="text-[10px] text-slate-500 mt-1 leading-tight">Generate self-signed cert.</p>
                  </div>
                </div>

                {setupData.config.service_mode === 'private' && (
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Authorized Recipients (npubs, comma separated)</label>
                    <textarea 
                      placeholder="npub1..., npub1..."
                      className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-[10px] font-mono h-20 focus:border-blue-500 outline-none text-white"
                      onChange={(e) => setSetupData({
                        ...setupData,
                        config: { 
                          ...setupData.config, 
                          authorized_recipients: e.target.value.split(',').map(s => s.trim()).filter(Boolean) 
                        }
                      })}
                    />
                    <p className="text-[10px] text-blue-400 mt-1 italic">If empty, only the service owner can decrypt.</p>
                  </div>
                )}
              </div>

              <button 
                onClick={completeSetup}
                className="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-500 transition-colors shadow-lg"
              >
                Complete Setup
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
