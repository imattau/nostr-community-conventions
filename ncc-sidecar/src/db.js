import { ConfigRepository } from './db/repositories/ConfigRepository.js';
import { ServiceRepository } from './db/repositories/ServiceRepository.js';
import { AdminRepository } from './db/repositories/AdminRepository.js';
import { LogRepository } from './db/repositories/LogRepository.js';
import { 
  initDb, getDb, getDbPath, closeDb, wipeDb, 
  setDbPassword, verifyDbPassword, isDbPasswordProtected 
} from './db/index.js';

export { 
  initDb, getDb, getDbPath, closeDb, wipeDb, 
  setDbPassword, verifyDbPassword, isDbPasswordProtected 
};

// --- Config Wrappers ---
export function getConfig(key) {
  return ConfigRepository.get(key);
}

export function setConfig(key, value) {
  ConfigRepository.set(key, value);
}

export function getState(key) {
  return ConfigRepository.getState(key);
}

export function setState(key, value) {
  ConfigRepository.setState(key, value);
}

// --- Service Wrappers ---
export function getServices() {
  return ServiceRepository.getAll();
}

export function addService(service) {
  return ServiceRepository.add(service);
}

export function updateService(id, updates) {
  return ServiceRepository.update(id, updates);
}

export function deleteService(id) {
  return ServiceRepository.delete(id);
}

// --- Admin Wrappers ---
export function getAdmins() {
  return AdminRepository.getAll();
}

export function addAdmin(pubkey, status) {
  AdminRepository.add(pubkey, status);
}

export function removeAdmin(pubkey) {
  AdminRepository.remove(pubkey);
}

// --- Log Wrappers ---
export function addLog(level, message, metadata) {
  LogRepository.add(level, message, metadata);
}

export function getLogs(limit) {
  return LogRepository.getRecent(limit);
}

// --- Helper ---
export function isInitialized() {
  const admins = getAdmins();
  return admins.length > 0;
}