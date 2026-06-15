import { useEffect, useRef } from "react";

export interface ConfirmDialogProps {
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel = "确认",
  cancelLabel = "取消",
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const onCancelRef = useRef(onCancel);
  const onConfirmRef = useRef(onConfirm);
  useEffect(() => {
    onCancelRef.current = onCancel;
    onConfirmRef.current = onConfirm;
  });

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancelRef.current();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  return (
    <div style={overlayStyle}>
      <div style={dialogStyle}>
        <h3 style={titleStyle}>{title}</h3>
        <div style={bodyStyle}>{body}</div>
        <div style={footerStyle}>
          <button onClick={onCancel} style={cancelBtnStyle}>
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            style={danger ? dangerBtnStyle : confirmBtnStyle}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const dialogStyle: React.CSSProperties = {
  background: "var(--bg-secondary)",
  border: "1px solid var(--border-color)",
  borderRadius: 8,
  padding: "20px 24px",
  minWidth: 360,
  maxWidth: 480,
  boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
};

const titleStyle: React.CSSProperties = {
  margin: "0 0 12px",
  fontSize: "15px",
  fontWeight: 600,
  color: "var(--text-primary)",
};

const bodyStyle: React.CSSProperties = {
  fontSize: "13px",
  color: "var(--text-secondary)",
  lineHeight: 1.6,
  marginBottom: 20,
};

const footerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  paddingTop: 12,
  borderTop: "1px solid var(--border-color)",
};

const cancelBtnStyle: React.CSSProperties = {
  padding: "6px 16px",
  background: "var(--bg-tertiary)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-color)",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: "13px",
};

const confirmBtnStyle: React.CSSProperties = {
  padding: "6px 20px",
  background: "var(--accent)",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: "13px",
  fontWeight: 500,
};

const dangerBtnStyle: React.CSSProperties = {
  padding: "6px 20px",
  background: "var(--color-error)",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: "13px",
  fontWeight: 500,
};
