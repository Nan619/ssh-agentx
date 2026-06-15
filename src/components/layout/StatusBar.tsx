import { useTerminalStore, TerminalStatus } from "../../stores/terminalStore";

interface StatusBarProps {
  activeTerminalId: string | null;
}

const STATUS_COLORS: Record<TerminalStatus, string> = {
  connected: "var(--color-success)",
  connecting: "var(--color-warning)",
  disconnected: "var(--text-muted)",
};

const STATUS_LABELS: Record<TerminalStatus, string> = {
  connected: "已连接",
  connecting: "连接中...",
  disconnected: "未连接",
};

export function StatusBar({ activeTerminalId }: StatusBarProps) {
  const terminal = useTerminalStore((s) =>
    activeTerminalId ? s.terminals.find((t) => t.id === activeTerminalId) : null,
  );

  const status = terminal?.status ?? "disconnected";
  const label = terminal
    ? status === "connected" || status === "connecting"
      ? terminal.title
      : STATUS_LABELS[status]
    : STATUS_LABELS.disconnected;

  return (
    <div
      style={{
        height: "var(--status-bar-height)",
        minHeight: "var(--status-bar-height)",
        background: "var(--status-bar-bg)",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 12px",
        fontSize: "var(--font-size-sm)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: STATUS_COLORS[status],
            animation: status === "connecting" ? "status-pulse 1.2s ease-in-out infinite" : undefined,
          }}
        />
        <span>{label}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <span>UTF-8</span>
        <span>SSH Agent v0.1.0</span>
      </div>
    </div>
  );
}
