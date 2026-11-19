import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
  durationMs?: number;
}

interface ToastCardProps {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}

const DEFAULT_DURATION_MS = 4500;

function ToastCard({ toast, onDismiss }: ToastCardProps) {
  const variant = toast.variant ?? 'success';
  const durationMs = toast.durationMs ?? DEFAULT_DURATION_MS;
  const remainingRef = useRef(durationMs);
  const startedAtRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const startTimer = () => {
    if (durationMs <= 0) return;
    clearTimer();
    startedAtRef.current = Date.now();
    timerRef.current = setTimeout(() => {
      onDismiss(toast.id);
    }, Math.max(0, remainingRef.current));
  };

  const pauseTimer = () => {
    if (startedAtRef.current !== null) {
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current));
      startedAtRef.current = null;
    }
    clearTimer();
  };

  useEffect(() => {
    startTimer();
    return clearTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.id]);

  const variantStyles: Record<
    ToastVariant,
    {
      container: string;
      iconWrap: string;
      icon: typeof CheckCircle2;
    }
  > = {
    success: {
      container:
        'border-emerald-200 dark:border-emerald-800/80 bg-white dark:bg-slate-900',
      iconWrap:
        'bg-emerald-50 dark:bg-emerald-950/70 text-emerald-600 dark:text-emerald-400',
      icon: CheckCircle2,
    },
    error: {
      container:
        'border-rose-200 dark:border-rose-800/80 bg-white dark:bg-slate-900',
      iconWrap:
        'bg-rose-50 dark:bg-rose-950/70 text-rose-600 dark:text-rose-400',
      icon: AlertCircle,
    },
    info: {
      container:
        'border-sky-200 dark:border-sky-800/80 bg-white dark:bg-slate-900',
      iconWrap:
        'bg-sky-50 dark:bg-sky-950/70 text-sky-600 dark:text-sky-400',
      icon: Info,
    },
  };

  const style = variantStyles[variant];
  const Icon = style.icon;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.96 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      onMouseEnter={pauseTimer}
      onMouseLeave={startTimer}
      role={variant === 'error' ? 'alert' : 'status'}
      aria-live={variant === 'error' ? 'assertive' : 'polite'}
      className={`pointer-events-auto w-full rounded-xl border p-3.5 shadow-lg dark:shadow-black/40 flex items-start gap-3 ${style.container}`}
    >
      <div className={`p-1.5 rounded-lg shrink-0 ${style.iconWrap}`}>
        <Icon className="w-4 h-4" />
      </div>

      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug">
          {toast.title}
        </p>
        {toast.description && (
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">
            {toast.description}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="ปิดการแจ้งเตือน"
        className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
      >
        <X className="w-4 h-4" />
      </button>
    </motion.div>
  );
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  return (
    <div
      aria-label="การแจ้งเตือนระบบ"
      className="fixed bottom-5 right-5 z-[60] flex flex-col gap-2.5 w-[calc(100vw-2.5rem)] max-w-sm pointer-events-none"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </AnimatePresence>
    </div>
  );
}
