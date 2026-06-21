"use client";

import * as React from "react";
import { X, CheckCircle2, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Minimal, dependency-free toast system. A provider holds the queue; useToast()
 * exposes toast() anywhere in the client tree. Styled to match the bridge-deck
 * flat slate/orange identity.
 */

type ToastVariant = "default" | "success" | "error" | "info";

interface ToastItem {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (t: Omit<ToastItem, "id">) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

let counter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);

  const remove = React.useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback(
    (t: Omit<ToastItem, "id">) => {
      const id = ++counter;
      setItems((prev) => [...prev, { ...t, id }]);
      // Auto-dismiss after a few seconds.
      setTimeout(() => remove(id), t.variant === "error" ? 7000 : 4500);
    },
    [remove],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2">
        {items.map((t) => (
          <ToastCard key={t.id} item={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const Icon =
    item.variant === "success"
      ? CheckCircle2
      : item.variant === "error"
        ? AlertTriangle
        : Info;
  const accent =
    item.variant === "success"
      ? "text-emerald-500"
      : item.variant === "error"
        ? "text-destructive"
        : "text-primary";
  return (
    <div
      className={cn(
        "edge-tab pointer-events-auto flex items-start gap-3 rounded-md border border-border bg-card p-4 shadow-lg",
        "data-[state=open]:animate-in",
      )}
      role="status"
    >
      <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", accent)} />
      <div className="flex-1">
        <p className="text-sm font-semibold leading-tight">{item.title}</p>
        {item.description && (
          <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
        )}
      </div>
      <button
        onClick={onClose}
        className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    // Fail soft: no provider mounted (e.g. during SSR-only render).
    return { toast: () => {} };
  }
  return ctx;
}
