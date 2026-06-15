import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from "lucide-react";
import { useToastStore, ToastType } from "../../stores/toastStore";

const ICONS: Record<ToastType, typeof CheckCircle> = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle,
};

const COLORS: Record<ToastType, { bg: string; border: string; icon: string }> = {
  success: { bg: "color-mix(in srgb, var(--color-success) 12%, transparent)", border: "var(--color-success)", icon: "var(--color-success)" },
  error:   { bg: "color-mix(in srgb, var(--color-error) 12%, transparent)",   border: "var(--color-error)",   icon: "var(--color-error)" },
  info:    { bg: "color-mix(in srgb, var(--accent) 12%, transparent)",        border: "var(--accent)",        icon: "var(--accent)" },
  warning: { bg: "color-mix(in srgb, var(--color-warning) 12%, transparent)", border: "var(--color-warning)", icon: "var(--color-warning)" },
};

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div style={containerStyle}>
      {toasts.map((toast) => {
        const Icon = ICONS[toast.type];
        const colors = COLORS[toast.type];
        return (
          <div
            key={toast.id}
            style={{
              ...toastStyle,
              background: colors.bg,
              borderColor: colors.border,
            }}
          >
            <Icon size={16} style={{ color: colors.icon, flexShrink: 0 }} />
            <span style={messageStyle}>{toast.message}</span>
            <button
              onClick={() => removeToast(toast.id)}
              style={closeBtnStyle}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  position: "fixed",
  bottom: 32,
  right: 16,
  zIndex: 9999,
  display: "flex",
  flexDirection: "column-reverse",
  gap: 8,
  maxWidth: 380,
};

const toastStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 12px",
  borderRadius: 6,
  border: "1px solid",
  fontSize: "var(--font-size-sm)",
  color: "var(--text-primary)",
  boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
  animation: "toast-slide-in 0.2s ease-out",
};

const messageStyle: React.CSSProperties = {
  flex: 1,
  lineHeight: 1.4,
};

const closeBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  border: "none",
  color: "var(--text-muted)",
  cursor: "pointer",
  padding: 2,
  flexShrink: 0,
};
