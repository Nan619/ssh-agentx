import { Bot, Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface TitleBarProps {
  agentPanelVisible: boolean;
  onToggleAgentPanel: () => void;
}

export function TitleBar({ agentPanelVisible, onToggleAgentPanel }: TitleBarProps) {
  const appWindow = getCurrentWindow();

  return (
    <div
      data-tauri-drag-region
      style={{
        height: 32,
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        background: "var(--title-bar-bg)",
        borderBottom: "1px solid var(--border-color)",
        userSelect: "none",
        flexShrink: 0,
      }}
    >
      {/* App icon */}
      <div style={{ display: "flex", alignItems: "center", paddingLeft: 4, marginRight: "auto" }}>
        <img src="/icon.ico" alt="" style={{ width: 16, height: 16 }} />
      </div>

      {/* Agent toggle */}
      <button
        onClick={onToggleAgentPanel}
        title={agentPanelVisible ? "隐藏 Agent" : "显示 Agent"}
        style={{
          ...titleBarBtnStyle,
          color: agentPanelVisible ? "var(--accent)" : "var(--text-muted)",
        }}
      >
        <Bot size={14} />
      </button>

      {/* Window controls */}
      <button onClick={() => appWindow.minimize()} title="最小化" style={titleBarBtnStyle}>
        <Minus size={14} />
      </button>
      <button onClick={() => appWindow.toggleMaximize()} title="最大化" style={titleBarBtnStyle}>
        <Square size={12} />
      </button>
      <button
        onClick={() => appWindow.close()}
        title="关闭"
        style={{ ...titleBarBtnStyle, borderRadius: 0 }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--color-error)"; e.currentTarget.style.color = "#fff"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

const titleBarBtnStyle: React.CSSProperties = {
  width: 46,
  height: 32,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  border: "none",
  color: "var(--text-muted)",
  cursor: "pointer",
};
