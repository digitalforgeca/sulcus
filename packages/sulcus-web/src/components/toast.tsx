'use client';

import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

type ToastVariant = 'info' | 'success' | 'warning' | 'error';

interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  duration?: number;
  exiting?: boolean;
}

interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant, duration?: number) => void;
  info:    (message: string) => void;
  success: (message: string) => void;
  warning: (message: string) => void;
  error:   (message: string) => void;
}

const VARIANT_STYLES: Record<ToastVariant, { border: string; icon: string; label: string }> = {
  info:    { border: '#00F0FF', icon: '◈', label: 'INFO' },
  success: { border: '#50FA7B', icon: '✓', label: 'OK' },
  warning: { border: '#D4AF37', icon: '⚠', label: 'WARN' },
  error:   { border: '#FF6B6B', icon: '✕', label: 'ERR' },
};

const ToastCtx = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 300);
  }, []);

  const toast = useCallback((message: string, variant: ToastVariant = 'info', duration = 5000) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts(prev => [...prev.slice(-4), { id, message, variant, duration }]);
    const timer = setTimeout(() => dismiss(id), duration);
    timers.current.set(id, timer);
    return id;
  }, [dismiss]);

  useEffect(() => () => {
    timers.current.forEach(t => clearTimeout(t));
  }, []);

  const ctx: ToastContextValue = {
    toast,
    info:    (m) => toast(m, 'info'),
    success: (m) => toast(m, 'success'),
    warning: (m) => toast(m, 'warning'),
    error:   (m) => toast(m, 'error'),
  };

  return (
    <ToastCtx.Provider value={ctx}>
      {children}
      {/* Portal-like fixed container */}
      <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none" style={{ maxWidth: 360 }}>
        {toasts.map(t => {
          const s = VARIANT_STYLES[t.variant];
          return (
            <div
              key={t.id}
              className="pointer-events-auto"
              style={{
                opacity: t.exiting ? 0 : 1,
                transform: t.exiting ? 'translateX(110%)' : 'translateX(0)',
                transition: 'opacity 0.28s ease, transform 0.28s ease',
              }}
            >
              <div
                className="bg-[#0a1520] border-l-2 px-4 py-3 flex items-start gap-3 rounded-sm shadow-xl backdrop-blur-sm"
                style={{ borderLeftColor: s.border }}
              >
                <span className="text-sm mt-0.5 flex-shrink-0" style={{ color: s.border }}>
                  {s.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-mono tracking-widest uppercase mb-0.5" style={{ color: s.border }}>
                    {s.label}
                  </div>
                  <div className="text-[#ccc] text-xs font-mono break-words">{t.message}</div>
                </div>
                <button
                  className="text-[#444] hover:text-[#888] transition-colors text-xs ml-1 flex-shrink-0 mt-0.5"
                  onClick={() => dismiss(t.id)}
                >✕</button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
