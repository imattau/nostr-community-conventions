import React, { useState, useEffect } from 'react';
import { 
  Plus, Check, Copy, Eye, EyeOff, RefreshCw, 
  Globe, Radio, Box, Smartphone, Terminal 
} from 'lucide-react';
import { sidecarApi } from '../../api';
import Modal from '../common/Modal';
import Button from '../common/Button';

const SERVICE_TYPES = [
  { id: 'relay', label: 'Nostr Relay', icon: <Radio className="w-4 h-4" />, defaultId: 'relay' },
  { id: 'blossom', label: 'Blossom Media', icon: <Box className="w-4 h-4" />, defaultId: 'media' },
  { id: 'nwc', label: 'Lightning (NWC)', icon: <Smartphone className="w-4 h-4" />, defaultId: 'nwc' },
  { id: 'custom', label: 'Custom API', icon: <Terminal className="w-4 h-4" />, defaultId: 'service' }
];

const PROTOCOL_OPTIONS = [
  { value: 'auto', label: 'Auto (ws/wss detection)', display: 'Auto' },
  { value: 'ws', label: 'ws:// (Websocket)', display: 'ws' },
  { value: 'wss', label: 'wss:// (Secure Websocket)', display: 'wss' },
  { value: 'http', label: 'http:// (Web endpoint)', display: 'http' },
  { value: 'https', label: 'https:// (Secure Web endpoint)', display: 'https' },
  { value: 'ftp', label: 'ftp:// (FTP server)', display: 'ftp' },
  { value: 'ipfs', label: 'ipfs:// (IPFS gateway)', display: 'ipfs' }
];

const createDefaultServiceConfig = () => ({
  refresh_interval_minutes: 360,
  ncc02_expiry_days: 14,
  ncc05_ttl_hours: 12,
  service_mode: 'public',
  protocols: { ipv4: true, ipv6: true, tor: true },
  primary_protocol: 'ipv4',
  preferred_protocol: 'auto',
  profile: {
    name: '',
    display_name: '',
    about: '',
    picture: '',
    nip05: ''
  },
  ncc05_recipients: []
});

const buildEmptyService = () => ({
  type: 'relay',
  name: '',
  service_id: 'relay',
  service_nsec: '',
  config: createDefaultServiceConfig(),
  state: {}
});

