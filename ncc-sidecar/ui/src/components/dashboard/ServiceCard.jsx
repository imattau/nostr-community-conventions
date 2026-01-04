import React from 'react';
import { motion as Motion } from 'framer-motion';
import { Trash2, Copy, Check, Key, Globe, Radio, Box, Smartphone, Terminal } from 'lucide-react';
import { nip19 } from 'nostr-tools';
import { getPublicKey } from 'nostr-tools/pure';

const SERVICE_ICONS = {
  relay: <Radio className="w-4 h-4" />,
  media: <Box className="w-4 h-4" />,
  nwc: <Smartphone className="w-4 h-4" />,
  service: <Terminal className="w-4 h-4" />
};

const ServiceCard = ({ 
  service, 
  onEdit, 
  onDelete, 
  copyToClipboard, 
  copiedMap 
}) => {
  const { id, name, config, state, service_nsec } = service;
  
  const fromNsecLocal = (nsec) => {
    try {
      const decoded = nip19.decode(nsec);
      return decoded.data;
    } catch { return null; }
  };

  const serviceNpub = service_nsec ? nip19.npubEncode(getPublicKey(fromNsecLocal(service_nsec))) : null;
  const inventory = state?.last_inventory || [];
  const isProbing = state?.is_probing;
  const torRunning = state?.tor_status?.running;
  const showTorBadge = config?.protocols?.tor && !inventory.some(e => e.family === 'onion');

  // Helper to safely format endpoint URLs
  const formatEndpointLabel = (value) => value ? value.replace(/^[a-z]+:\/\//i, '') : '';

  const getInventoryMeta = () => {
    const tlsMatch = inventory.find(ep => ep.tlsFingerprint || ep.k);
    const tlsFingerprint = tlsMatch?.tlsFingerprint || tlsMatch?.k || 'N/A';
    return { tlsFingerprint };
  };

  const { tlsFingerprint } = getInventoryMeta();

  return (
    <Motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="ncc-card p-8 hover:shadow-2xl hover:border-slate-300 dark:hover:border-slate-700 transition-all group relative overflow-hidden"
      onClick={onEdit}
    >
      <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        <button 
          onClick={(e) => { e.stopPropagation(); onDelete(id); }}
          className="p-2 text-slate-300 hover:text-red-500 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-3">
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${
              config?.service_mode === 'private' ? 'bg-slate-900 text-white dark:bg-slate-800' : 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400'
            }`}>
              {SERVICE_ICONS[config?.type || 'relay'] || SERVICE_ICONS['relay']}
            </div>
            <div>
              <h3 className="text-lg font-black tracking-tight text-slate-900 dark:text-white leading-none">{name}</h3>
              <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mt-1">
                {config?.service_mode || 'public'} service
              </p>
            </div>
          </div>
          {showTorBadge && (
            <div className={`px-2 py-1 rounded-md border text-[9px] font-bold uppercase flex items-center gap-1.5 ${
              torRunning ? 'bg-purple-50 text-purple-600 border-purple-100 dark:bg-purple-900/20 dark:text-purple-400 dark:border-purple-900/30' : 'bg-orange-50 text-orange-600 border-orange-100 dark:bg-orange-900/20 dark:text-orange-400 dark:border-orange-900/30'
            }`}>
              <Globe className="w-3 h-3" />
              {torRunning ? 'Tor Active' : 'Tor Starting'}
            </div>
          )}
        </div>

        <div className="space-y-2">
          {inventory.slice(0, 3).map((ep, idx) => (
            <div key={idx} className="flex items-center justify-between text-xs font-mono text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/50 px-3 py-2 rounded-xl border border-slate-100 dark:border-slate-800 group/item">
              <span className="truncate max-w-[180px]">{formatEndpointLabel(ep.url)}</span>
              <div className="flex items-center gap-2">
                <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded ${
                  ep.family === 'onion' ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400' : 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                }`}>
                  {ep.family === 'onion' ? 'TOR' : ep.family.toUpperCase()}
                </span>
                <button 
                  onClick={(e) => { e.stopPropagation(); copyToClipboard(ep.url, `ep-${id}-${idx}`); }}
                  className="text-slate-300 hover:text-blue-500 opacity-0 group-hover/item:opacity-100 transition-opacity"
                >
                  {copiedMap[`ep-${id}-${idx}`] ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
            </div>
          ))}
          {!inventory.length && (
            <div className="text-center py-4 bg-slate-50 dark:bg-slate-800/30 rounded-xl border border-slate-100 dark:border-slate-800 border-dashed">
              <p className="text-[10px] text-slate-400 dark:text-slate-600 font-medium italic">
                {isProbing ? 'Probing endpoints...' : 'No active endpoints'}
              </p>
            </div>
          )}
        </div>

        <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2 text-slate-400 dark:text-slate-600">
            <Key className="w-3.5 h-3.5" />
            <span className="text-[10px] font-mono">
              {tlsFingerprint !== 'N/A' ? `${tlsFingerprint.slice(0, 16)}...` : 'No TLS'}
            </span>
          </div>
          {serviceNpub && (
            <button 
              onClick={(e) => { e.stopPropagation(); copyToClipboard(serviceNpub, `npub-${id}`); }}
              className="text-[10px] font-black text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 uppercase tracking-widest flex items-center gap-1.5"
            >
              {copiedMap[`npub-${id}`] ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              COPY NPUB
            </button>
          )}
        </div>
      </div>
    </Motion.div>
  );
};

export default ServiceCard;
