import { Server, Search, Settings } from "lucide-react";

type SidebarView = "hosts" | "search";

interface ActivityBarProps {
  activeView: SidebarView;
  onViewChange: (view: SidebarView) => void;
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
  onOpenSettings: () => void;
}

const actions: { id: SidebarView; icon: typeof Server; label: string }[] = [
  { id: "hosts", icon: Server, label: "主机列表" },
  { id: "search", icon: Search, label: "搜索" },
];

export function ActivityBar({
  activeView, onViewChange, sidebarVisible, onToggleSidebar,
  onOpenSettings,
}: ActivityBarProps) {
  return (
    <div style={{
      width: "var(--activity-bar-width)", minWidth: "var(--activity-bar-width)",
      background: "var(--activity-bar-bg)", display: "flex", flexDirection: "column",
      alignItems: "stretch", borderRight: "1px solid var(--border-color)",
    }}>
      {/* Top actions */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, paddingTop: 0, flex: 1 }}>
        {actions.map(({ id, icon: Icon, label }) => (
          <button key={id} onClick={() => {
            if (activeView === id && sidebarVisible) { onToggleSidebar(); }
            else { if (!sidebarVisible) onToggleSidebar(); onViewChange(id); }
          }} title={label} style={{
            ...iconButtonStyle,
            width: "100%",
            color: activeView === id ? "var(--text-primary)" : "var(--text-muted)",
            position: "relative",
          }}>
            {activeView === id && <div style={{
              position: "absolute", left: 0, top: 0, bottom: 0, width: 2,
              background: "var(--text-primary)", borderRadius: "0 2px 2px 0",
            }} />}
            <Icon size={24} />
          </button>
        ))}
      </div>

      {/* Bottom actions */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, paddingBottom: 8 }}>
        <button onClick={onOpenSettings} title="设置" style={iconButtonStyle}>
          <Settings size={24} />
        </button>
      </div>
    </div>
  );
}

const iconButtonStyle: React.CSSProperties = {
  width: 40, height: 40, display: "flex", alignItems: "center",
  justifyContent: "center", background: "transparent", border: "none",
  color: "var(--text-muted)", cursor: "pointer", borderRadius: 4,
  transition: "color 0.15s",
};
