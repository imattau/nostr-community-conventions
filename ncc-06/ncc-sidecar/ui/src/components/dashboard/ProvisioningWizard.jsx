import React, { useState, useEffect, useCallback } from 'react';
import { motion as Motion } from 'framer-motion';
import { RefreshCw, Check, CloudDownload, Plus, AlertCircle } from 'lucide-react';
import { sidecarApi } from '../../api';
import Button from '../common/Button';

const ProvisioningWizard = ({ adminPubkey, signer, onComplete }) => {
  const [step, setStep] = useState('checking'); // checking, choice, provisioning
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState(0);
  const [recoveryEvents, setRecoveryEvents] = useState([]);
  const [error, setError] = useState(null);

  const addLog = (msg) => setLogs(prev => [...prev, msg]);

  const checkRecovery = useCallback(async () => {
    try {
      const res = await sidecarApi.getRecoveryEvents(adminPubkey);
      if (res.events && res.events.length > 0) {
        setRecoveryEvents(res.events);
        setStep('choice');
      } else {
        setStep('provisioning');
      }
    } catch (err) {
      console.warn("Failed to check recovery events:", err);
      setStep('provisioning');
    }
  }, [adminPubkey]);

  useEffect(() => {
    if (step === 'checking') {
      checkRecovery();
    }
  }, [step, checkRecovery]);

  const handleSetupNew = () => {
    setStep('provisioning');
  };

  const handleRestore = async () => {
    setStep('provisioning');
    addLog("Starting node recovery...");
    setProgress(10);
    
    try {
      const latest = recoveryEvents.sort((a, b) => b.created_at - a.created_at)[0];
      addLog(`Found backup from ${new Date(latest.created_at * 1000).toLocaleString()}`);
      
      addLog("Decrypting recovery payload...");
      if (!signer) throw new Error("Signer not available for decryption");
      
      const decrypted = await signer.decrypt(latest.pubkey, latest.content);
      const payload = JSON.parse(decrypted);
      
      addLog("Restoring management identity...");
      await sidecarApi.recoverNode({
        adminPubkey,
        recoveryPayload: payload
      });
      setProgress(60);

      addLog("Fetching remote service configuration...");
      // The backend will have the sidecar keys now, so it can decrypt the main backup
      const syncRes = await sidecarApi.fetchRemoteBackup(true);
      if (syncRes.success) {
        addLog("Remote configuration applied successfully.");
      } else {
        addLog("No remote configuration found or sync skipped.");
      }
      
      setProgress(90);
      addLog("Recovery complete!");
      setProgress(100);
      setTimeout(onComplete, 1500);
    } catch (err) {
      setError(err.message);
      addLog("ERROR: " + err.message);
    }
  };

  useEffect(() => {
    if (step !== 'provisioning' || logs.length > 0) return;

    const runInit = async () => {
      addLog("Starting node initialization...");
      setProgress(10);
      
      try {
        addLog("Configuring admin authority...");
        await new Promise(r => setTimeout(r, 1000));
        setProgress(30);

        addLog("Generating management identity...");
        await sidecarApi.initNode({
          adminPubkey,
          config: { service_mode: 'private' }
        });
        setProgress(60);

        addLog("Provisioning network endpoints...");
        await new Promise(r => setTimeout(r, 1500));
        setProgress(90);

        addLog("Setup complete!");
        setProgress(100);
        
        setTimeout(onComplete, 1000);
      } catch (err) {
        setError(err.message);
        addLog("ERROR: " + err.message);
      }
    };
    runInit();
  }, [step, adminPubkey, onComplete, logs.length]);

  if (step === 'checking') {
    return (
      <div className="flex flex-col items-center justify-center space-y-6 py-12">
        <RefreshCw className="w-12 h-12 text-blue-500 animate-spin" />
        <p className="text-slate-400 font-medium italic">Checking for existing backups...</p>
      </div>
    );
  }

  if (step === 'choice') {
    return (
      <div className="space-y-10">
        <div className="text-center space-y-4">
          <div className="w-20 h-20 bg-blue-500/10 rounded-3xl flex items-center justify-center mx-auto mb-6">
            <CloudDownload className="w-10 h-10 text-blue-500" />
          </div>
          <h1 className="text-3xl font-black tracking-tight">Restore Sidecar?</h1>
          <p className="text-slate-400 max-w-sm mx-auto">
            We found an encrypted recovery backup associated with your identity.
          </p>
        </div>

        <div className="space-y-4">
          <button 
            onClick={handleRestore}
            className="w-full group bg-blue-600 hover:bg-blue-500 text-white rounded-3xl p-6 transition-all flex items-center gap-6 text-left shadow-xl shadow-blue-500/20"
          >
            <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
              <CloudDownload className="w-6 h-6" />
            </div>
            <div>
              <p className="font-black text-lg leading-none">Restore from Backup</p>
              <p className="text-blue-100 text-xs mt-1 font-medium">Recovers keys and services automatically.</p>
            </div>
          </button>

          <button 
            onClick={handleSetupNew}
            className="w-full group bg-slate-800 hover:bg-slate-700 text-white rounded-3xl p-6 transition-all flex items-center gap-6 text-left"
          >
            <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
              <Plus className="w-6 h-6 text-slate-400" />
            </div>
            <div>
              <p className="font-black text-lg leading-none">Setup New Node</p>
              <p className="text-slate-400 text-xs mt-1 font-medium">Starts fresh with a new management identity.</p>
            </div>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <div className="space-y-2 text-center">
        <Motion.div 
          animate={error ? {} : { rotate: 360 }}
          transition={{ repeat: Infinity, duration: 4, ease: "linear" }}
          className={`w-24 h-24 bg-gradient-to-tr ${error ? 'from-red-600 to-orange-500' : 'from-blue-600 to-indigo-500'} rounded-[2.5rem] flex items-center justify-center mx-auto shadow-2xl shadow-blue-500/20 mb-8 transition-colors`}
        >
          {error ? <AlertCircle className="w-10 h-10 text-white" /> : <RefreshCw className="w-10 h-10 text-white" />}
        </Motion.div>
        <h1 className="text-3xl font-black tracking-tight">{error ? 'Provisioning Failed' : 'Provisioning Node'}</h1>
        <p className="text-slate-400 font-medium italic">
          {error ? 'An error occurred during setup.' : 'Automating secure identity and network discovery...'}
        </p>
      </div>

      <div className="space-y-6">
        <div className="h-3 bg-slate-800 rounded-full overflow-hidden border border-white/5">
          <Motion.div 
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            className={`h-full bg-gradient-to-r ${error ? 'from-red-600 to-orange-400' : 'from-blue-600 to-indigo-400'}`}
          />
        </div>

        <div className="bg-slate-950/50 rounded-3xl p-6 border border-white/5 font-mono text-[10px] space-y-2 h-40 overflow-y-auto">
          {logs.map((log, i) => (
            <Motion.div 
              initial={{ opacity: 0, x: -5 }}
              animate={{ opacity: 1, x: 0 }}
              key={i} 
              className="flex items-center space-x-2"
            >
              <span className={`${log.startsWith('ERROR') ? 'text-red-500' : 'text-blue-500'} font-black`}>›</span>
              <span className={log.startsWith('ERROR') ? 'text-red-400' : 'text-slate-300'}>{log}</span>
              {i === logs.length - 1 && !error && i < 6 && <span className="w-1 h-3 bg-blue-500 animate-pulse" />}
              {i < logs.length - 1 && !log.startsWith('ERROR') && <Check className="w-3 h-3 text-green-500 ml-auto" />}
            </Motion.div>
          ))}
        </div>

        {error && (
          <Button onClick={() => window.location.reload()} variant="ghost" className="w-full">
            Retry Setup
          </Button>
        )}
      </div>
    </div>
  );
};

export default ProvisioningWizard;
