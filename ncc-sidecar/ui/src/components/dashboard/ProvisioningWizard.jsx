import React, { useState, useEffect } from 'react';
import { motion as Motion } from 'framer-motion';
import { RefreshCw, Check } from 'lucide-react';
import { sidecarApi } from '../../api';

const ProvisioningWizard = ({ adminPubkey, onComplete }) => {
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState(0);

  const addLog = (msg) => setLogs(prev => [...prev, msg]);

  useEffect(() => {
    const run = async () => {
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
        addLog("ERROR: " + err.message);
      }
    };
    run();
  }, [adminPubkey, onComplete]);

  return (
    <div className="space-y-10">
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
            animate={{ width: `${progress}%` }}
            className="h-full bg-gradient-to-r from-blue-600 to-indigo-400"
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
              <span className="text-blue-500 font-black">›</span>
              <span className="text-slate-300">{log}</span>
              {i === logs.length - 1 && i < 4 && <span className="w-1 h-3 bg-blue-500 animate-pulse" />}
              {i < logs.length - 1 && <Check className="w-3 h-3 text-green-500 ml-auto" />}
            </Motion.div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ProvisioningWizard;
