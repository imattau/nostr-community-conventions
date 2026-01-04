import React from 'react';
import { AnimatePresence, motion as Motion } from 'framer-motion';
import { Plus } from 'lucide-react';

const Modal = ({ 
  isOpen, 
  onClose, 
  title, 
  children, 
  maxWidth = 'max-w-lg',
  zIndex = 'z-[100]'
}) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className={`fixed inset-0 ${zIndex} flex items-center justify-center p-6`}>
          <Motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
          />
          <Motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className={`relative ncc-modal-content w-full ${maxWidth} overflow-hidden`}
          >
            <div className="bg-slate-900 p-8 text-white flex justify-between items-center">
              <h2 className="text-2xl font-black tracking-tight">{title}</h2>
              <button 
                onClick={onClose} 
                className="text-slate-400 hover:text-white transition-colors"
              >
                <Plus className="w-6 h-6 rotate-45" />
              </button>
            </div>
            <div className="p-8 text-slate-900 dark:text-white">
              {children}
            </div>
          </Motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default Modal;
