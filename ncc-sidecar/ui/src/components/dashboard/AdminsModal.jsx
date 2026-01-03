import React, { useState } from 'react';
import { Trash2, Copy, Check } from 'lucide-react';
import { nip19 } from 'nostr-tools';
import { sidecarApi } from '../../api';
import Modal from '../common/Modal';
import Button from '../common/Button';

const AdminsModal = ({ isOpen, onClose, admins, onRefresh, copyToClipboard, copiedMap }) => {
  const [inviteNpub, setInviteNpub] = useState('');
  const [loading, setLoading] = useState(false);

  const handleInvite = async () => {
    if (!inviteNpub) return;
    setLoading(true);
    try {
      await sidecarApi.inviteAdmin({ npub: inviteNpub });
      setInviteNpub('');
      onRefresh();
      alert("Invite sent via Nostr DM!");
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (pubkey) => {
    if (!confirm("Remove this admin?")) return;
    try {
      await sidecarApi.removeAdmin(pubkey);
      onRefresh();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Administrators">
      <div className="space-y-8">
        <div className="space-y-3">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Invite New Admin</label>
          <div className="flex space-x-2">
            <input 
              type="text" placeholder="Paste npub..." 
              className="flex-1 bg-slate-50 border border-slate-100 rounded-2xl p-4 text-xs font-mono outline-none focus:border-blue-500/50 transition-colors"
              value={inviteNpub}
              onChange={(e) => setInviteNpub(e.target.value)}
            />
            <Button onClick={handleInvite} loading={loading}>Invite</Button>
          </div>
        </div>

        <div className="space-y-3">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Current Admins</label>
          <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-2">
            {admins.map((admin, idx) => (
              <div key={admin.pubkey} className="flex items-center justify-between bg-slate-50 p-4 rounded-2xl border border-slate-100 group">
                <div className="space-y-1">
                  <p className="text-[10px] font-mono font-bold text-slate-600">
                    {nip19.npubEncode(admin.pubkey).slice(0, 16)}...{nip19.npubEncode(admin.pubkey).slice(-8)}
                  </p>
                  <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded ${admin.status === 'active' ? 'bg-green-100 text-green-600' : 'bg-yellow-100 text-yellow-600'}`}>
                    {admin.status}
                  </span>
                </div>
                <div className="flex items-center space-x-1">
                  <button onClick={() => copyToClipboard(nip19.npubEncode(admin.pubkey), `admin-${idx}`)} className="p-2 text-slate-300 hover:text-blue-500">
                    {copiedMap[`admin-${idx}`] ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  {idx !== 0 && (
                    <button onClick={() => handleRemove(admin.pubkey)} className="p-2 text-slate-300 hover:text-red-500">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default AdminsModal;
