import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm Action',
  cancelLabel = 'Cancel',
  isDestructive = false,
  onConfirm,
  onCancel
}) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
            className="fixed inset-0 bg-black/40 backdrop-blur-xs"
          />

          {/* Modal Card: #FFFFFF, border #E5E5E5 */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.15 }}
            className="relative w-full max-w-md bg-[#FFFFFF] border border-[#E5E5E5] rounded-xl p-6 shadow-xl z-10 space-y-4"
          >
            <div className="flex items-start gap-3.5">
              <div
                className={`p-2.5 rounded-lg shrink-0 ${
                  isDestructive ? 'bg-[#B42318]/10 text-[#B42318]' : 'bg-[#FFF0D6] text-[#B34400]'
                }`}
              >
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-heading font-bold text-[#171717]">
                  {title}
                </h3>
                <p className="mt-1.5 text-xs text-[#737373] leading-relaxed">
                  {message}
                </p>
              </div>
              <button
                onClick={onCancel}
                className="text-[#737373] hover:text-[#171717] p-1 rounded-md transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="pt-3 border-t border-[#E5E5E5] flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 text-xs font-semibold text-[#171717] hover:bg-[#F5F5F2] rounded-lg transition-colors border border-[#E5E5E5] cursor-pointer"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors shadow-xs cursor-pointer ${
                  isDestructive
                    ? 'bg-[#B42318] hover:bg-[#911c13] text-white'
                    : 'bg-[#FFC928] hover:bg-[#f0ba1f] text-[#171717]'
                }`}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
