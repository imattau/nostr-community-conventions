import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { AnimatePresence, motion as Motion } from 'framer-motion';
import { 
  Shield, Key, Globe, Plus, Trash2, Activity, Box, 
  ChevronRight, Smartphone, QrCode, Terminal, 
  Copy, Check, AlertCircle, RefreshCw, LogOut, ExternalLink,
  Radio, Menu, Eye, EyeOff
} from 'lucide-react';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { nip19, nip04, nip44, SimplePool } from 'nostr-tools';
import { parseManualAdminPubkey } from './lib/adminKeyParser';
import { QRCodeSVG } from 'qrcode.react';

const toHex = (bytes) => Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
const hexToBytes = (hex) => new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

const formatTimeWithZone = (value) => {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  }).format(new Date(value));
};

const formatDateTimeWithZone = (value) => {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  }).format(new Date(value));
};

const API_BASE = '/api';

const SERVICE_TYPES = [
  { id: 'relay', label: 'Nostr Relay', icon: <Radio className="w-4 h-4" />, defaultId: 'relay' },
  { id: 'blossom', label: 'Blossom Media', icon: <Box className="w-4 h-4" />, defaultId: 'media' },
  { id: 'nwc', label: 'Lightning (NWC)', icon: <Smartphone className="w-4 h-4" />, defaultId: 'nwc' },
  { id: 'custom', label: 'Custom API', icon: <Terminal className="w-4 h-4" />, defaultId: 'service' }
];

