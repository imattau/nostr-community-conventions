import { useState, useEffect, useCallback } from 'react';
import { SimplePool } from 'nostr-tools';

const NODES_LIST_KIND = 30001;
const NODES_LIST_D_TAG = 'ncc-managed-nodes';
const RELAYS = [
  'wss://nostr.mutinywallet.com',
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net'
];

export const useAdminNodeList = ({ adminPubkey, sidecarNode, signer }) => {
  const [syncStatus, setSyncStatus] = useState('idle'); // idle, checking, syncing, synced, error

  const checkAndUpdateList = useCallback(async () => {
    if (!adminPubkey || !sidecarNode || !signer) return;
    
    // We need a signer to perform operations
    if (!signer) {
        console.debug("[NodeList] No signer available, skipping auto-bookmark.");
        return;
    }

    setSyncStatus('checking');
    const pool = new SimplePool();

    try {
      // 1. Fetch existing list
      const event = await pool.get(RELAYS, {
        kinds: [NODES_LIST_KIND],
        authors: [adminPubkey],
        '#d': [NODES_LIST_D_TAG]
      });

      let currentList = [];
      if (event) {
        try {
          const decrypted = await signer.decrypt(adminPubkey, event.content);
          currentList = JSON.parse(decrypted);
          if (!Array.isArray(currentList)) currentList = [];
        } catch (err) {
          console.warn("[NodeList] Failed to decrypt existing list:", err);
          // If we can't decrypt, we shouldn't overwrite blindly. Abort safety.
          setSyncStatus('error');
          pool.close(RELAYS);
          return;
        }
      }

      // 2. Prepare current node entry
      const currentUrl = window.location.origin;
      const currentNode = {
        url: currentUrl,
        name: sidecarNode.name || 'NCC Sidecar',
        pubkey: sidecarNode.service_nsec ? 'derived-on-client' : '', 
        lastSeen: Date.now()
      };
      
      // Check if update is needed
      const existingIndex = currentList.findIndex(n => n.url === currentUrl);
      const isUpToDate = existingIndex !== -1 && 
                         currentList[existingIndex].name === currentNode.name;

      if (isUpToDate) {
        setSyncStatus('synced');
        pool.close(RELAYS);
        return;
      }

      // 3. Update List
      setSyncStatus('syncing');
      const newList = [...currentList];
      if (existingIndex !== -1) {
        newList[existingIndex] = { ...newList[existingIndex], ...currentNode };
      } else {
        newList.push(currentNode);
      }

      // 4. Encrypt and Sign
      const encrypted = await signer.encrypt(adminPubkey, JSON.stringify(newList));
      
      const newEvent = {
        kind: NODES_LIST_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['d', NODES_LIST_D_TAG]],
        content: encrypted,
        pubkey: adminPubkey
      };

      const signedEvent = await signer.signEvent(newEvent);

      // 5. Publish
      await Promise.all(pool.publish(RELAYS, signedEvent));
      
      console.log("[NodeList] Automatically bookmarked node to admin profile.");
      setSyncStatus('synced');

    } catch (err) {
      console.error("[NodeList] Sync failed:", err);
      setSyncStatus('error');
    } finally {
      pool.close(RELAYS);
    }
  }, [adminPubkey, sidecarNode, signer]);

  useEffect(() => {
    // Debounce the check to avoid spamming on rapid re-renders
    const timer = setTimeout(() => {
      checkAndUpdateList();
    }, 2000);
    return () => clearTimeout(timer);
  }, [checkAndUpdateList]);

  return syncStatus;
};