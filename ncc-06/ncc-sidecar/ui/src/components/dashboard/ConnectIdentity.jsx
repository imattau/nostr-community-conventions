import React, { useState } from 'react';
import { Shield, Smartphone, QrCode, Terminal, ChevronRight, Copy, Check, AlertCircle } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { getPublicKey, generateSecretKey } from 'nostr-tools/pure';
import { SimplePool, nip19, nip04, nip44 } from 'nostr-tools';
import { Nip07Signer, LocalSigner } from '../../lib/signer';

const toHex = (bytes) => Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
const hexToBytes = (hex) => new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

const ConnectIdentity = ({ onAuthSuccess, initialized }) => {
  const [mode, setMode] = useState('choice');
  const [manualPubkey, setManualPubkey] = useState('');
  const [localNsec, setLocalNsec] = useState('');
  const [nip46Uri, setNip46Uri] = useState('');
  const [nip46Logs, setNip46Logs] = useState([]);
  const [relayStatus, setRelayStatus] = useState({});
  const [copiedMap, setCopiedMap] = useState({});

  const copyToClipboard = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopiedMap(prev => ({ ...prev, [key]: true }));
    setTimeout(() => setCopiedMap(prev => ({ ...prev, [key]: false })), 2000);
  };

  const addNip46Log = (msg) => {
    setNip46Logs(prev => [...prev.slice(-4), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const startNIP46 = async () => {
    const sk = generateSecretKey();
    const pkRaw = getPublicKey(sk);
    const pk = (typeof pkRaw === 'string') ? pkRaw : toHex(pkRaw);
    
    const pool = new SimplePool();
    const relays = [
      'wss://nostr-pub.wellorder.net',
      'wss://relay.fiatjaf.com',
      'wss://nostr.bitcoiner.social',
      'wss://nostr-01.brightid.org',
      'wss://nostr-relay.wlvs.space',
      'wss://nos.lol'
    ];
    
    setRelayStatus(Object.fromEntries(relays.map(r => [r, 'connecting'])));
    setNip46Logs([]);
    addNip46Log("Initializing secure channel...");
    
    const clientNpub = nip19.npubEncode(pk);
    const uri = `nostrconnect://${clientNpub}?${relays.map(r => `relay=${encodeURIComponent(r)}`).join('&')}&metadata=${encodeURIComponent(JSON.stringify({ name: 'NCC Sidecar' }))}`;
    setNip46Uri(uri);
    setMode('nip46');

    const handleEvent = async (event) => {
      try {
        addNip46Log("Received response!");
        let decrypted;
        try {
          decrypted = await nip04.decrypt(sk, event.pubkey, event.content);
        } catch {
          console.debug("[NIP-46] nip04 decrypt failed, falling back to nip44");
          const conversationKey = nip44.getConversationKey(sk, hexToBytes(event.pubkey));
          decrypted = nip44.decrypt(event.content, conversationKey);
        }
        const parsed = JSON.parse(decrypted);
        if (parsed.result || parsed.method === 'connect') {
          const adminPk = (parsed.result && parsed.result !== 'ack') ? parsed.result : event.pubkey;
          addNip46Log("Verifying authority...");
          await onAuthSuccess({ pubkey: adminPk, signer: null });
          pool.close(relays);
        }
      } catch (_e) {
        console.warn("[NIP-46] Error:", _e.message);
      }
    };

    relays.forEach(async (url) => {
      try {
        await pool.ensureRelay(url);
        setRelayStatus(prev => ({ ...prev, [url]: 'connected' }));
        addNip46Log(`Listening on ${url.split('//')[1]}`);
        
        const sub = pool.sub([url], [{
          kinds: [24133],
          '#p': [pk],
          limit: 1
        }]);
        
        sub.on('event', handleEvent);
      } catch {
        setRelayStatus(prev => ({ ...prev, [url]: 'failed' }));
      }
    });
  };

  const handleManualAuth = () => {
    try {
      // Basic normalization
      let clean = manualPubkey.trim();
      if (clean.startsWith('npub')) {
        clean = nip19.decode(clean).data;
      }
      onAuthSuccess({ pubkey: clean, signer: null }); 
    } catch {
      alert("Invalid pubkey format");
    }
  };

  const handleNsecAuth = () => {
    try {
      let clean = localNsec.trim();
      let secretBytes;
      if (clean.startsWith('nsec')) {
        secretBytes = nip19.decode(clean).data;
      } else {
        secretBytes = new Uint8Array(clean.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
      }
      const pk = getPublicKey(secretBytes);
      const signer = new LocalSigner(secretBytes);
      onAuthSuccess({ pubkey: pk, signer });
    } catch {
      alert("Invalid private key format");
    }
  };

  const handleExtensionAuth = async () => {
    if (window.nostr) {
      try {
        const pk = await window.nostr.getPublicKey();
        const signer = new Nip07Signer();
        onAuthSuccess({ pubkey: pk, signer });
      } catch {
        alert("Extension error");
      }
    } else {
      alert("NIP-07 Extension not found (Alby, Nos2x, etc.)");
    }
  };

  return (
    <div className="space-y-10">
      <div className="space-y-2 text-center">
        <div className="w-20 h-20 bg-blue-500/10 rounded-[2rem] flex items-center justify-center mx-auto border border-blue-500/20 mb-6">
          <Shield className="w-10 h-10 text-blue-400" />
        </div>
        <h1 className="text-4xl font-black tracking-tight leading-none">
          {initialized ? 'Connect Identity' : 'Initialize Node'}
        </h1>
        <p className="text-slate-400 font-medium">
          {initialized ? 'Login to manage your services.' : 'Connect your admin identity to provision the Sidecar.'}
        </p>
      </div>

      {mode === 'choice' && (
        <div className="grid grid-cols-1 gap-4">
          {[
            { id: 'nip07', label: 'Browser Extension', icon: <Smartphone className="w-5 h-5 text-blue-400" />, desc: 'Use Alby, Nos2x, or similar', action: handleExtensionAuth },
            { id: 'nip46', label: 'Remote Signer', icon: <QrCode className="w-5 h-5 text-indigo-400" />, desc: 'Connect via Amber, Nex, or Bunker', action: startNIP46 },
            { id: 'advanced', label: 'Advanced Options', icon: <Terminal className="w-5 h-5 text-slate-400" />, desc: 'Manual Pubkey or NSEC entry', action: () => setMode('advanced') }
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

      {mode === 'nip46' && (
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
            
            <button onClick={() => setMode('choice')} className="text-slate-500 font-bold text-xs uppercase tracking-widest hover:text-white transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {mode === 'advanced' && (
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
            <button onClick={handleNsecAuth} className="w-full bg-white text-slate-900 font-black py-5 rounded-3xl shadow-xl hover:bg-slate-100 transition-all">
              {initialized ? 'CONNECT' : 'START PROVISIONING'}
            </button>
            <div className="border-t border-white/5 pt-4">
              <p className="text-xs text-slate-500 mb-2">Or enter manual hex/npub:</p>
              <input 
                type="text" placeholder="npub..." 
                className="w-full bg-slate-800 border border-white/5 rounded-2xl p-4 text-xs font-mono outline-none focus:border-blue-500/50 transition-colors"
                value={manualPubkey}
                onChange={(e) => setManualPubkey(e.target.value)}
              />
              {manualPubkey && <button onClick={handleManualAuth} className="mt-2 text-blue-400 text-xs font-bold uppercase">Confirm Pubkey</button>}
            </div>
          </div>
          <button onClick={() => setMode('choice')} className="text-slate-500 font-bold text-xs uppercase tracking-widest hover:text-white transition-colors text-center w-full">Return to Safety</button>
        </div>
      )}
    </div>
  );
};

export default ConnectIdentity;