// src/workers/validationWorker.js
import { validateNccChain } from '../services/chain_validator.js';

self.onmessage = function(e) {
  const { id, targetD, rawDocs, rawNsrs } = e.data;
  try {
    const result = validateNccChain(targetD, rawDocs, rawNsrs);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ 
      id, 
      result: { 
        d: targetD, 
        warnings: [`Worker Error: ${error.message}`] 
      } 
    });
  }
};
