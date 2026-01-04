import axios from 'axios';

const API_BASE = '/api';

const client = axios.create({
  baseURL: API_BASE,
});

export const sidecarApi = {
  // Setup & Status
  checkStatus: () => client.get('/setup/status').then(res => res.data),
  initNode: (payload) => client.post('/setup/init', payload).then(res => res.data),
  getStatus: () => client.get('/status').then(res => res.data),
  
  // Network
  probeNetwork: () => client.get('/network/probe').then(res => res.data),
  getTorStatus: () => client.get('/tor/status').then(res => res.data),
  detectProxy: () => client.get('/network/detect-proxy').then(res => res.data),
  
  // Services
  getServices: () => client.get('/services').then(res => res.data),
  addService: (payload) => client.post('/service/add', payload).then(res => res.data),
  updateService: (id, payload) => client.put(`/service/${id}`, payload).then(res => res.data),
  deleteService: (id) => client.delete(`/service/${id}`).then(res => res.data),
  republishAll: () => client.post('/services/republish').then(res => res.data),
  rotateOnion: (id) => client.post(`/service/${id}/rotate-onion`).then(res => res.data),
  regenerateTls: (id) => client.post(`/service/${id}/regenerate-tls`).then(res => res.data),
  generateKey: () => client.get('/service/generate-key').then(res => res.data),
  
  // Admins
  getAdmins: () => client.get('/admins').then(res => res.data),
  inviteAdmin: (payload) => client.post('/admin/invite', payload).then(res => res.data),
  removeAdmin: (pubkey) => client.delete(`/admin/${pubkey}`).then(res => res.data),
  
  // Config
  updatePublicationRelays: (relays) => client.put('/config/publication-relays', { relays }).then(res => res.data),
  updateAllowRemote: (allowRemote) => client.put('/config/allow-remote', { allowRemote }).then(res => res.data),
  updateProtocols: (protocols) => client.put('/config/protocols', { protocols }).then(res => res.data),
  updateServiceMode: (service_mode) => client.put('/config/service-mode', { service_mode }).then(res => res.data),
  
  // Database
  getDbInfo: () => client.get('/db/info').then(res => res.data),
  exportDb: (password) => client.get(`/db/export?password=${encodeURIComponent(password)}`, { responseType: 'blob' }),
  importDb: (payload) => client.post('/db/import', payload).then(res => res.data),
  wipeDb: (password) => client.post('/db/wipe', { password }).then(res => res.data),
  updateDbPassword: (payload) => client.post('/db/password', payload).then(res => res.data),
  
  // Backup
  getBackupList: () => client.get('/backup/list').then(res => res.data),
  restoreBackupList: (event) => client.post('/backup/list', { event }).then(res => res.data),
  fetchRemoteBackup: (force = false) => client.get(`/backup/remote${force ? '?force=true' : ''}`).then(res => res.data),
  getRecoveryEvents: (adminPubkey) => client.get(`/backup/recovery-events?adminPubkey=${adminPubkey}`).then(res => res.data),
  recoverNode: (payload) => client.post('/setup/init', { ...payload, isRecovery: true }).then(res => res.data),
};
