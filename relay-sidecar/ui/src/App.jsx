import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Shield, Key, Globe, Settings, CheckCircle, AlertTriangle } from 'lucide-react';

const API_BASE = 'http://127.0.0.1:3000/api';

export default function App() {
  const [initialized, setInitialized] = useState(null);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [torStatus, setTorStatus] = useState(null);
  
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
      ncc05_ttl_hours: 12
    }
  });

  useEffect(() => {
    checkStatus();
    checkTor();
  }, []);

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
    const pubkey = await window.nostr.getPublicKey();
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
                <p className="font-mono text-xs truncate">{setupData.serviceNpub || 'Configured'}</p>
              </div>
              <div className="p-4 bg-gray-50 rounded border border-gray-200">
                <p className="text-sm text-gray-600 font-medium">Tor Status</p>
                <p className="text-sm">{torStatus?.running ? 'Connected' : 'Not Detected'}</p>
              </div>
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
            <div className="space-y-6 text-center">
              <Shield className="w-16 h-16 mx-auto text-blue-400" />
              <div>
                <h2 className="text-xl font-semibold">Welcome Administrator</h2>
                <p className="text-slate-400 text-sm mt-2">Connect your personal Nostr identity to manage this sidecar.</p>
              </div>
              <button 
                onClick={connectNIP07}
                className="w-full bg-white text-slate-900 font-bold py-3 px-4 rounded-lg hover:bg-slate-100 transition-colors flex items-center justify-center"
              >
                Login with NIP-07 Extension
              </button>
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
                  className="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-500 transition-colors"
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
                    className="w-full bg-green-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-green-500 transition-colors"
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
                    <p className="font-medium">{torStatus?.running ? 'Tor is active' : 'Tor not detected'}</p>
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
                    className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-sm focus:border-blue-500 outline-none"
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
                    <p className="text-[10px] text-slate-500 mt-1">Hides endpoint in NCC-02</p>
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
                    <p className="text-[10px] text-slate-500 mt-1">Generate self-signed cert</p>
                  </div>
                </div>
              </div>


              <button 
                onClick={completeSetup}
                className="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-500 transition-colors"
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