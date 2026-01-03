import React, { useState, useEffect } from 'react';
import { sidecarApi } from '../../api';
import Modal from '../common/Modal';
import Button from '../common/Button';

const SidecarProfileModal = ({ isOpen, onClose, sidecarService, onRefresh }) => {
  const [draft, setDraft] = useState({
    name: '',
    display_name: '',
    about: '',
    picture: '',
    nip05: ''
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && sidecarService) {
      const p = sidecarService.config?.profile || {};
      setDraft({
        name: p.name || '',
        display_name: p.display_name || '',
        about: p.about || '',
        picture: p.picture || '',
        nip05: p.nip05 || ''
      });
    }
  }, [isOpen, sidecarService]);

  const handleSave = async () => {
    setLoading(true);
    try {
      const updatedConfig = {
        ...sidecarService.config,
        profile: draft
      };
      await sidecarApi.updateService(sidecarService.id, { config: updatedConfig });
      onRefresh();
      onClose();
    } catch (err) {
      alert("Failed: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Sidecar Profile">
      <div className="space-y-5">
        <p className="text-sm text-slate-500">
          These fields populate the Sidecar’s Nostr profile metadata (kind 0).
        </p>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-500">Profile name</label>
            <input
              type="text" value={draft.name}
              onChange={e => setDraft(prev => ({ ...prev, name: e.target.value }))}
              className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 text-sm font-bold outline-none"
              placeholder="machine-readable name"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-500">Display name</label>
            <input
              type="text" value={draft.display_name}
              onChange={e => setDraft(prev => ({ ...prev, display_name: e.target.value }))}
              className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 text-sm font-bold outline-none"
              placeholder="Human-friendly label"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-500">About / bio</label>
            <textarea
              rows={3} value={draft.about}
              onChange={e => setDraft(prev => ({ ...prev, about: e.target.value }))}
              className="w-full bg-slate-50 border border-slate-100 rounded-2xl p-4 text-xs font-medium outline-none resize-none"
              placeholder="Purpose of this Sidecar"
            />
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} loading={loading}>Save Profile</Button>
        </div>
      </div>
    </Modal>
  );
};

export default SidecarProfileModal;
