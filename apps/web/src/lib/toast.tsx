import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

type Toast = {
  id: string;
  title: string;
  description?: string;
  variant?: 'success' | 'error' | 'info';
};

type ToastContextValue = {
  toast: (t: Omit<Toast, 'id'>) => void;
};

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id =
      typeof crypto !== 'undefined' && (crypto as any).randomUUID
        ? (crypto as any).randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const next: Toast = { id, ...t };
    setToasts((s) => [...s, next]);
    setTimeout(() => setToasts((s) => s.filter((x) => x.id !== id)), 4000);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="fixed right-4 top-4 z-50 flex w-80 flex-col gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`rounded-md border px-3 py-2 shadow-sm ${
              t.variant === 'error'
                ? 'bg-red-600 text-white'
                : t.variant === 'success'
                  ? 'bg-green-600 text-white'
                  : 'bg-white text-slate-900'
            }`}
          >
            <div className="font-medium">{t.title}</div>
            {t.description ? (
              <div className="text-sm">{t.description}</div>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