const NewServiceModal = ({ 
  isOpen, 
  onClose, 
  onSave, 
  initialService,
  networkAvailability = { ipv4: false, ipv6: false, tor: false }
}) => {
  const [service, setService] = useState(initialService || buildEmptyService());
  const [showNsec, setShowNsec] = useState(false);
  const [proxyCheck, setProxyCheck] = useState(null);
  const [loadingProxy, setLoadingProxy] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setService(initialService ? JSON.parse(JSON.stringify(initialService)) : buildEmptyService());
      setProxyCheck(null);
    }
  }, [isOpen, initialService]);

  const handleGenerateKey = async () => {
    try {
      const res = await sidecarApi.generateKey();
      setService(prev => ({ ...prev, service_nsec: res.nsec }));
    } catch (err) {
      alert("Failed to generate key: " + err.message);
    }
  };

  const checkProxy = async () => {
    setLoadingProxy(true);
    try {
      const res = await sidecarApi.detectProxy();
      setProxyCheck(res);
    } catch (err) {
      console.warn("Proxy check failed", err);
    } finally {
      setLoadingProxy(false);
    }
  };

  const handleSave = () => {
    if (!service.name || !service.service_nsec) {
      alert("Name and Secret Key are required.");
      return;
    }
    onSave(service);
  };

  const portIsValid = Number.isInteger(service.config?.port) && service.config?.port > 0;

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose} 
      title={initialService ? 'Edit Profile' : 'New Profile'}
    >
      <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-2">
        {service.type !== 'sidecar' && (
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Type</label>
            <div className="grid grid-cols-2 gap-3">
              {SERVICE_TYPES.map(t => (
                <button 
                  key={t.id}
                  onClick={() => setService(d => ({ ...d, type: t.id, service_id: t.defaultId }))}
                  className={`p-4 rounded-2xl border transition-all flex items-center space-x-3 ${service.type === t.id ? 'bg-blue-600/10 border-blue-500 text-blue-600' : 'bg-slate-50 border-slate-100 text-slate-400 hover:border-slate-200'}`}
                >
                  {t.icon}
                  <span className="text-[10px] font-black uppercase tracking-widest">{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {service.type !== 'sidecar' && (
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Visibility</label>
            <div className="flex bg-slate-50 p-1 rounded-2xl border border-slate-100">
              {['public', 'private'].map(m => (
                <button 
                  key={m} 
                  onClick={() => setService(d => ({ ...d, config: { ...d.config, service_mode: m } }))} 
                  className={`flex-1 py-3 rounded-xl text-xs font-bold uppercase transition-all ${service.config.service_mode === m ? 'bg-white shadow-sm text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        )}

        {service.type !== 'sidecar' && service.config.service_mode === 'private' && (
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Locator Recipients</label>
            <textarea
              rows={4}
              value={service.config.ncc05_recipients?.join('\n') || ''}
              onChange={(e) => {
                const recipients = e.target.value.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
                setService(d => ({ ...d, config: { ...d.config, ncc05_recipients: recipients } }));
              }}
              placeholder="npub1..."
              className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 text-xs font-medium outline-none focus:border-blue-500/50 transition-colors"
            />
            <p className="text-[9px] text-slate-400 italic">One NPUB per line or comma-separated. Only these identities can decrypt the private NCC-05 locator.</p>
          </div>
        )}

        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Service Identity</label>
          <input 
            type="text" placeholder="Service Name (e.g. My Relay)" 
            className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-5 text-sm font-bold outline-none focus:border-blue-500/50 transition-colors mb-2"
            value={service.name}
            onChange={(e) => setService(d => ({ ...d, name: e.target.value }))}
          />
          <input 
            type="text" placeholder="About / Bio (Optional)" 
            className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 text-xs font-medium outline-none focus:border-blue-500/50 transition-colors mb-2"
            value={service.config.profile?.about || ''}
            onChange={(e) => setService(d => ({ ...d, config: { ...d.config, profile: { ...d.config.profile, about: e.target.value } } }))}
          />
          <input 
            type="text" placeholder="Picture URL (Optional)" 
            className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 text-xs font-medium outline-none focus:border-blue-500/50 transition-colors"
            value={service.config.profile?.picture || ''}
            onChange={(e) => setService(d => ({ ...d, config: { ...d.config, profile: { ...d.config.profile, picture: e.target.value } } }))}
          />
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Secret Key (NSEC)</label>
          <div className="flex space-x-2">
            <input 
              type={showNsec ? 'text' : 'password'} placeholder="nsec1..." 
              className="flex-1 bg-slate-50 border border-slate-100 rounded-2xl p-5 text-xs font-mono outline-none focus:border-blue-500/50 transition-colors"
              value={service.service_nsec}
              onChange={(e) => setService(d => ({ ...d, service_nsec: e.target.value }))}
            />
            <button type="button" onClick={handleGenerateKey} className="bg-slate-900 text-white p-5 rounded-2xl hover:bg-slate-800 transition-all">
              <RefreshCw className="w-4 h-4" />
            </button>
            <button type="button" onClick={() => setShowNsec(!showNsec)} className="bg-slate-100 text-slate-600 p-5 rounded-2xl hover:bg-slate-200 transition-all">
              {showNsec ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Service Port</label>
            <input 
              type="number" placeholder="e.g. 80" 
              className={`w-full bg-slate-50 border rounded-2xl p-5 text-sm font-bold outline-none transition-colors ${portIsValid ? 'border-slate-100 focus:border-blue-500/50' : 'border-rose-200 ring-1 ring-rose-200 focus:border-rose-400'}`}
              value={service.config.port ?? ''}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                setService(d => ({ ...d, config: { ...d.config, port: isNaN(val) ? null : val } }));
              }}
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Priority</label>
            <input 
              type="number" placeholder="1" 
              className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-5 text-sm font-bold outline-none focus:border-blue-500/50 transition-colors"
              value={service.config.priority || 1}
              onChange={(e) => setService(d => ({ ...d, config: { ...d.config, priority: parseInt(e.target.value) } }))}
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
                  onClick={() => setService(d => ({ ...d, config: { ...d.config, protocols: { ...d.config.protocols, [p]: !d.config.protocols[p] } } }))}
                  className={`flex-1 py-3 rounded-xl border flex items-center justify-center space-x-2 transition-all ${
                    !isAvailable ? 'bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed' :
                    service.config.protocols[p] ? 'bg-blue-50 border-blue-200 text-blue-600 shadow-sm' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                  }`}
                >
                  <div className={`w-2 h-2 rounded-full ${!isAvailable ? 'bg-slate-300' : service.config.protocols[p] ? 'bg-blue-500' : 'bg-slate-200'}`} />
                  <span className="text-xs font-bold uppercase">{p}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Preferred Protocol</label>
            <span className="text-[9px] text-slate-400 italic">Overrides the advertised scheme in NCC records.</span>
          </div>
          <div className="relative">
            <select
              value={service.config.preferred_protocol || PROTOCOL_OPTIONS[0].value}
              onChange={(e) => setService(d => ({ ...d, config: { ...d.config, preferred_protocol: e.target.value } }))}
              className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 text-xs font-bold outline-none focus:border-blue-500/50 transition-colors appearance-none"
            >
              {PROTOCOL_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">
              ▼
            </div>
          </div>
        </div>

        <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Environment Check</span>
            <button onClick={checkProxy} className="text-[10px] font-bold text-blue-500 hover:text-blue-600 flex items-center">
               {loadingProxy && <RefreshCw className="w-3 h-3 mr-1 animate-spin" />} Detect Reverse Proxy
            </button>
          </div>
          {proxyCheck && (
            <div className="text-[10px] font-mono p-2 bg-white rounded-xl border border-slate-100">
                {proxyCheck.detected ? (
                    <div className="text-green-600 flex items-center">
                        <Check className="w-3 h-3 mr-1.5" />
                        <span>Proxy Detected ({proxyCheck.details?.['x-forwarded-proto'] || 'HTTP'})</span>
                    </div>
                ) : (
                    <div className="text-slate-500 flex items-center">
                        <Globe className="w-3 h-3 mr-1.5" />
                        <span>Direct Connection (Public IP)</span>
                    </div>
                )}
                <div className="mt-1 text-slate-400 text-[9px] break-all">
                    Host: {proxyCheck.details?.host}
                </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave}>Save Profile</Button>
      </div>
    </Modal>
  );
};

export default NewServiceModal;
