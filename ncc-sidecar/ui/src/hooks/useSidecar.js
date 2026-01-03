import { useState, useEffect, useCallback } from 'react';
import { sidecarApi } from '../api';

export const useSidecar = () => {
  const [initialized, setInitialized] = useState(null);
  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState([]);
  const [logs, setLogs] = useState([]);
  const [appConfig, setAppConfig] = useState({});
  const [admins, setAdmins] = useState([]);
  const [networkAvailability, setNetworkAvailability] = useState({ ipv4: false, ipv6: false, tor: false });
  
  // Backup Status
  const [backupSyncStatus, setBackupSyncStatus] = useState('idle');
  const [backupSyncError, setBackupSyncError] = useState('');
  const [lastBackupSyncTime, setLastBackupSyncTime] = useState(null);
  const [listBackupMessage, setListBackupMessage] = useState('');

  const checkNetwork = useCallback(async () => {
    try {
      const [netResult, torResult] = await Promise.allSettled([
        sidecarApi.probeNetwork(),
        sidecarApi.getTorStatus()
      ]);

      const net = netResult.status === 'fulfilled' ? netResult.value : { ipv4: false, ipv6: false };
      const tor = torResult.status === 'fulfilled' ? torResult.value : { running: false };

      if (netResult.status === 'rejected') console.warn('Network probe failed:', netResult.reason);
      if (torResult.status === 'rejected') console.warn('Tor probe failed:', torResult.reason);

      setNetworkAvailability({
        ipv4: !!net.ipv4,
        ipv6: !!net.ipv6,
        tor: !!tor.running
      });
    } catch (err) {
      console.warn("Network check critical error:", err);
    }
  }, []);

  const fetchServices = useCallback(async () => {
    try {
      const data = await sidecarApi.getServices();
      setServices(prev => JSON.stringify(prev) === JSON.stringify(data) ? prev : data);
      
      const status = await sidecarApi.getStatus();
      setAppConfig(status.config || {});
      if (status.logs) {
        setLogs(prev => JSON.stringify(prev) === JSON.stringify(status.logs) ? prev : status.logs);
      }
    } catch (err) {
      console.warn("Failed to refresh services:", err);
    }
  }, []);

  const fetchAdmins = useCallback(async () => {
    try {
      const data = await sidecarApi.getAdmins();
      setAdmins(data);
    } catch (err) {
      console.warn("Failed to fetch admins:", err);
    }
  }, []);

  const checkStatus = useCallback(async () => {
    try {
      const data = await sidecarApi.checkStatus();
      setInitialized(data.initialized);
    } catch (err) {
      console.error("Status check failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const syncBackup = useCallback(async (force = false) => {
    setBackupSyncStatus('syncing');
    setBackupSyncError('');
    try {
      const res = await sidecarApi.fetchRemoteBackup(force);
      if (res.success) {
        setBackupSyncStatus('synced');
        setLastBackupSyncTime(Date.now());
        if (res.restoredServices?.length || res.restoredAdmins) {
          setListBackupMessage('Remote list backup applied automatically.');
          await fetchServices();
        }
      } else if (res.skipped) {
        setBackupSyncStatus('synced');
        setLastBackupSyncTime(Date.now());
      } else if (res.error) {
        setBackupSyncStatus('error');
        setBackupSyncError(res.error);
      } else {
        setBackupSyncStatus('idle');
      }
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Unknown error';
      setBackupSyncStatus('error');
      setBackupSyncError(msg);
    }
  }, [fetchServices]);

  useEffect(() => {
    checkStatus();
    checkNetwork();
  }, [checkStatus, checkNetwork]);

  useEffect(() => {
    if (initialized) {
      fetchServices();
      const interval = setInterval(fetchServices, 10000);
      return () => clearInterval(interval);
    }
  }, [initialized, fetchServices]);

  return {
    initialized,
    setInitialized,
    loading,
    services,
    logs,
    appConfig,
    admins,
    networkAvailability,
    backupSyncStatus,
    backupSyncError,
    lastBackupSyncTime,
    listBackupMessage,
    setListBackupMessage,
    fetchServices,
    fetchAdmins,
    syncBackup,
    checkStatus
  };
};
