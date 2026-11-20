import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BookOpen, Check, Copy, RefreshCw, X } from 'lucide-react';
import type { ServiceTip } from '@/src/lib/dailyTips';
import type { AppTab } from '@/src/types';

interface DailyServiceTipModalProps {
  tip: ServiceTip | null;
  onClose: () => void;
  onNextTip: () => void;
  onOpenTab: (tab: AppTab) => void;
}

export function DailyServiceTipModal({
  tip,
  onClose,
  onNextTip,
  onOpenTab,
}: DailyServiceTipModalProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCopied(false);
  }, [tip?.id]);

  useEffect(() => {
    if (!tip) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tip, onClose]);

  const handleCopyScript = () => {
    if (!tip?.sampleScript) return;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(tip.sampleScript).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <AnimatePresence>
      {tip && (
        <motion.div
          key="daily-tip-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          onClick={onClose}
          className="fixed inset-0 z-50 bg-slate-900/50 dark:bg-black/70 backdrop-blur-[2px] flex items-center justify-center p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="daily-tip-title"
        >
          <motion.div
            key="daily-tip-panel"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-xl w-full shadow-xl overflow-hidden"
          >
            {/* Header */}
            <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-4">
              <div className="space-y-1 min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  <BookOpen className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>เคล็ดลับบริการประจำวัน (Daily Service Tip)</span>
                  <span aria-hidden="true" className="text-slate-400 dark:text-slate-600">
                    ·
                  </span>
                  <span className="text-slate-500 dark:text-slate-400">
                    {tip.sourceLabel} / {tip.category}
                  </span>
                </div>
                <h2
                  id="daily-tip-title"
                  className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 leading-snug text-balance"
                >
                  {tip.title}
                </h2>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="ปิดหน้าต่างเคล็ดลับบริการประจำวัน"
                className="p-2 -mr-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0 focus-visible:outline-2 focus-visible:outline-emerald-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4">
              <p className="text-sm sm:text-[15px] text-slate-700 dark:text-slate-200 leading-relaxed">
                {tip.excerpt}
              </p>

              {tip.keyTakeaway && (
                <div className="p-4 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-800/70 space-y-1">
                  <div className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                    แนวทางปฏิบัติที่แนะนำ
                  </div>
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100 leading-relaxed">
                    {tip.keyTakeaway}
                  </p>
                </div>
              )}

              {tip.sampleScript && (
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                      ตัวอย่างสคริปต์พร้อมใช้งาน
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyScript}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      {copied ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                          <span className="text-emerald-700 dark:text-emerald-400">คัดลอกแล้ว</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>คัดลอกสคริปต์</span>
                        </>
                      )}
                    </button>
                  </div>
                  <p className="text-sm text-slate-800 dark:text-slate-100 leading-relaxed whitespace-pre-line">
                    {tip.sampleScript}
                  </p>
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onNextTip}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  สุ่มเคล็ดลับอื่น
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onOpenTab('playbook');
                    onClose();
                  }}
                  className="px-3 py-2 text-xs sm:text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  เปิดดูคู่มือเต็ม
                </button>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
              >
                รับทราบ · เริ่มฝึกเลย
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
