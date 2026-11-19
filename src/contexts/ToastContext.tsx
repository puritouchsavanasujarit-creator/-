import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { ToastContainer } from '@/src/components/Toast';
import type { ToastItem, ToastVariant } from '@/src/components/Toast';

export interface ShowToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  durationMs?: number;
}

interface ToastContextValue {
  showToast: (options: ShowToastOptions) => string;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const MAX_VISIBLE_TOASTS = 4;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const showToast = useCallback((options: ShowToastOptions) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const nextToast: ToastItem = {
      id,
      title: options.title,
      description: options.description,
      variant: options.variant ?? 'success',
      durationMs: options.durationMs,
    };
    setToasts((prev) => [...prev, nextToast].slice(-MAX_VISIBLE_TOASTS));
    return id;
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, dismissToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}
