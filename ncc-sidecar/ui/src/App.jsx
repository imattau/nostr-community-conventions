import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Shield, Key, Globe, Settings, CheckCircle, AlertTriangle, Cpu, Smartphone, QrCode, Network, Monitor, Radio, Plus, Trash2, Activity, Box } from 'lucide-react';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { nip19, nip04, SimplePool } from 'nostr-tools';
import { QRCodeSVG } from 'qrcode.react';

const API_BASE = '/api';

const SERVICE_TYPES = [
  { id: 'relay', label: 'Nostr Relay', defaultId: 'relay' },
  { id: 'blossom', label: 'Blossom Media Server', defaultId: 'media' },
  { id: 'nwc', label: 'Lightning Node (NWC)', defaultId: 'nwc' },
  { id: 'api', label: 'Personal API', defaultId: 'api' },
  { id: 'custom', label: 'Custom Service', defaultId: 'service' }
];

export default function App() {
  const [initialized, setInitialized] = useState(null);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [torStatus, setTorStatus] = useState(null);
  const [networkProbe, setNetworkProbe] = useState({ ipv4: null, ipv6: null });
  const [services, setServices] = useState([]);
  const [loginMode, setLoginMode] = useState('nip07');
  const [nip46Uri, setNip46Uri] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('idle');

  const [setupData, setSetupData] = useState({
    adminPubkey: '',
    service: {
      type: 'relay',
      name: 'My Relay',
      service_id: 'relay',
      service_nsec: ''
    },
    config: {
      refresh_interval_minutes: 360,
      ncc02_expiry_days: 3,
      ncc05_ttl_hours: 12,
      service_mode: 'public',
      generate_self_signed: false,
      protocols: { ipv4: true, ipv6: true, tor: true },
      primary_protocol: 'ipv4'
    }
  });

  useEffect(() => {
    checkStatus();
    checkTor();
    if (initialized) fetchServices();
  }, [initialized]);

  useEffect(() => { if (step === 3) probeNetwork(); }, [step]);

  const fetchServices = async () => {
    try {
      const res = await axios.get(`${API_BASE}/services`);
      setServices(res.data);
    } catch (e) {}
  };

  const checkStatus = async () => {
    try {
      const res = await axios.get(`${API_BASE}/setup/status`);
      setInitialized(res.data.initialized);
      setLoading(false);
    } catch (e) { console.error(e); }
  };

  const checkTor = async () => {
    try {
      const res = await axios.get(`${API_BASE}/tor/status`);
      setTorStatus(res.data);
    } catch (e) {}
  };

  const probeNetwork = async () => {
    try {
      const res = await axios.get(`${API_BASE}/network/probe`);
      setNetworkProbe(res.data);
    } catch (e) {}
  };

  const startNIP46 = async () => {
    const sk = generateSecretKey();
    const pk = getPublicKey(sk);
    const pool = new SimplePool();
    const relay = 'wss://relay.damus.io';
    setConnectionStatus('listening');
    const uri = `nostrconnect://${pk}?relay=${encodeURIComponent(relay)}&metadata=${encodeURIComponent(JSON.stringify({name: 'NCC Sidecar'}))}`;
    setNip46Uri(uri);
    setLoginMode('nip46');
    const sub = pool.subscribeMany([relay], [{ kinds: [24133], '#p': [pk] }], {
      onevent: async (event) => {
        try {
          const decrypted = await nip04.decrypt(sk, event.pubkey, event.content);
          if (JSON.parse(decrypted).result || JSON.parse(decrypted).method === 'connect') {
            setSetupData(prev => ({ ...prev, adminPubkey: event.pubkey }));
            setConnectionStatus('connected');
            sub.close();
            setStep(2);
          }
        } catch (e) {}
      }
    });
  };

  const completeSetup = async () => {
    try {
      await axios.post(`${API_BASE}/setup/init`, setupData);
      setInitialized(true);
    } catch (e) { alert("Setup failed: " + e.message); }
  };

  const deleteService = async (id) => {
    if (!confirm("Delete this service?")) return;
    await axios.delete(`${API_BASE}/service/${id}`);
    fetchServices();
  };

  if (loading) return <div className="flex h-screen items-center justify-center font-black text-slate-400 uppercase tracking-tighter">Initializing...</div>;

  if (initialized) {
    return (
      <div className="min-h-screen bg-slate-50 p-8 font-sans">
        <div className="max-w-5xl mx-auto">
          <header className="flex justify-between items-center mb-12">
            <div>
              <h1 className="text-4xl font-black text-slate-900 tracking-tighter uppercase">NCC Sidecar</h1>
              <p className="text-slate-500 font-medium">Service Identity Manager</p>
            </div>
            <button className="bg-slate-900 text-white px-6 py-3 rounded-2xl font-bold flex items-center shadow-xl hover:bg-slate-800 transition-all">
              <Plus className="w-4 h-4 mr-2" /> NEW SERVICE
            </button>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {services.map(s => (
              <div key={s.id} className="bg-white rounded-3xl p-6 shadow-sm border border-slate-200 group hover:shadow-xl hover:border-slate-300 transition-all">
                <div className="flex justify-between items-start mb-6">
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center text-blue-600">
                      <Box className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-black text-lg text-slate-900 leading-tight">{s.name}</h3>
                      <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest">{s.type}</p>
                    </div>
                  </div>
                  <button onClick={() => deleteService(s.id)} className="text-slate-300 hover:text-red-500 transition-colors p-2">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-6">
                  <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100">
                    <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Last Update</p>
                    <p className="text-xs font-bold text-slate-700">{s.state?.last_full_publish_timestamp ? new Date(s.state.last_full_publish_timestamp).toLocaleTimeString() : 'Never'}</p>
                  </div>
                  <div className="bg-slate-50 rounded-2xl p-3 border border-slate-100">
                    <p className="text-[8px] font-black text-slate-400 uppercase mb-1">Status</p>
                    <div className="flex items-center text-green-600 text-xs font-bold">
                      <Activity className="w-3 h-3 mr-1" /> Active
                    </div>
                  </div>
                </div>

                <div className="bg-slate-900 rounded-2xl p-4">
                  <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-2">Endpoint Security (K)</p>
                  <code className="text-[10px] text-blue-400 font-mono break-all leading-tight opacity-80">{s.state?.last_published_ncc02_id || 'Waiting for first run...'}</code>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-4 font-sans">
      <div className="max-w-md w-full bg-slate-800 rounded-[3rem] shadow-2xl overflow-hidden border border-slate-700">
        <div className="bg-gradient-to-br from-blue-600 to-indigo-800 p-10 text-center">
          <h1 className="text-3xl font-black tracking-tighter uppercase">NCC Sidecar</h1>
          <p className="text-blue-100/60 text-xs mt-1 font-bold uppercase tracking-widest">First Run Setup</p>
        </div>

        <div className="p-10">
          {step === 1 && (
            <div className="space-y-8">
              <div className="text-center space-y-4">
                <div className="w-20 h-20 bg-blue-500/10 rounded-3xl flex items-center justify-center mx-auto border border-blue-500/20">
                  <Shield className="w-10 h-10 text-blue-400" />
                </div>
                <h2 className="text-xl font-bold">Admin Authority</h2>
                <p className="text-slate-400 text-sm px-4">Connect your Nostr identity to manage your services.</p>
              </div>
              <button onClick={() => { if(!nip46Uri) startNIP46(); }} className="w-full bg-white text-slate-900 font-black py-4 rounded-2xl shadow-xl hover:bg-slate-100 transition-all">CONNECT SIGNER</button>
              {loginMode === 'nip46' && <div className="bg-white p-4 rounded-3xl w-fit mx-auto shadow-2xl mt-4"><QRCodeSVG value={nip46Uri} size={140} /></div>}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-right-4">
              <div className="flex items-center space-x-3 text-blue-400"><Box className="w-6 h-6" /><h2 className="text-xl font-bold text-white">First Service</h2></div>
              <div className="space-y-4">
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">Service Type</label>
                <select 
                  className="w-full bg-slate-900 border border-slate-700 rounded-2xl p-4 text-sm font-bold outline-none appearance-none cursor-pointer"
                  onChange={(e) => {
                    const type = SERVICE_TYPES.find(t => t.id === e.target.id);
                    setSetupData(d => ({ ...d, service: { ...d.service, type: e.target.value, service_id: SERVICE_TYPES.find(t => t.id === e.target.value).defaultId } }));
                  }}
                >
                  {SERVICE_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
                <input 
                  type="text" placeholder="Service Name (e.g. My Relay)" 
                  className="w-full bg-slate-900 border border-slate-700 rounded-2xl p-4 text-sm font-bold outline-none"
                  onChange={(e) => setSetupData(d => ({ ...d, service: { ...d.service, name: e.target.value } }))}
                />
              </div>
              <button onClick={() => setStep(2.5)} className="w-full bg-blue-600 font-black py-4 rounded-2xl shadow-lg">CONTINUE</button>
            </div>
          )}

          {step === 2.5 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-right-4">
              <div className="flex items-center space-x-3 text-blue-400"><Key className="w-6 h-6" /><h2 className="text-xl font-bold text-white">Identity</h2></div>
              <p className="text-slate-400 text-sm">Every service needs a unique identity (NSEC).</p>
              <button onClick={async () => {
                const res = await axios.get(`${API_BASE}/service/generate-key`);
                setSetupData(d => ({ ...d, service: { ...d.service, service_nsec: res.data.nsec } }));
              }} className="w-full bg-slate-700 font-black py-4 rounded-2xl">GENERATE NEW KEY</button>
              {setupData.service.service_nsec && <div className="p-4 bg-slate-900 rounded-2xl border border-slate-700 border-l-4 border-l-green-500 font-mono text-[9px] break-all text-green-400 leading-tight">{setupData.service.service_nsec}</div>}
              {setupData.service.service_nsec && <button onClick={() => setStep(3)} className="w-full bg-green-600 font-black py-4 rounded-2xl">I'VE SAVED IT, CONTINUE</button>}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-8 animate-in fade-in slide-in-from-right-4">
              <div className="flex items-center space-x-3 text-blue-400"><Globe className="w-6 h-6" /><h2 className="text-xl font-bold text-white">Discovery</h2></div>
              <div className="space-y-3">
                {['ipv4', 'ipv6', 'tor'].map(p => (
                  <div key={p} className="flex items-center p-4 bg-slate-900 rounded-2xl border border-slate-700">
                    <div className="flex-1 font-bold text-sm uppercase tracking-tighter">{p}</div>
                    <input type="checkbox" checked={setupData.config.protocols[p]} onChange={(e) => setSetupData(d => ({ ...d, config: { ...d.config, protocols: { ...d.config.protocols, [p]: e.target.checked } } }))} className="w-5 h-5 rounded-full" />
                  </div>
                ))}
              </div>
              <button onClick={completeSetup} className="w-full bg-blue-600 font-black py-4 rounded-2xl shadow-2xl">FINISH & LAUNCH</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}