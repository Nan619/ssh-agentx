import { SshHost } from "../../stores/hostStore";

export function HostDragPreview({ host }: { host: SshHost }) {
  return (
    <div style={containerStyle}>
      <div style={dotStyle} />
      <span style={{ fontWeight: 500 }}>{host.name}</span>
      <span style={{ color: "var(--text-muted)" }}>
        {host.username}@{host.hostname}
      </span>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "4px 10px",
  background: "var(--bg-tertiary)",
  border: "1px solid var(--border-color)",
  borderRadius: 4,
  boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
  fontSize: "var(--font-size-sm)",
  color: "var(--text-primary)",
  minWidth: 180,
  maxWidth: 280,
  overflow: "hidden",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
  cursor: "grabbing",
};

const dotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: "50%",
  background: "var(--text-muted)",
  flexShrink: 0,
};
