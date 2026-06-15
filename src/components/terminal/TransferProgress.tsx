import { useEffect, useState } from "react";
import { Upload, X, CheckCircle, AlertCircle } from "lucide-react";
import { listen } from "@tauri-apps/api/event";

interface Transfer {
  id: string;
  filename: string;
  direction: "upload" | "download";
  bytesTransferred: number;
  totalBytes: number;
  status: "transferring" | "complete" | "error";
  startTime: number;
}

interface ScpProgressPayload {
  session_id: string;
  filename: string;
  bytes_transferred: number;
  total_bytes: number;
  status: "transferring" | "complete" | "error";
}

export function TransferProgress({ sessionId }: { sessionId: string | null }) {
  const [transfers, setTransfers] = useState<Transfer[]>([]);

  useEffect(() => {
    if (!sessionId) return;

    const unlisten = listen<ScpProgressPayload>("scp:progress", (event) => {
      if (event.payload.session_id !== sessionId) return;
      const p = event.payload;

      setTransfers((prev) => {
        const key = `${p.filename}:${p.status === "transferring" ? "active" : Date.now()}`;
        const existing = prev.find(
          (t) => t.filename === p.filename && t.status === "transferring",
        );

        if (existing) {
          return prev.map((t) =>
            t === existing
              ? { ...t, bytesTransferred: p.bytes_transferred, totalBytes: p.total_bytes, status: p.status }
              : t,
          );
        }

        return [
          ...prev,
          {
            id: key,
            filename: p.filename,
            direction: p.total_bytes > 0 && p.bytes_transferred === p.total_bytes ? "upload" : "download",
            bytesTransferred: p.bytes_transferred,
            totalBytes: p.total_bytes,
            status: p.status,
            startTime: Date.now(),
          },
        ];
      });
    });

    return () => { unlisten.then((fn) => fn()); };
  }, [sessionId]);

  // Auto-remove completed/error transfers after 5 seconds
  useEffect(() => {
    const done = transfers.filter((t) => t.status !== "transferring");
    if (done.length === 0) return;
    const timer = setTimeout(() => {
      setTransfers((prev) => prev.filter((t) => t.status === "transferring"));
    }, 5000);
    return () => clearTimeout(timer);
  }, [transfers]);

  const removeTransfer = (id: string) => {
    setTransfers((prev) => prev.filter((t) => t.id !== id));
  };

  if (transfers.length === 0) return null;

  return (
    <div style={containerStyle}>
      {transfers.map((t) => {
        const pct = t.totalBytes > 0 ? Math.round((t.bytesTransferred / t.totalBytes) * 100) : 0;
        const elapsed = (Date.now() - t.startTime) / 1000;
        const speed = elapsed > 0 ? t.bytesTransferred / elapsed : 0;

        return (
          <div key={t.id} style={rowStyle}>
            <span style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
              {t.status === "complete" ? (
                <CheckCircle size={14} style={{ color: "var(--color-success)" }} />
              ) : t.status === "error" ? (
                <AlertCircle size={14} style={{ color: "var(--color-error)" }} />
              ) : (
                <Upload size={14} style={{ color: "var(--accent)" }} />
              )}
            </span>
            <span style={nameStyle}>{t.filename}</span>
            <div style={barOuterStyle}>
              <div
                style={{
                  ...barInnerStyle,
                  width: `${pct}%`,
                  background: t.status === "error" ? "var(--color-error)" : "var(--accent)",
                }}
              />
            </div>
            <span style={pctStyle}>{pct}%</span>
            {t.status === "transferring" && (
              <span style={speedStyle}>{formatSpeed(speed)}</span>
            )}
            {t.status !== "transferring" && (
              <button onClick={() => removeTransfer(t.id)} style={closeBtnStyle}>
                <X size={12} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

const containerStyle: React.CSSProperties = {
  position: "absolute",
  bottom: 0,
  left: 0,
  right: 0,
  background: "var(--bg-primary)",
  borderTop: "1px solid var(--border-color)",
  padding: "6px 12px",
  display: "flex",
  flexDirection: "column",
  gap: 4,
  zIndex: 20,
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: "11px",
  color: "var(--text-secondary)",
};

const nameStyle: React.CSSProperties = {
  maxWidth: 120,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const barOuterStyle: React.CSSProperties = {
  flex: 1,
  height: 4,
  background: "var(--bg-primary)",
  borderRadius: 2,
  overflow: "hidden",
};

const barInnerStyle: React.CSSProperties = {
  height: "100%",
  borderRadius: 2,
  transition: "width 0.3s",
};

const pctStyle: React.CSSProperties = {
  width: 36,
  textAlign: "right",
  flexShrink: 0,
};

const speedStyle: React.CSSProperties = {
  width: 64,
  textAlign: "right",
  flexShrink: 0,
  color: "var(--text-muted)",
};

const closeBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--text-muted)",
  cursor: "pointer",
  padding: 2,
  display: "flex",
  alignItems: "center",
  width: 64,
  justifyContent: "flex-end",
};