const createDefaultServiceConfig = () => ({
  refresh_interval_minutes: 360,
  ncc02_expiry_days: 14,
  ncc05_ttl_hours: 12,
  service_mode: 'public',
  protocols: { ipv4: true, ipv6: true, tor: true },
  primary_protocol: 'ipv4',
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

const formatEndpointLabel = (value) => value ? value.replace(/^[a-z]+:\/\//i, '') : '';

const buildProfileDraft = (profile = {}) => ({
  name: profile.name || '',
  display_name: profile.display_name || '',
  about: profile.about || '',
  picture: profile.picture || '',
  nip05: profile.nip05 || ''
});

export default function App() {
  const [initialized, setInitialized] = useState(null);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [stylesReady, setStylesReady] = useState(false);
  const [services, setServices] = useState([]);
  const [logs, setLogs] = useState([]);
  const [selectedLog, setSelectedLog] = useState(null);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [loginMode, setLoginMode] = useState('choice');
  const [nip46Uri, setNip46Uri] = useState('');
  const [manualPubkey, setManualPubkey] = useState('');
  const [localNsec, setLocalNsec] = useState('');
  const [copiedMap, setCopiedMap] = useState({});
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
  const [regeneratingTlsServiceId, setRegeneratingTlsServiceId] = useState(null);
  const [recipientInput, setRecipientInput] = useState('');
  const [showRelaysModal, setShowRelaysModal] = useState(false);
  const [relayModalInput, setRelayModalInput] = useState('');
  const [isRepublishing, setIsRepublishing] = useState(false);
  const [appConfig, setAppConfig] = useState({});
  const [showNodeSettingsModal, setShowNodeSettingsModal] = useState(false);
  const [allowRemoteLoading, setAllowRemoteLoading] = useState(false);
  const [dbInfo, setDbInfo] = useState(null);
  const [dbCurrentPassword, setDbCurrentPassword] = useState('');
  const [dbNewPassword, setDbNewPassword] = useState('');
  const [dbPasswordLoading, setDbPasswordLoading] = useState(false);
  const [dbExporting, setDbExporting] = useState(false);
  const [dbImporting, setDbImporting] = useState(false);
  const [dbWiping, setDbWiping] = useState(false);
  const [dbImportFile, setDbImportFile] = useState(null);
  const [dbImportName, setDbImportName] = useState('');
  const [dbExportPassword, setDbExportPassword] = useState('');
  const [dbImportPassword, setDbImportPassword] = useState('');
  const [dbWipePassword, setDbWipePassword] = useState('');
  const [nodeSectionOpen, setNodeSectionOpen] = useState({
    remote: false,
    publicationRelays: false,
    protocols: false,
    identity: false,
    database: false
  });
  const [showSidecarProfileModal, setShowSidecarProfileModal] = useState(false);
  const [sidecarProfileDraft, setSidecarProfileDraft] = useState(buildProfileDraft());
  const [isSavingSidecarProfile, setIsSavingSidecarProfile] = useState(false);
  const [protocolLoading, setProtocolLoading] = useState(null);
  const [serviceModeLoading, setServiceModeLoading] = useState(null);
  const [isRotatingIdentity, setIsRotatingIdentity] = useState(false);
  const [isRotatingOnion, setIsRotatingOnion] = useState(false);
  const [newService, setNewService] = useState(buildEmptyService());
  const [showServiceNsec, setShowServiceNsec] = useState(false);
  const [pendingOnionRefresh, setPendingOnionRefresh] = useState({});
  const portIsValid = Number.isInteger(newService.config?.port) && newService.config?.port > 0;
  const canSaveService = Boolean(newService.name && newService.service_nsec && portIsValid);
  
  useEffect(() => {
    if (!newService.service_nsec) {
      setShowServiceNsec(false);
    }
  }, [newService.service_nsec]);
  useEffect(() => {
    if (!Object.keys(pendingOnionRefresh).length) return;
    setPendingOnionRefresh((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [serviceId, info] of Object.entries(prev)) {
        const service = services.find((s) => String(s.id) === String(serviceId));
        const currentOnionUrl = service?.state?.last_inventory?.find((ep) => ep.family === 'onion')?.url || null;
        if (currentOnionUrl && currentOnionUrl !== info.previousOnion) {
          delete next[serviceId];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [services, pendingOnionRefresh]);
  const onionEndpoint = newService.state?.last_inventory?.find(ep => ep.family === 'onion');
  const onionAddressValue = onionEndpoint?.url || '';
  const tlsEndpoint = newService.state?.last_inventory?.find(ep => ep.tlsFingerprint || ep.k);
  const tlsFingerprintValue = tlsEndpoint?.tlsFingerprint || tlsEndpoint?.k || '';
  const canRotateOnion = Boolean(editServiceId);

  const addNip46Log = (msg) => {
    const time = formatTimeWithZone(Date.now());
    setNip46Logs(prev => [...prev.slice(-4), `[${time}] ${msg}`]);
  };

  const parseLogMetadata = (raw) => {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch (metadataErr) {
        console.warn("[Logs] Failed to parse metadata:", metadataErr);
        return { raw };
      }
    }
    return { raw };
  };

  const selectedLogMetadata = useMemo(() => parseLogMetadata(selectedLog?.metadata), [selectedLog]);
  const formatLogId = (value) => value ? `${value.slice(0, 8)}...${value.slice(-8)}` : null;

  const handleLogClick = (log) => {
    setSelectedLog(prev => (prev && prev.id === log.id ? null : log));
  };

  const parseRecipientInput = (value) => {
    if (!value) return [];
    return Array.from(new Set(value
      .split(/[\s,]+/)
      .map(token => token.trim())
      .filter(Boolean)
      .map(token => {
        let candidate = token;
        if (candidate.toLowerCase().startsWith('npub')) {
          try {
            const decoded = nip19.decode(candidate);
            if (decoded?.type === 'npub' && typeof decoded.data === 'string') {
              candidate = decoded.data;
            } else {
              return null;
            }
          } catch {
            return null;
          }
        }
        const normalized = candidate.toLowerCase();
        return /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
      })
      .filter(Boolean)));
  };

  const formatRecipientInputValue = (recipients = []) => {
    return recipients.map(hex => {
      try {
        return nip19.npubEncode(hex);
      } catch {
        return hex;
      }
    }).join('\n');
  };

  const handleRecipientInputChange = (value) => {
    setRecipientInput(value);
    const parsed = parseRecipientInput(value);
    setNewService(d => ({ ...d, config: { ...d.config, ncc05_recipients: parsed } }));
  };

  const handlePortInputChange = (value) => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    const numeric = trimmed === '' ? null : Number(trimmed);
    setNewService(d => ({
      ...d,
      config: {
        ...d.config,
        port: Number.isNaN(numeric) ? null : numeric
      }
    }));
  };

  const normalizeRelayInput = (value) => {
    if (!value) return [];
    const entries = Array.from(new Set(value
      .split(/[\s,]+/)
      .map(token => token.trim())
      .filter(Boolean)));
    const normalized = [];
    for (const entry of entries) {
      let candidate = entry;
      if (/^https?:\/\//i.test(candidate)) {
        candidate = candidate.replace(/^https?:\/\//i, match => (match.toLowerCase() === 'https://' ? 'wss://' : 'ws://'));
      } else if (!/^wss?:\/\//i.test(candidate)) {
        candidate = `wss://${candidate}`;
      }
      normalized.push(candidate);
    }
    return normalized;
  };

  const arrayBufferToBase64 = (buffer) => {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x7fff;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  };

  const formatBytes = (bytes = 0) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let idx = 0;
    while (value >= 1024 && idx < units.length - 1) {
      value /= 1024;
      idx += 1;
    }
    return `${value.toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`;
  };

  const fetchAdmins = async () => {
    try {
      const res = await axios.get(`${API_BASE}/admins`);
      setAdmins(res.data);
    } catch (_err) {
      console.warn("Failed to fetch admins:", _err);
    }
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
    setLoadingLogs(true);
    try {
      const res = await axios.get(`${API_BASE}/services`);
      setServices(prev => {
        // Optimization: prevent re-renders if data is identical
        if (JSON.stringify(prev) === JSON.stringify(res.data)) return prev;
        return res.data;
      });
      const logRes = await axios.get(`${API_BASE}/status`);
      setAppConfig(logRes.data.config || {});
      if (logRes.data.logs) {
        setLogs(prev => {
          if (JSON.stringify(prev) === JSON.stringify(logRes.data.logs)) return prev;
          return logRes.data.logs;
        });
      }
    } catch (_err) {
      console.warn("Failed to refresh services:", _err);
    }
    finally {
      setLoadingLogs(false);
    }
  };

  const handleRepublish = async () => {
    setIsRepublishing(true);
    try {
      await axios.post(`${API_BASE}/services/republish`);
      fetchServices();
    } catch (_err) {
      alert(`Failed to republish services: ${_err.message}`);
    } finally {
      setIsRepublishing(false);
    }
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
    } catch { return null; }
  };

  const saveAdminPk = (pk) => {
    setSetupData(prev => ({ ...prev, adminPubkey: pk }));
    localStorage.setItem('ncc_admin_pk', pk);
  };

  const verifyAndSaveAdmin = async (pk) => {
    if (initialized) {
      try {
        const res = await axios.get(`${API_BASE}/admins`);
        const normalizedPk = pk?.toLowerCase();
        const isAdmin = res.data.some(a => a.pubkey.toLowerCase() === normalizedPk);
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

  const handleForceConnection = async () => {
    try {
      const finalPk = parseManualAdminPubkey(manualPubkey);
      console.info('[NIP-46 Force] manual input:', manualPubkey);
      console.info('[NIP-46 Force] normalized hex:', finalPk);
      const success = await verifyAndSaveAdmin(finalPk);
      if (!success) {
        console.warn('[NIP-46 Force] admin verification failed for', finalPk);
      }
    } catch (err) {
      console.warn('[NIP-46 Force] manual input failed:', manualPubkey, err.message);
      alert('Invalid npub/hex');
    }
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
    
    setRelayStatus(Object.fromEntries(relays.map(r => [r, 'connecting'])));
    setNip46Logs([]);
    addNip46Log("Initializing secure channel...");
    
    const clientNpub = nip19.npubEncode(pk);
    const uri = `nostrconnect://${clientNpub}?${relays.map(r => `relay=${encodeURIComponent(r)}`).join('&')}&metadata=${encodeURIComponent(JSON.stringify({ name: 'NCC Sidecar' }))}`;
    setNip46Uri(uri);
    setLoginMode('nip46');

    const handleEvent = async (event) => {
      try {
        addNip46Log("Received response!");
        let decrypted;
        try {
          decrypted = await nip04.decrypt(sk, event.pubkey, event.content);
        } catch (_err) {
          console.debug("[NIP-46] nip04 decrypt failed, falling back to nip44:", _err);
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
      } catch (_err) {
        setRelayStatus(prev => ({ ...prev, [url]: 'failed' }));
        console.warn("[NIP-46] Relay connection failed:", url, _err);
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
    setNewService(buildEmptyService());
    setRecipientInput('');
    setShowServiceNsec(false);
  };

  const handleSaveService = async () => {
    if (!canSaveService) {
      alert('Provide a name, NSEC, and backend port before saving this discovery profile.');
      return;
    }
    try {
      if (editServiceId) {
        await axios.put(`${API_BASE}/service/${editServiceId}`, newService);
      } else {
        await axios.post(`${API_BASE}/service/add`, newService);
      }
      setShowNewServiceModal(false);
      setEditServiceId(null);
      setNewService(buildEmptyService());
      setRecipientInput('');
      setShowServiceNsec(false);
      fetchServices();
    } catch (e) { alert(`Failed to ${editServiceId ? 'update' : 'add'} service: ` + e.message); }
  };

  const handleEditService = (service) => {
    setEditServiceId(service.id);
    const normalizedConfig = {
      ...service.config,
      ncc05_recipients: Array.isArray(service.config?.ncc05_recipients) ? service.config.ncc05_recipients : []
    };
    setNewService({
        type: service.type,
        name: service.name,
        service_id: service.service_id,
        service_nsec: service.service_nsec,
        config: normalizedConfig,
        state: service.state || {}
    });
    setRecipientInput(formatRecipientInputValue(normalizedConfig.ncc05_recipients));
    setShowNewServiceModal(true);
    setShowServiceNsec(false);
  };

  const handleRotateOnion = () => {
    if (!confirm('Rotate Onion Address? This will happen on next save.')) return;
    if (editServiceId) {
      const currentService = services.find((s) => String(s.id) === String(editServiceId));
      const currentOnionUrl = currentService?.state?.last_inventory?.find((ep) => ep.family === 'onion')?.url || null;
      setPendingOnionRefresh(prev => ({
        ...prev,
        [editServiceId]: { previousOnion: currentOnionUrl }
      }));
    }
    setNewService(d => ({
      ...d,
      config: { ...d.config, onion_private_key: undefined }
    }));
  };

  const handleDeleteService = async (id) => {
    if (!confirm("Are you sure you want to delete this discovery profile?")) return;
    try {
      await axios.delete(`${API_BASE}/service/${id}`);
      fetchServices();
      if (showNewServiceModal) setShowNewServiceModal(false);
    } catch (e) { alert("Failed to delete service: " + e.message); }
  };

  const openRelaySettings = () => {
    const sidecar = services.find(s => s.type === 'sidecar');
    const configuredRelays = Array.isArray(appConfig.publication_relays)
      ? appConfig.publication_relays
      : (sidecar?.config?.publication_relays || []);
    setRelayModalInput(configuredRelays.join('\n'));
    setShowRelaysModal(true);
  };

  const openNodeSettings = () => {
    setShowMenu(false);
    setShowNodeSettingsModal(true);
  };

  const openSidecarProfileSettings = () => {
    const sidecar = services.find(s => s.type === 'sidecar');
    if (!sidecar) return;
    setSidecarProfileDraft(buildProfileDraft(sidecar.config?.profile));
    setShowSidecarProfileModal(true);
  };

  const handleSidecarProfileChange = (field, value) => {
    setSidecarProfileDraft(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSaveSidecarProfile = async () => {
    if (isSavingSidecarProfile) return;
    const sidecar = services.find(s => s.type === 'sidecar');
    if (!sidecar) return;
    setIsSavingSidecarProfile(true);
    try {
      const updatedConfig = {
        ...sidecar.config,
        profile: {
          ...sidecar.config.profile,
          ...sidecarProfileDraft
        }
      };
      await axios.put(`${API_BASE}/service/${sidecar.id}`, { config: updatedConfig });
      fetchServices();
      setShowSidecarProfileModal(false);
    } catch (err) {
      alert('Failed to update sidecar profile: ' + (err.response?.data?.error || err.message));
    } finally {
      setIsSavingSidecarProfile(false);
    }
  };

  const handleToggleAllowRemote = async () => {
    if (allowRemoteLoading) return;
    setAllowRemoteLoading(true);
    try {
      const desiredAllowRemote = !allowRemoteEnabled;
      const res = await axios.put(`${API_BASE}/config/allow-remote`, { allowRemote: desiredAllowRemote });
      setAppConfig(prev => ({ ...prev, allow_remote: res.data?.allow_remote ?? desiredAllowRemote }));
      fetchServices();
    } catch (err) {
      alert('Failed to update remote access policy: ' + err.message);
    } finally {
      setAllowRemoteLoading(false);
    }
  };

  const handleToggleProtocol = async (protocol) => {
    if (protocolLoading) return;
    const current = appConfig.protocols || createDefaultServiceConfig().protocols;
    const desiredValue = !current[protocol];
    setProtocolLoading(protocol);
    try {
      const res = await axios.put(`${API_BASE}/config/protocols`, {
        protocols: { ...current, [protocol]: desiredValue }
      });
      const normalized = res.data?.protocols || { ...current, [protocol]: desiredValue };
      setAppConfig(prev => ({ ...prev, protocols: normalized }));
      fetchServices();
    } catch (err) {
      alert('Failed to update endpoint availability: ' + err.message);
    } finally {
      setProtocolLoading(null);
    }
  };

  const handleSetServiceMode = async (mode) => {
    if (serviceModeLoading || serviceMode === mode) return;
    setServiceModeLoading(mode);
    try {
      const res = await axios.put(`${API_BASE}/config/service-mode`, { service_mode: mode });
      setAppConfig(prev => ({ ...prev, service_mode: res.data?.service_mode || mode }));
      fetchServices();
    } catch (err) {
      alert('Failed to update service visibility: ' + err.message);
    } finally {
      setServiceModeLoading(null);
    }
  };

  const handleSaveRelays = async () => {
    const relays = normalizeRelayInput(relayModalInput);
    try {
      const res = await axios.put(`${API_BASE}/config/publication-relays`, { relays });
      setAppConfig(prev => ({
        ...prev,
        publication_relays: Array.isArray(res.data.publication_relays) ? res.data.publication_relays : relays
      }));
      fetchServices();
      setShowRelaysModal(false);
    } catch (err) {
      alert(`Failed to save relays: ${err.message}`);
    }
  };

  const loadDbInfo = async () => {
    try {
      const res = await axios.get(`${API_BASE}/db/info`);
      setDbInfo(res.data);
    } catch (err) {
      console.warn("Failed to load database info:", err);
      setDbInfo(null);
    }
  };

  useEffect(() => {
    if (showNodeSettingsModal) {
      loadDbInfo();
    }
  }, [showNodeSettingsModal]);

  const handleSetDbPassword = async () => {
    if (dbPasswordLoading) return;
    setDbPasswordLoading(true);
    try {
      await axios.post(`${API_BASE}/db/password`, {
        currentPassword: dbCurrentPassword || null,
        newPassword: dbNewPassword || null
      });
      alert('Database password updated.');
      setDbCurrentPassword('');
      setDbNewPassword('');
      loadDbInfo();
    } catch (err) {
      alert(`Failed to update database password: ${err.response?.data?.error || err.message}`);
    } finally {
      setDbPasswordLoading(false);
    }
  };

  const handleExportDb = async () => {
    if (dbExporting) return;
    setDbExporting(true);
    try {
      const params = new URLSearchParams();
      if (dbExportPassword) params.set('password', dbExportPassword);
      const query = params.toString() ? `?${params.toString()}` : '';
      const res = await fetch(`${API_BASE}/db/export${query}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Export failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'sidecar.db';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Failed to export database: ${err.message}`);
    } finally {
      setDbExporting(false);
    }
  };

  const handleDbImportFileChange = (event) => {
    const file = event.target.files?.[0];
    if (file) {
      setDbImportFile(file);
      setDbImportName(file.name);
    } else {
      setDbImportFile(null);
      setDbImportName('');
    }
  };

  const handleImportDb = async () => {
    if (!dbImportFile) {
      alert('Select a database file to import.');
      return;
    }
    if (!confirm('Importing a new database will replace the current data. Continue?')) return;
    setDbImporting(true);
    try {
      const buffer = await dbImportFile.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);
      await axios.post(`${API_BASE}/db/import`, {
        data: base64,
        password: dbImportPassword || null
      });
      alert('Database imported successfully. Services will refresh shortly.');
      setDbImportFile(null);
      setDbImportName('');
      loadDbInfo();
      fetchServices();
    } catch (err) {
      alert(`Failed to import database: ${err.response?.data?.error || err.message}`);
    } finally {
      setDbImporting(false);
    }
  };

  const handleWipeDb = async () => {
    if (!confirm('This will erase all services, logs, and configuration. Proceed?')) return;
    if (dbWiping) return;
    setDbWiping(true);
    try {
      await axios.post(`${API_BASE}/db/wipe`, { password: dbWipePassword || null });
      alert('Database wiped. The UI will reload so you can reconfigure the Sidecar.');
      loadDbInfo();
      window.location.reload();
    } catch (err) {
      alert(`Failed to wipe database: ${err.response?.data?.error || err.message}`);
    } finally {
      setDbWiping(false);
    }
  };

  const regenerateTls = async (serviceId, { showAlert = true } = {}) => {
    const service = services.find(s => String(s.id) === String(serviceId));
    if (!service || service.config?.generate_self_signed === false) return;
    setRegeneratingTlsServiceId(service.id);
    try {
      await axios.post(`${API_BASE}/service/${service.id}/regenerate-tls`);
      fetchServices();
      if (showAlert) {
        alert('TLS certificate regenerated. The new fingerprint will be used on the next publish.');
      }
    } catch (e) {
      alert('Failed to regenerate TLS certificate: ' + e.message);
    } finally {
      setRegeneratingTlsServiceId(null);
    }
  };

  const handleRegenerateTls = async () => {
    if (!editServiceId || newService.config?.generate_self_signed === false) return;
    if (!confirm('Regenerate the self-signed TLS certificate for this service?')) return;
    await regenerateTls(editServiceId);
  };

  const copyToClipboard = (text, key) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedMap(prev => ({ ...prev, [key]: true }));
    setTimeout(() => setCopiedMap(prev => ({ ...prev, [key]: false })), 2000);
  };

  const getServiceInventoryMeta = (service) => {
    const baseInventory = service.state?.last_inventory || [];
    const isRefreshingOnion = Boolean(pendingOnionRefresh[service.id]);
    const displayInventory = isRefreshingOnion
      ? baseInventory.filter(ep => ep.family !== 'onion')
      : baseInventory;
    const hasHiddenOnion = isRefreshingOnion && baseInventory.some(ep => ep.family === 'onion');
    const tlsMatch = displayInventory.find(ep => ep.tlsFingerprint || ep.k);
    const tlsFingerprint = tlsMatch?.tlsFingerprint || tlsMatch?.k || 'N/A';
    return { displayInventory, hasHiddenOnion, tlsFingerprint };
  };

  const allowRemoteEnabled = Boolean(appConfig.allow_remote);
  const publicationRelays = Array.isArray(appConfig.publication_relays) ? appConfig.publication_relays : [];
  const protocolConfig = appConfig.protocols || { ...createDefaultServiceConfig().protocols };
  const serviceMode = appConfig.service_mode || 'private';
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
    const sidecarCanRegenerateTls = sidecarNode?.config?.generate_self_signed !== false;
    const isNodeTlsRegenerating = regeneratingTlsServiceId === sidecarNode?.id;

    const handleNodeGenerateIdentity = async () => {
      if (!sidecarNode) return;
      if (!confirm('Regenerating the management identity will require reauthorizing with the new key. Continue?')) return;
      setIsRotatingIdentity(true);
      try {
        const keyRes = await axios.get(`${API_BASE}/service/generate-key`);
        await axios.put(`${API_BASE}/service/${sidecarNode.id}`, { service_nsec: keyRes.data.nsec });
        alert('Management identity regenerated. Save the new key and reauthorize admin clients.');
        fetchServices();
      } catch (err) {
        alert('Failed to regenerate identity: ' + (err.response?.data?.error || err.message));
      } finally {
        setIsRotatingIdentity(false);
      }
    };

    const handleNodeRotateOnion = async () => {
      if (!sidecarNode) return;
      if (!confirm('Rotate Onion Address? This will generate a new Tor hostname after the next publish.')) return;
      setIsRotatingOnion(true);
      const currentOnionUrl = sidecarNode.state?.last_inventory?.find((ep) => ep.family === 'onion')?.url || null;
      setPendingOnionRefresh(prev => ({
        ...prev,
        [sidecarNode.id]: { previousOnion: currentOnionUrl }
      }));
      try {
        const nextConfig = { ...sidecarNode.config };
        delete nextConfig.onion_private_key;
        await axios.put(`${API_BASE}/service/${sidecarNode.id}`, { config: nextConfig });
        alert('Onion rotation requested. The new address will appear after the publish cycle completes.');
        fetchServices();
      } catch (err) {
        alert('Failed to rotate onion address: ' + (err.response?.data?.error || err.message));
      } finally {
        setIsRotatingOnion(false);
      }
    };

  const handleNodeRegenerateTls = async () => {
    if (!sidecarNode) return;
    await regenerateTls(sidecarNode.id);
  };

  const toggleNodeSection = (key) => {
    setNodeSectionOpen(prev => ({ ...prev, [key]: !prev[key] }));
  };

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
                  <Motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="absolute top-full right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-slate-100 overflow-hidden z-50"
                  >
                    <button onClick={openNodeSettings} className="w-full text-left px-4 py-3 text-xs font-bold text-slate-600 hover:bg-slate-50 hover:text-blue-600 transition-colors">
                      Node Settings
                    </button>
                    <button onClick={() => { setShowMenu(false); openSidecarProfileSettings(); }} className="w-full text-left px-4 py-3 text-xs font-bold text-slate-600 hover:bg-slate-50 hover:text-blue-600 transition-colors">
                      Sidecar Profile
                    </button>
                    <button onClick={() => { setShowMenu(false); setShowAdminModal(true); fetchAdmins(); }} className="w-full text-left px-4 py-3 text-xs font-bold text-slate-600 hover:bg-slate-50 hover:text-blue-600 border-t border-slate-50 transition-colors">
                      Administrators
                    </button>
                  </Motion.div>
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
              onClick={() => openNodeSettings()}
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
                        <span>{formatEndpointLabel(onionEndpoint.url)}</span>
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
                      <Motion.div 
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
                    {['ipv4', 'ipv6', 'onion'].map((family) => {
                      const available = protocolConfig[family === 'onion' ? 'tor' : family] !== false;
                      const hasEndpoint = sidecarNode.state?.last_inventory?.some(e => e.family === family);
                      const isActive = available && hasEndpoint;
                      const dotColor = family === 'onion' ? 'bg-purple-400' : 'bg-blue-400';
                      return (
                        <div
                          key={family}
                          className={`flex items-center space-x-1.5 px-2 py-1 rounded-md border ${
                            isActive ? 'bg-slate-800 border-white/10' : 'bg-slate-900/30 border-white/5'
                          }`}
                        >
                          <div className={`w-1.5 h-1.5 rounded-full ${isActive ? dotColor : 'bg-slate-600'}`} />
                          <span className={`text-[9px] font-bold uppercase ${isActive ? 'text-slate-100' : 'text-slate-500'}`}>
                            {family === 'onion' ? 'Tor' : family.toUpperCase()}
                          </span>
                        </div>
                      );
                    })}
                    {!sidecarNode.state?.last_inventory?.length && (
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
          {sidecarNode && (
            <section className="mb-12 bg-white rounded-[2.5rem] p-6 border border-slate-100 shadow-lg shadow-slate-900/5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-black tracking-tight text-slate-900">Publication Relays</h3>
                  <p className="text-[11px] text-slate-500 uppercase tracking-widest font-bold">Sidecar broadcast targets</p>
                </div>
                <button 
                  onClick={() => { setShowMenu(false); openNodeSettings(); }}
                  className="text-xs font-black uppercase tracking-[0.2em] text-blue-600 hover:text-blue-500 transition-colors"
                >
                  Manage
                </button>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">
                These relays are used whenever the Sidecar publishes NCC-02/NCC-05 updates or services push profile and locator data.
              </p>
              {publicationRelays.length ? (
                <ul className="space-y-2 text-[12px] text-slate-700 max-h-40 overflow-y-auto">
                  {publicationRelays.map(relay => (
                    <li key={relay} className="flex items-center justify-between gap-3 bg-slate-50 rounded-2xl border border-slate-100 px-4 py-2 truncate">
                      <span className="truncate">{relay}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-[12px] text-slate-500">
                  No publication relays configured yet.
                </div>
              )}
            </section>
          )}

          <header className="flex flex-col md:flex-row md:items-end justify-between mb-12 gap-6">
            <div>
              <h2 className="text-3xl font-black tracking-tight text-slate-900">Managed Services</h2>
              <p className="text-slate-500 font-medium mt-1">Active discovery profiles for hosted applications.</p>
            </div>
            <Motion.button 
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setShowNewServiceModal(true)}
              className="bg-blue-600 text-white px-8 py-4 rounded-2xl font-bold flex items-center shadow-xl shadow-blue-600/20 hover:bg-blue-700 transition-all"
            >
              <Plus className="w-5 h-5 mr-2" /> NEW SERVICE PROFILE
            </Motion.button>
          </header>

          <AnimatePresence>
            {showNewServiceModal && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
                <Motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={handleCloseModal}
                  className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
                />
                <Motion.div 
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
                    {newService.type !== 'sidecar' && (
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
                    )}

                    {newService.type !== 'sidecar' && (
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
                    )}

                    {newService.type !== 'sidecar' && newService.config.service_mode === 'private' && (
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Locator Recipients</label>
                        <textarea
                          rows={4}
                          value={recipientInput}
                          onChange={(e) => handleRecipientInputChange(e.target.value)}
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
                          type={showServiceNsec ? 'text' : 'password'} placeholder="nsec1..." 
                          className="flex-1 bg-slate-50 border border-slate-100 rounded-2xl p-5 text-xs font-mono outline-none focus:border-blue-500/50 transition-colors"
                          value={newService.service_nsec}
                          onChange={(e) => setNewService(d => ({ ...d, service_nsec: e.target.value }))}
                        />
                        {newService.service_nsec && (
                          <>
                            <button 
                              type="button"
                              onClick={() => copyToClipboard(newService.service_nsec, 'nsec')}
                              className="bg-slate-100 text-slate-600 p-5 rounded-2xl hover:bg-slate-200 transition-all"
                            >
                              {copiedMap['nsec'] ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                              <span className="sr-only">Copy NSEC</span>
                            </button>
                            <button 
                              type="button"
                              onClick={() => setShowServiceNsec(prev => !prev)}
                              className="bg-slate-100 text-slate-600 p-5 rounded-2xl hover:bg-slate-200 transition-all"
                            >
                              {showServiceNsec ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              <span className="sr-only">{showServiceNsec ? 'Hide NSEC' : 'Show NSEC'}</span>
                            </button>
                          </>
                        )}
                        <button 
                          type="button"
                          onClick={async () => {
                            const res = await axios.get(`${API_BASE}/service/generate-key`);
                            setNewService(d => ({ ...d, service_nsec: res.data.nsec }));
                          }}
                          className="bg-slate-900 text-white p-5 rounded-2xl hover:bg-slate-800 transition-all"
                        >
                          <RefreshCw className="w-4 h-4" />
                          <span className="sr-only">Generate new NSEC</span>
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Service Port</label>
                        <input 
                          type="number" placeholder="e.g. 80" 
                          className={`w-full bg-slate-50 border rounded-2xl p-5 text-sm font-bold outline-none transition-colors ${portIsValid ? 'border-slate-100 focus:border-blue-500/50' : 'border-rose-200 ring-1 ring-rose-200 focus:border-rose-400'}`}
                          value={newService.config.port ?? ''}
                          onChange={(e) => handlePortInputChange(e.target.value)}
                        />
                        {!portIsValid && (
                          <p className="text-[9px] text-rose-500 italic mt-1">
                            Services must use a dedicated backend port so their onion address doesn’t fall back into the Sidecar UI.
                          </p>
                        )}
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

                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Onion Address</label>
                        <div className="flex space-x-2">
                          <input
                            type="text"
                            readOnly
                            value={onionAddressValue}
                            placeholder="Onion address appears after the first publish"
                            className="flex-1 bg-slate-50 border border-slate-100 rounded-2xl p-5 text-xs font-mono text-slate-600 outline-none focus:border-blue-500/50 transition-colors"
                          />
                          <button
                            type="button"
                            disabled={!onionAddressValue}
                            onClick={() => copyToClipboard(onionAddressValue, 'onion')}
                            className="bg-slate-100 text-slate-600 p-5 rounded-2xl hover:bg-slate-200 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Copy className="w-4 h-4" />
                            <span className="sr-only">Copy onion address</span>
                          </button>
                          <button
                            type="button"
                            disabled={!canRotateOnion}
                            onClick={handleRotateOnion}
                            className="bg-slate-100 text-slate-600 p-5 rounded-2xl hover:bg-slate-200 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <RefreshCw className="w-4 h-4" />
                            <span className="sr-only">Rotate onion address</span>
                          </button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">TLS Fingerprint</label>
                        <div className="flex space-x-2">
                          <input
                            type="text"
                            readOnly
                            value={tlsFingerprintValue}
                            placeholder="TLS fingerprint appears after cert generation"
                            className="flex-1 bg-slate-50 border border-slate-100 rounded-2xl p-5 text-xs font-mono text-slate-600 outline-none focus:border-blue-500/50 transition-colors"
                          />
                          <button
                            type="button"
                            disabled={!tlsFingerprintValue}
                            onClick={() => copyToClipboard(tlsFingerprintValue, `fingerprint-${editServiceId || 'new'}`)}
                            className="bg-slate-100 text-slate-600 p-5 rounded-2xl hover:bg-slate-200 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Copy className="w-4 h-4" />
                            <span className="sr-only">Copy TLS fingerprint</span>
                          </button>
                          <button
                            type="button"
                            onClick={handleRegenerateTls}
                            disabled={newService.config?.generate_self_signed === false || regeneratingTlsServiceId === editServiceId}
                            className="bg-slate-100 text-slate-600 p-5 rounded-2xl hover:bg-slate-200 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center"
                          >
                            <RefreshCw className={`w-4 h-4 ${regeneratingTlsServiceId === editServiceId ? 'animate-spin' : ''}`} />
                            <span className="sr-only">Regenerate TLS cert</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    <button 
                      onClick={handleSaveService}
                      disabled={!canSaveService}
                      className="w-full bg-blue-600 disabled:opacity-50 text-white font-black py-5 rounded-3xl shadow-xl shadow-blue-600/20 hover:bg-blue-700 transition-all"
                    >
                      {editServiceId ? 'UPDATE PROFILE' : 'ADD DISCOVERY PROFILE'}
                    </button>
                  </div>
                </Motion.div>
              </div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {showRelaysModal && (
              <div className="fixed inset-0 z-[110] flex items-center justify-center p-6">
                <Motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setShowRelaysModal(false)}
                  className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
                />
                <Motion.div 
                  initial={{ opacity: 0, scale: 0.9, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 20 }}
                  className="relative bg-white rounded-[2.5rem] shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200"
                >
                  <div className="bg-slate-900 p-6 text-white flex justify-between items-center">
                    <h2 className="text-2xl font-black tracking-tight">Publishing Relays</h2>
                    <button onClick={() => setShowRelaysModal(false)} className="text-slate-400 hover:text-white transition-colors">
                      <Plus className="w-6 h-6 rotate-45" />
                    </button>
                  </div>
                  <div className="p-6 space-y-4">
                    <p className="text-sm text-slate-500">
                      Specify the relay URLs the Sidecar uses when publishing NCC-02/NCC-05 and when services push profile updates.
                    </p>
                    <textarea
                      value={relayModalInput}
                      onChange={(e) => setRelayModalInput(e.target.value)}
                      rows={6}
                      className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 text-xs font-mono outline-none focus:border-blue-500/50 transition-colors"
                      placeholder="wss://nostr-pub.wellorder.net\nwss://relay.damus.io"
                    />
                    <div className="flex justify-between items-center text-[10px] text-slate-400">
                      <span>One URL per line or comma separated.</span>
                      <span>{normalizeRelayInput(relayModalInput).length} saved</span>
                    </div>
                    <button 
                      onClick={handleSaveRelays}
                      className="w-full bg-blue-600 text-white font-bold py-3 rounded-2xl shadow-lg shadow-blue-600/20 hover:bg-blue-700 transition-all"
                    >
                      Save Relays
                    </button>
                  </div>
                </Motion.div>
              </div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {showNodeSettingsModal && (
              <div className="fixed inset-0 z-[115] flex items-center justify-center p-6">
                <Motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setShowNodeSettingsModal(false)}
                  className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
                />
                <Motion.div 
                  initial={{ opacity: 0, scale: 0.9, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 20 }}
                  className="relative bg-white rounded-[2.5rem] shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200 max-h-[90vh]"
                >
                  <div className="bg-slate-900 p-6 text-white flex justify-between items-center">
                    <h2 className="text-2xl font-black tracking-tight">Node Settings</h2>
                    <button onClick={() => setShowNodeSettingsModal(false)} className="text-slate-400 hover:text-white transition-colors">
                      <Plus className="w-6 h-6 rotate-45" />
                    </button>
                  </div>
                  <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(90vh-96px)]">
                    <div className="rounded-2xl border border-slate-100 p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm font-bold text-slate-700">Allow remote admin access</p>
                          <p className="text-[11px] text-slate-400 leading-relaxed max-w-xs">
                            Toggle whether the Sidecar accepts API requests from non-local hosts while the guard is in effect.
                          </p>
                        </div>
                        <button
                          onClick={() => toggleNodeSection('remote')}
                          className="p-2 rounded-full bg-slate-100 border border-slate-200 text-slate-500 hover:text-slate-700 transition-colors"
                          aria-expanded={nodeSectionOpen.remote}
                        >
                          <ChevronRight className={`w-3 h-3 transition-transform ${nodeSectionOpen.remote ? 'rotate-90' : ''}`} />
                        </button>
                      </div>
                      <div className={`${nodeSectionOpen.remote ? 'mt-4' : 'hidden'} space-y-2 pt-2`}>
                        <button
                          onClick={handleToggleAllowRemote}
                          disabled={allowRemoteLoading}
                          className={`px-4 py-2 rounded-2xl font-bold uppercase tracking-widest transition-colors ${allowRemoteEnabled ? 'bg-green-500 text-white' : 'bg-slate-200 text-slate-600'} ${allowRemoteLoading ? 'opacity-60 cursor-not-allowed' : 'hover:bg-opacity-90'}`}
                        >
                          {allowRemoteLoading ? 'Updating...' : (allowRemoteEnabled ? 'Enabled' : 'Local only')}
                        </button>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-100 p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm font-bold uppercase tracking-widest text-slate-500">Publication relays</p>
                          <p className="text-[11px] text-slate-400">
                            These relays are used when the Sidecar publishes NCC-02/NCC-05 updates or services push profile changes.
                          </p>
                        </div>
                        <button
                          onClick={() => toggleNodeSection('publicationRelays')}
                          className="p-2 rounded-full bg-slate-100 border border-slate-200 text-slate-500 hover:text-slate-700 transition-colors"
                          aria-expanded={nodeSectionOpen.publicationRelays}
                        >
                          <ChevronRight className={`w-3 h-3 transition-transform ${nodeSectionOpen.publicationRelays ? 'rotate-90' : ''}`} />
                        </button>
                      </div>
                      <div className={`${nodeSectionOpen.publicationRelays ? 'mt-3 space-y-3' : 'hidden'}`}>
                        <p className="text-[11px] text-slate-400 flex justify-between">
                          <span>{publicationRelays.length} configured</span>
                        </p>
                        {publicationRelays.length ? (
                          <div className="max-h-48 overflow-y-auto rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600 space-y-1">
                            {publicationRelays.map(relay => (
                              <p key={relay} className="truncate">{relay}</p>
                            ))}
                          </div>
                        ) : (
                          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-400 text-center">
                            No publication relays configured yet.
                          </div>
                        )}
                        <button 
                          onClick={() => { setShowNodeSettingsModal(false); openRelaySettings(); }}
                          className="w-full bg-blue-600 text-white font-bold py-3 rounded-2xl shadow-lg shadow-blue-600/20 hover:bg-blue-700 transition-all"
                        >
                          Manage relays
                        </button>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-100 p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm font-bold text-slate-700">Available endpoints</p>
                          <p className="text-[11px] text-slate-400 leading-relaxed max-w-xs">
                            Control which endpoint families the Sidecar advertises on NCC-02 publications. Only enabled protocols appear on clients’ discovery results.
                          </p>
                        </div>
                        <button
                          onClick={() => toggleNodeSection('protocols')}
                          className="p-2 rounded-full bg-slate-100 border border-slate-200 text-slate-500 hover:text-slate-700 transition-colors"
                          aria-expanded={nodeSectionOpen.protocols}
                        >
                          <ChevronRight className={`w-3 h-3 transition-transform ${nodeSectionOpen.protocols ? 'rotate-90' : ''}`} />
                        </button>
                      </div>
                      <div className={`${nodeSectionOpen.protocols ? 'mt-4 space-y-4' : 'hidden'}`}>
                        <div className="flex space-x-2">
                          {['ipv4', 'ipv6', 'tor'].map(p => {
                            const isAvailable = networkAvailability[p];
                            const isEnabled = Boolean(protocolConfig[p]);
                            const isLoading = protocolLoading === p;
                            return (
                              <button
                                key={p}
                                type="button"
                                onClick={() => handleToggleProtocol(p)}
                                disabled={!isAvailable || isLoading}
                                className={`flex-1 py-3 rounded-xl border flex items-center justify-center space-x-2 transition-all ${
                                  !isAvailable ? 'bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed' :
                                  isEnabled ? 'bg-blue-50 border-blue-200 text-blue-600 shadow-sm' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                                } ${isLoading ? 'opacity-70 cursor-wait' : ''}`}
                              >
                                <div className={`w-2 h-2 rounded-full ${!isAvailable ? 'bg-slate-300' : isEnabled ? 'bg-blue-500' : 'bg-slate-200'}`} />
                                <span className="text-xs font-bold uppercase">{p}</span>
                              </button>
                            );
                          })}
                        </div>
                        <p className="text-[10px] text-slate-400 italic">
                          Disabled protocols are skipped during NCC-02 publishes. Enabling them permits the sidecar to advertise the matching endpoint families again.
                        </p>
                        <div className="space-y-2 pt-2">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Visibility mode</p>
                          <div className="flex space-x-2">
                            {['public', 'private'].map(mode => {
                              const isActive = serviceMode === mode;
                              const isLoadingMode = serviceModeLoading === mode;
                              const disabled = isLoadingMode || (serviceModeLoading && serviceModeLoading !== mode);
                              return (
                                <button
                                  key={mode}
                                  type="button"
                                  onClick={() => handleSetServiceMode(mode)}
                                  disabled={disabled}
                                  className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${
                                    isActive ? 'bg-slate-900 text-white shadow-lg shadow-slate-900/20' : 'bg-white border border-slate-200 text-slate-500 hover:border-slate-300'
                                  } ${isLoadingMode ? 'opacity-80 cursor-wait' : ''}`}
                                >
                                  {isLoadingMode ? 'Saving…' : (mode === 'public' ? 'Public' : 'Private')}
                                </button>
                              );
                            })}
                          </div>
                          <p className="text-[10px] text-slate-400 italic">
                            Public mode advertises the Sidecar endpoints directly; private mode omits them from NCC-02 so clients rely on encrypted NCC-05 locators instead.
                          </p>
                        </div>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Sidecar settings are stored in `app_config` and apply globally across every service. Service-specific profiles remain unchanged.
                    </p>
                    <div className="rounded-2xl border border-slate-100 p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-[12px] font-black uppercase tracking-[0.3em] text-slate-600">Identity controls</p>
                          <p className="text-[11px] text-slate-500">
                            Rotate the management identity, Tor onion address, or TLS certificate using the same controls exposed on the service editor.
                          </p>
                        </div>
                        <button
                          onClick={() => toggleNodeSection('identity')}
                          className="p-2 rounded-full bg-slate-100 border border-slate-200 text-slate-500 hover:text-slate-700 transition-colors"
                          aria-expanded={nodeSectionOpen.identity}
                        >
                          <ChevronRight className={`w-3 h-3 transition-transform ${nodeSectionOpen.identity ? 'rotate-90' : ''}`} />
                        </button>
                      </div>
                      <div className={`${nodeSectionOpen.identity ? 'mt-4 space-y-3' : 'hidden'}`}>
                        <button
                          onClick={handleNodeGenerateIdentity}
                          disabled={isRotatingIdentity}
                          className="w-full bg-slate-900 text-white py-3 rounded-2xl font-bold uppercase tracking-[0.3em] shadow-lg shadow-slate-900/30 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {isRotatingIdentity ? 'Regenerating identity…' : 'Regenerate management key'}
                        </button>
                        <button
                          onClick={handleNodeRotateOnion}
                          disabled={isRotatingOnion}
                          className="w-full bg-slate-50 border border-slate-200 py-3 rounded-2xl font-bold uppercase tracking-[0.3em] text-slate-600 hover:border-slate-300 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {isRotatingOnion ? 'Rotating onion…' : 'Rotate onion address'}
                        </button>
                        <button
                          onClick={handleNodeRegenerateTls}
                          disabled={!sidecarCanRegenerateTls || isNodeTlsRegenerating}
                          className="w-full bg-slate-50 border border-slate-200 py-3 rounded-2xl font-bold uppercase tracking-[0.3em] text-slate-600 hover:border-slate-300 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {isNodeTlsRegenerating ? 'Regenerating TLS…' : 'Regenerate TLS certificate'}
                        </button>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-100 p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm font-black text-slate-700 uppercase tracking-tight">Database Management</p>
                          <p className="text-[11px] text-slate-400 max-w-sm">
                            Export, import, or reset the embedded SQLite database used by the Sidecar.
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] uppercase tracking-[0.4em] text-slate-400">
                            {dbInfo?.passwordProtected ? 'Passworded' : 'Unprotected'}
                          </span>
                          <button
                            onClick={() => toggleNodeSection('database')}
                            className="p-2 rounded-full bg-slate-100 border border-slate-200 text-slate-500 hover:text-slate-700 transition-colors"
                            aria-expanded={nodeSectionOpen.database}
                          >
                            <ChevronRight className={`w-3 h-3 transition-transform ${nodeSectionOpen.database ? 'rotate-90' : ''}`} />
                          </button>
                        </div>
                      </div>
                      <div className={`${nodeSectionOpen.database ? 'mt-4 space-y-4' : 'hidden'}`}>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px] text-slate-500">
                          <div>
                            <p className="text-[9px] uppercase tracking-[0.4em] text-slate-400">File</p>
                            <p className="font-mono truncate">{dbInfo?.path || 'Loading...'}</p>
                          </div>
                          <div>
                            <p className="text-[9px] uppercase tracking-[0.4em] text-slate-400">Size</p>
                            <p>{formatBytes(dbInfo?.size)}</p>
                          </div>
                          <div>
                            <p className="text-[9px] uppercase tracking-[0.4em] text-slate-400">Modified</p>
                            <p>{dbInfo ? formatDateTimeWithZone(dbInfo.modifiedAt) : 'Loading...'}</p>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <p className="text-[10px] uppercase tracking-[0.4em] text-slate-500">Database password</p>
                          <div className="grid md:grid-cols-2 gap-3">
                            <input
                              type="password"
                              placeholder="Current password"
                              value={dbCurrentPassword}
                              onChange={(e) => setDbCurrentPassword(e.target.value)}
                              className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-3 text-xs font-mono outline-none focus:border-blue-500/50 transition-colors"
                            />
                            <input
                              type="password"
                              placeholder="New password (leave blank to clear)"
                              value={dbNewPassword}
                              onChange={(e) => setDbNewPassword(e.target.value)}
                              className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-3 text-xs font-mono outline-none focus:border-blue-500/50 transition-colors"
                            />
                          </div>
                          <button
                            onClick={handleSetDbPassword}
                            disabled={dbPasswordLoading}
                            className="w-full bg-slate-900 text-white font-bold py-3 rounded-2xl shadow-lg shadow-slate-900/30 hover:bg-slate-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {dbPasswordLoading ? 'Updating…' : 'Update password'}
                          </button>
                        </div>
                        <div className="space-y-3">
                          <p className="text-[10px] uppercase tracking-[0.4em] text-slate-500">Export / Import</p>
                          <div className="space-y-2">
                            <div className="space-y-3">
                              <div className="flex flex-col gap-3 md:flex-row items-center">
                                <div className="flex-1 space-y-1">
                                  <p className="text-[9px] uppercase tracking-[0.3em] text-slate-400">Export password</p>
                                  <input
                                    type="password"
                                    placeholder="Password for export (if set)"
                                    value={dbExportPassword}
                                    onChange={(e) => setDbExportPassword(e.target.value)}
                                    className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-3 text-xs font-mono outline-none focus:border-blue-500/50 transition-colors"
                                  />
                                </div>
                                <button
                                  onClick={handleExportDb}
                                  disabled={dbExporting}
                                  className="bg-blue-600 text-white px-4 py-3 rounded-2xl font-bold text-[10px] uppercase tracking-[0.3em] shadow-lg shadow-blue-600/20 hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                  {dbExporting ? 'Exporting…' : 'Export database'}
                                </button>
                              </div>
                              <div className="flex flex-col gap-3 md:flex-row items-center">
                                <div className="flex-1 space-y-1">
                                  <p className="text-[9px] uppercase tracking-[0.3em] text-slate-400">Import password</p>
                                  <input
                                    type="password"
                                    placeholder="Password for import (if set)"
                                    value={dbImportPassword}
                                    onChange={(e) => setDbImportPassword(e.target.value)}
                                    className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-3 text-xs font-mono outline-none focus:border-blue-500/50 transition-colors"
                                  />
                                </div>
                                <label className="flex-1 bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3 text-[11px] text-slate-500 font-mono cursor-pointer text-left">
                                  {dbImportName || 'Select .db recovery file'}
                                  <input type="file" accept=".db" className="hidden" onChange={handleDbImportFileChange} />
                                </label>
                                <button
                                  onClick={handleImportDb}
                                  disabled={dbImporting}
                                  className="bg-emerald-600 text-white px-4 py-3 rounded-2xl font-bold text-[10px] uppercase tracking-[0.3em] shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                  {dbImporting ? 'Importing…' : 'Import database'}
                                </button>
                              </div>
                              <p className="text-[10px] text-slate-400 italic">
                                Importing replaces the current database and keeps a backup copy.
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <p className="text-[10px] uppercase tracking-[0.4em] text-slate-500">Reset database</p>
                          <div className="flex flex-col gap-3">
                            <input
                              type="password"
                              placeholder="Password for reset (if set)"
                              value={dbWipePassword}
                              onChange={(e) => setDbWipePassword(e.target.value)}
                              className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-3 text-xs font-mono outline-none focus:border-blue-500/50 transition-colors"
                            />
                            <button
                              onClick={handleWipeDb}
                              disabled={dbWiping}
                              className="w-full bg-rose-500 text-white font-bold py-3 rounded-2xl shadow-lg shadow-rose-500/30 hover:bg-rose-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              {dbWiping ? 'Resetting…' : 'Wipe database'}
                            </button>
                          </div>
                          <p className="text-[10px] text-slate-400 italic">
                            Clears all services, logs, and admins. You will need to reconfigure the Sidecar afterward.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </Motion.div>
              </div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {showSidecarProfileModal && (
              <div className="fixed inset-0 z-[115] flex items-center justify-center p-6">
                <Motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setShowSidecarProfileModal(false)}
                  className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
                />
                <Motion.div 
                  initial={{ opacity: 0, scale: 0.95, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 20 }}
                  className="relative bg-white rounded-[2.5rem] shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200"
                >
                  <div className="bg-slate-900 p-6 text-white flex justify-between items-center">
                    <h2 className="text-2xl font-black tracking-tight">Sidecar Profile</h2>
                    <button onClick={() => setShowSidecarProfileModal(false)} className="text-slate-400 hover:text-white transition-colors">
                      <Plus className="w-6 h-6 rotate-45" />
                    </button>
                  </div>
                  <div className="p-8 space-y-5">
                    <p className="text-sm text-slate-500">
                      These fields populate the Sidecar’s Nostr profile metadata (kind 0) and appear whenever clients inspect the management identity.
                    </p>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-500">Profile name</label>
                        <input
                          type="text"
                          value={sidecarProfileDraft.name}
                          onChange={(e) => handleSidecarProfileChange('name', e.target.value)}
                          className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 text-sm font-bold outline-none focus:border-blue-500/50 transition-colors"
                          placeholder="machine-readable name"
                        />
                        <p className="text-[10px] text-slate-400 italic">
                          Lowercase, underscore-friendly identifier used in your Sidecar’s profile name tag.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-500">Display name</label>
                        <input
                          type="text"
                          value={sidecarProfileDraft.display_name}
                          onChange={(e) => handleSidecarProfileChange('display_name', e.target.value)}
                          className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 text-sm font-bold outline-none focus:border-blue-500/50 transition-colors"
                          placeholder="Human-friendly label"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-500">About / bio</label>
                        <textarea
                          rows={3}
                          value={sidecarProfileDraft.about}
                          onChange={(e) => handleSidecarProfileChange('about', e.target.value)}
                          className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 text-xs font-medium outline-none focus:border-blue-500/50 transition-colors resize-none"
                          placeholder="Describe the Sidecar purpose or characteristics"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-500">Picture</label>
                        <input
                          type="url"
                          value={sidecarProfileDraft.picture}
                          onChange={(e) => handleSidecarProfileChange('picture', e.target.value)}
                          className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 text-xs font-medium outline-none focus:border-blue-500/50 transition-colors"
                          placeholder="https://example.com/avatar.png"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-500">NIP-05</label>
                        <input
                          type="text"
                          value={sidecarProfileDraft.nip05}
                          onChange={(e) => handleSidecarProfileChange('nip05', e.target.value)}
                          className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 text-xs font-medium outline-none focus:border-blue-500/50 transition-colors"
                          placeholder="user@example.com"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-3">
                      <button
                        onClick={() => setShowSidecarProfileModal(false)}
                        className="px-5 py-3 rounded-2xl border border-slate-200 text-[10px] font-black uppercase tracking-[0.3em] text-slate-600 hover:border-slate-300 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveSidecarProfile}
                        disabled={isSavingSidecarProfile}
                        className="px-5 py-3 rounded-2xl bg-blue-600 text-white text-[10px] font-black uppercase tracking-[0.3em] shadow-lg shadow-blue-600/20 hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {isSavingSidecarProfile ? 'Saving…' : 'Save profile'}
                      </button>
                    </div>
                  </div>
                </Motion.div>
              </div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {showAdminModal && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
                <Motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setShowAdminModal(false)}
                  className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
                />
                <Motion.div 
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
                </Motion.div>
              </div>
            )}
          </AnimatePresence>



          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <AnimatePresence>
              {managedServices.map((s, i) => {
                const inventoryMeta = getServiceInventoryMeta(s);
                const serviceNpub = s.service_nsec ? nip19.npubEncode(getPublicKey(fromNsecLocal(s.service_nsec))) : null;
                const showTorBadge = s.config?.protocols?.tor && !s.state?.last_inventory?.some(e => e.family === 'onion');
                const torRunning = Boolean(s.state?.tor_status?.running);
                return (
                  <Motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.1 }}
                    key={s.id} 
                    className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-200 hover:shadow-2xl hover:border-slate-300 transition-all group relative overflow-hidden"
                  >
                    <ServiceCardContent
                      service={s}
                      inventoryMeta={inventoryMeta}
                      serviceNpub={serviceNpub}
                      showTorBadge={showTorBadge}
                      torRunning={torRunning}
                      copyToClipboard={copyToClipboard}
                      onEdit={() => handleEditService(s)}
                      copiedMap={copiedMap}
                    />
                    <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleDeleteService(s.id); }}
                        className="p-2 text-slate-300 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </Motion.div>
                );
              })}
            </AnimatePresence>
          </div>

          <section className="mt-20">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-3">
                <Terminal className="w-5 h-5 text-slate-400" />
                <h2 className="text-xl font-black text-slate-900 tracking-tight">System Logs</h2>
              </div>
              <div className="flex items-center space-x-3">
                <button
                  onClick={fetchServices}
                  disabled={loadingLogs}
                  className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 hover:text-blue-600 transition-colors disabled:opacity-50 disabled:cursor-wait flex items-center gap-2"
                >
                  <Activity className={`w-3 h-3 ${loadingLogs ? 'animate-spin text-blue-600' : ''}`} />
                  {loadingLogs ? 'Refreshing…' : 'Refresh Logs'}
                </button>
                <button
                  onClick={handleRepublish}
                  disabled={isRepublishing}
                  className="text-[10px] font-black uppercase tracking-[0.3em] px-3 py-2 rounded-full border border-slate-200 hover:border-blue-300 transition-colors disabled:opacity-50 disabled:cursor-wait"
                >
                  {isRepublishing ? 'Republishing…' : 'Republish All'}
                </button>
              </div>
            </div>
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden font-mono text-[10px]">
            <div className="max-h-60 overflow-y-auto p-6 space-y-2">
              {logs.length > 0 ? (
                logs.map((log, i) => {
                  const isActive = selectedLog && selectedLog.id === log.id;
                  return (
                    <div
                      key={log.id || i}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleLogClick(log)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleLogClick(log);
                        }
                      }}
                      className={`flex space-x-4 border-b border-slate-50 pb-2 last:border-0 cursor-pointer ${isActive ? 'bg-slate-50' : 'hover:bg-slate-50'}`}
                    >
                      <span className="text-slate-400 shrink-0">{formatTimeWithZone(log.timestamp)}</span>
                      <span className={`font-bold shrink-0 ${log.level === 'error' ? 'text-red-500' : 'text-blue-500'}`}>{log.level.toUpperCase()}</span>
                      <span className="text-slate-600">{log.message}</span>
                    </div>
                  );
                })
              ) : (
                <p className="text-slate-400 italic">No system logs available yet.</p>
              )}
            </div>
            {selectedLog && (
                <div className="border-t border-slate-200 bg-slate-50 px-6 py-4 text-[11px] space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-[9px] uppercase tracking-[0.4em] text-slate-500">Log Details</p>
                      <p className="text-slate-800 text-sm font-semibold">{selectedLog.message}</p>
                    </div>
                    <button
                      onClick={() => setSelectedLog(null)}
                      className="text-[10px] uppercase tracking-[0.5em] text-slate-400 hover:text-slate-600"
                    >
                      Close
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-[10px] text-slate-500">
                    <div>
                      <p className="font-bold text-slate-900 text-xs">{selectedLog.level.toUpperCase()}</p>
                      <p className="text-[9px] uppercase tracking-[0.3em] text-slate-500">Level</p>
                    </div>
                    <div>
                      <p className="font-bold text-slate-900 text-xs">{formatDateTimeWithZone(selectedLog.timestamp)}</p>
                      <p className="text-[9px] uppercase tracking-[0.3em] text-slate-500">Timestamp</p>
                    </div>
                    {selectedLogMetadata?.serviceId && (
                      <div>
                        <p className="font-bold text-slate-900 text-xs">{selectedLogMetadata.serviceId}</p>
                        <p className="text-[9px] uppercase tracking-[0.3em] text-slate-500">Service</p>
                      </div>
                    )}
                  </div>
                  {(selectedLogMetadata?.ncc02 || selectedLogMetadata?.ncc05 || selectedLogMetadata?.kind0) && (
                    <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
                      {['ncc02','ncc05','kind0'].map(key => {
                        const value = selectedLogMetadata?.[key];
                        if (!value) return null;
                        return (
                          <button
                            key={key}
                            onClick={() => copyToClipboard(value, `log-${key}-${selectedLog.id}`)}
                            className="px-3 py-1 bg-white border border-slate-200 rounded-full text-[10px] text-slate-600 hover:border-blue-300 hover:text-blue-600 transition-colors"
                          >
                            {key.toUpperCase()}: {formatLogId(value)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="bg-white border border-slate-200 rounded-2xl p-3 overflow-x-auto">
                    <pre className="text-[10px] whitespace-pre-wrap break-words">{selectedLogMetadata ? JSON.stringify(selectedLogMetadata, null, 2) : 'No metadata.'}</pre>
                  </div>
                </div>
            )}
          </div>
        </section>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6 font-sans">
      <Motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-xl w-full"
      >
        <div className="bg-slate-900 rounded-[3rem] shadow-2xl border border-white/5 overflow-hidden">
          <div className="h-2 bg-slate-800 w-full overflow-hidden">
            <Motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${(step / 3) * 100}%` }}
              className="h-full bg-gradient-to-r from-blue-600 to-indigo-500"
            />
          </div>

          <div className="p-12">
            <AnimatePresence mode="wait">
              {step === 1 && (
                <Motion.div 
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
                        
                        {/* Connection Logs */}
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
                            <button onClick={handleForceConnection} className="w-full mt-3 bg-slate-800 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest border border-blue-500/30 text-blue-400">Force Connection</button>
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
                          } catch (_err) {
                            console.warn("Invalid local key:", _err);
                            alert("Invalid Key");
                          }
                        }} className="w-full bg-white text-slate-900 font-black py-5 rounded-3xl shadow-xl hover:bg-slate-100 transition-all">{initialized ? 'CONNECT' : 'START PROVISIONING'}</button>
                      </div>
                      <button onClick={() => setLoginMode('choice')} className="text-slate-500 font-bold text-xs uppercase tracking-widest hover:text-white transition-colors text-center">Return to Safety</button>
                    </div>
                  )}
                </Motion.div>
              )}

              {step === 2 && (
                <Motion.div 
                  key="step2"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="space-y-10"
                >
                  <div className="space-y-2 text-center">
                    <Motion.div 
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 4, ease: "linear" }}
                      className="w-24 h-24 bg-gradient-to-tr from-blue-600 to-indigo-500 rounded-[2.5rem] flex items-center justify-center mx-auto shadow-2xl shadow-blue-500/20 mb-8"
                    >
                      <RefreshCw className="w-10 h-10 text-white" />
                    </Motion.div>
                    <h1 className="text-3xl font-black tracking-tight">Provisioning Node</h1>
                    <p className="text-slate-400 font-medium italic">Automating secure identity and network discovery...</p>
                  </div>

                  <div className="space-y-6">
                    <div className="h-3 bg-slate-800 rounded-full overflow-hidden border border-white/5">
                      <Motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${provisioningProgress}%` }}
                        className="h-full bg-gradient-to-r from-blue-600 to-indigo-400"
                      />
                    </div>

                    <div className="bg-slate-950/50 rounded-3xl p-6 border border-white/5 font-mono text-[10px] space-y-2 h-40 overflow-y-auto">
                      {provisioningLogs.map((log, i) => (
                        <Motion.div 
                          initial={{ opacity: 0, x: -5 }}
                          animate={{ opacity: 1, x: 0 }}
                          key={i} 
                          className="flex items-center space-x-2"
                        >
                          <span className="text-blue-500 font-black">›</span>
                          <span className="text-slate-300">{log}</span>
                          {i === provisioningLogs.length - 1 && i < 5 && <span className="w-1 h-3 bg-blue-500 animate-pulse" />}
                          {i < provisioningLogs.length - 1 && <Check className="w-3 h-3 text-green-500 ml-auto" />}
                        </Motion.div>
                      ))}
                    </div>
                  </div>
                </Motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
        
        <p className="text-center mt-8 text-slate-600 text-[10px] font-black uppercase tracking-[0.3em] opacity-50">
          Identity Discovery Node • v1.0.0
        </p>
      </Motion.div>
    </div>
  );
}

function ServiceCardContent({
  service,
  inventoryMeta,
  serviceNpub,
  showTorBadge,
  torRunning,
  copyToClipboard,
  onEdit,
  copiedMap
}) {
  const { displayInventory, hasHiddenOnion, tlsFingerprint } = inventoryMeta;
  const lastUpdateText = service.state?.last_full_publish_timestamp
    ? formatTimeWithZone(service.state.last_full_publish_timestamp)
    : 'Pending';
  const publicIdentity = serviceNpub ? `${serviceNpub.slice(0, 20)}...` : null;
  const showIdentity = Boolean(serviceNpub);
  const displayProfileName = service.config?.profile?.display_name;

  return (
    <>
      <div className="flex justify-between items-start mb-8 relative z-10">
        <div className="w-14 h-14 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-900 border border-slate-100 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
          <Box className="w-7 h-7" />
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{service.type}</span>
          <div className="flex items-center space-x-1">
            <Motion.div 
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ repeat: Infinity, duration: 2 }}
              className="w-2 h-2 bg-green-500 rounded-full" 
            />
            <span className="text-[10px] font-bold text-green-600 uppercase">Active</span>
          </div>
        </div>
      </div>

        <div className="mb-8 relative z-10 cursor-pointer hover:opacity-70 transition-opacity" onClick={onEdit}>
          <h3 className="text-xl font-black text-slate-900 leading-tight mb-1">{service.name}</h3>
          {displayProfileName && (
            <p className="text-xs text-slate-500 font-semibold tracking-tight leading-snug break-words max-w-full">
              {displayProfileName}
            </p>
          )}
          <p className="text-xs font-mono text-slate-400 break-words">{service.service_id}</p>
        </div>

      <div className="space-y-4 relative z-10">
        <div className="space-y-2">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Public Identity</div>
          {showIdentity ? (
            <div className="flex items-center space-x-2 text-slate-500 font-mono text-xs">
              <span>{publicIdentity}</span>
              <button onClick={(e) => { e.stopPropagation(); copyToClipboard(serviceNpub, `npub-${service.id}`); }} className="hover:text-blue-500 transition-colors">
                {copiedMap[`npub-${service.id}`] ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
          ) : (
            <p className="text-[10px] text-slate-400 italic">Identity pending</p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Endpoints</span>
            {showTorBadge && (
              <div className={`flex items-center space-x-1 px-1.5 py-0.5 rounded border ${torRunning ? 'border-yellow-500/50 bg-yellow-50 text-yellow-600' : 'border-red-500/50 bg-red-50 text-red-500'}`} title={torRunning ? "Tor running but no Onion Service configured" : "Tor not detected"}>
                <div className={`w-1 h-1 rounded-full ${torRunning ? 'bg-yellow-500' : 'bg-red-500 animate-pulse'}`} />
                <span className="text-[8px] font-bold uppercase">TOR</span>
              </div>
            )}
          </div>

          {displayInventory.length > 0 ? (
            <div className="space-y-1.5">
              {displayInventory.map((ep, idx) => (
                <div key={`${ep.url}-${idx}`} className="space-y-1.5">
                  <div className="flex items-center justify-between bg-slate-50 px-2 py-1.5 rounded-lg border border-slate-100 text-[10px] font-mono text-slate-600">
                    <div className="flex items-center space-x-2 truncate">
                      <div className={`w-1.5 h-1.5 rounded-full ${ep.family === 'onion' ? 'bg-purple-500' : 'bg-blue-500'}`} />
                      <span className="truncate max-w-[180px]">{formatEndpointLabel(ep.url)}</span>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); copyToClipboard(ep.url, `ep-${service.id}-${idx}`); }} className="ml-2 hover:text-blue-500 transition-colors shrink-0">
                      {copiedMap[`ep-${service.id}-${idx}`] ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-slate-400 italic">
              {service.state?.is_probing ? 'Probing...' : 'No active endpoints'}
            </p>
          )}
          {hasHiddenOnion && (
            <p className="text-[10px] text-slate-500 italic">Onion address rotation pending — new address will appear after the next publish.</p>
          )}
          <div className="mt-3 space-y-2">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">TLS fingerprint</span>
            {displayInventory.length > 0 ? (
              <div className="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-2xl border border-slate-200 text-[10px] font-mono text-slate-600">
                <span className="truncate">{tlsFingerprint}</span>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const value = tlsFingerprint === 'N/A' ? null : tlsFingerprint;
                      if (value) copyToClipboard(value, `fingerprint-${service.id}`);
                    }}
                    className="p-1 text-slate-400 hover:text-blue-500 transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  {service.config?.generate_self_signed === false && (
                    <span className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">TLS EXTERNAL</span>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-[10px] text-slate-500 italic">No TLS fingerprints available yet.</p>
            )}
          </div>
        </div>
        {service.config?.service_mode === 'private' && service.config?.ncc05_recipients?.length > 0 && (
          <div className="px-5 pt-2">
            <p className="text-[10px] text-slate-500 italic">Private recipients: {service.config.ncc05_recipients.length}</p>
          </div>
        )}

        <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 px-1 uppercase tracking-tighter pt-2 border-t border-slate-100">
          <span>Last Update</span>
          <span className="text-slate-900">{lastUpdateText}</span>
        </div>
      </div>
    </>
  );
}
