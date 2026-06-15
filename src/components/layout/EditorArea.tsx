import { useState, useCallback } from "react";
import { useTerminalStore, TerminalStatus } from "../../stores/terminalStore";
import { useAgentStore } from "../../stores/agentStore";
import { TerminalView } from "../terminal/TerminalView";
import { X, TerminalSquare } from "lucide-react";

interface EditorAreaProps {
  activeTerminalId: string | null;
  onActiveTerminalChange: (id: string | null) => void;
}

const STATUS_COLORS: Record<TerminalStatus, string> = {
  connected: "var(--color-success)",
  connecting: "var(--color-warning)",
  disconnected: "var(--text-muted)",
};

export function EditorArea({ activeTerminalId, onActiveTerminalChange }: EditorAreaProps) {
  const { terminals, addTerminal, removeTerminal, setActiveTerminal } = useTerminalStore();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);
  const [hoveredTab, setHoveredTab] = useState<string | null>(null);
  const [hoveredClose, setHoveredClose] = useState<string | null>(null);

  const handleCloseTab = useCallback((id: string) => {
    const idx = terminals.findIndex((t) => t.id === id);
    removeTerminal(id);
    useAgentStore.getState().removeSession(id);
    if (activeTerminalId === id) {
      const remaining = terminals.filter((t) => t.id !== id);
      if (remaining.length > 0) {
        const next = remaining[Math.min(idx, remaining.length - 1)];
        onActiveTerminalChange(next.id);
        setActiveTerminal(next.id);
      } else {
        onActiveTerminalChange(null);
      }
    }
  }, [terminals, activeTerminalId, removeTerminal, setActiveTerminal, onActiveTerminalChange]);

  const handleCloseOthers = useCallback((id: string) => {
    const keep = terminals.find((t) => t.id === id);
    terminals.forEach((t) => {
      if (t.id !== id) {
        removeTerminal(t.id);
        useAgentStore.getState().removeSession(t.id);
      }
    });
    if (keep) {
      onActiveTerminalChange(keep.id);
      setActiveTerminal(keep.id);
    }
  }, [terminals, removeTerminal, setActiveTerminal, onActiveTerminalChange]);

  const handleCloseRight = useCallback((id: string) => {
    const idx = terminals.findIndex((t) => t.id === id);
    const toClose = terminals.slice(idx + 1);
    toClose.forEach((t) => {
      removeTerminal(t.id);
      useAgentStore.getState().removeSession(t.id);
    });
    // If active tab was closed, switch to the target tab
    if (toClose.some((t) => t.id === activeTerminalId)) {
      onActiveTerminalChange(id);
      setActiveTerminal(id);
    }
  }, [terminals, activeTerminalId, removeTerminal, setActiveTerminal, onActiveTerminalChange]);

  const handleContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, tabId });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleSelectTab = (id: string) => {
    onActiveTerminalChange(id);
    setActiveTerminal(id);
  };

  return (
    <div style={containerStyle} onClick={contextMenu ? closeContextMenu : undefined}>
      {/* Tab bar — only shown when terminals exist */}
      {terminals.length > 0 && (
        <div style={tabBarStyle}>
          {/* inset box-shadow 画在 content 内侧，active tab 的 background 可直接覆盖它；
              border-bottom 不行，因为子元素无法遮盖父元素自己的 border。 */}
          <div style={{ display: "flex", flex: 1, overflow: "hidden", boxShadow: "inset 0 -1px 0 0 var(--border-color)" }}>
            {terminals.map((t, idx) => {
              const isActive = t.id === activeTerminalId;
              const isHovered = t.id === hoveredTab;
              const showClose = isActive || isHovered;
              // 右侧分割线：当前 tab 和下一个 tab 都不是 active 时才显示
              const nextTab = terminals[idx + 1];
              const showRightDivider = !isActive && nextTab && nextTab.id !== activeTerminalId;
              return (
                <div
                  key={t.id}
                  onClick={() => handleSelectTab(t.id)}
                  onContextMenu={(e) => handleContextMenu(e, t.id)}
                  onMouseEnter={() => setHoveredTab(t.id)}
                  onMouseLeave={() => { setHoveredTab(null); setHoveredClose(null); }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "0 10px",
                    cursor: "pointer",
                    fontSize: "var(--font-size-sm)",
                    userSelect: "none",
                    minWidth: 80,
                    maxWidth: 200,
                    position: "relative",
                    background: isActive ? "var(--tab-active-bg)" : isHovered ? "var(--bg-hover)" : "var(--tab-inactive-bg)",
                    borderTop: isActive ? "1px solid var(--accent)" : "1px solid transparent",
                    borderRight: showRightDivider ? "1px solid var(--border-color)" : "none",
                    // box-shadow inset 方案：inner 用 inset box-shadow 画底线，
                    // active tab 的 background 直接把 box-shadow 盖住，无需 borderBottom。
                    color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                  }}
                >
                  <TerminalSquare
                    size={13}
                    style={{
                      flexShrink: 0,
                      color: STATUS_COLORS[t.status],
                      opacity: t.status === "disconnected" ? 0.5 : 1,
                    }}
                  />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                    {t.title || "终端"}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleCloseTab(t.id); }}
                    onMouseEnter={() => setHoveredClose(t.id)}
                    onMouseLeave={() => setHoveredClose(null)}
                    style={{
                      ...tabCloseBtnStyle,
                      visibility: showClose ? "visible" : "hidden",
                      background: hoveredClose === t.id ? "var(--accent-subtle)" : "transparent",
                      color: hoveredClose === t.id ? "var(--color-error)" : "var(--text-muted)",
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Terminal area */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {terminals.length === 0 ? (
          <div style={emptyStateStyle}>
            <div style={{ color: "var(--text-muted)", fontSize: "var(--font-size)", textAlign: "center" }}>
              <TerminalSquare size={36} style={{ marginBottom: 12, opacity: 0.3 }} />
              <p>从左侧选择主机连接</p>
            </div>
          </div>
        ) : (
          terminals.map((t) => (
            <div
              key={t.id}
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                overflow: "hidden",
                visibility: t.id === activeTerminalId ? "visible" : "hidden",
                zIndex: t.id === activeTerminalId ? 1 : 0,
              }}
            >
              <TerminalView terminalId={t.id} isActive={t.id === activeTerminalId} />
            </div>
          ))
        )}
      </div>

      {/* Tab context menu */}
      {contextMenu && (() => {
        const ctxTab = terminals.find((t) => t.id === contextMenu.tabId);
        const canReconnect = ctxTab?.status === "disconnected" && ctxTab?.connectionParams != null;
        return (
          <div
            style={{
              position: "fixed",
              left: contextMenu.x,
              top: contextMenu.y,
              ...contextMenuStyle,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={() => { handleCloseTab(contextMenu.tabId); closeContextMenu(); }} style={contextMenuItemStyle}>
              关闭
            </button>
            <button
              onClick={() => { handleCloseOthers(contextMenu.tabId); closeContextMenu(); }}
              disabled={terminals.length <= 1}
              style={{ ...contextMenuItemStyle, opacity: terminals.length <= 1 ? 0.4 : 1 }}
            >
              关闭其他
            </button>
            <button
              onClick={() => { handleCloseRight(contextMenu.tabId); closeContextMenu(); }}
              disabled={terminals.findIndex((t) => t.id === contextMenu.tabId) >= terminals.length - 1}
              style={{
                ...contextMenuItemStyle,
                opacity: terminals.findIndex((t) => t.id === contextMenu.tabId) >= terminals.length - 1 ? 0.4 : 1,
              }}
            >
              关闭右侧
            </button>
            {canReconnect && (
              <>
                <div style={contextMenuDividerStyle} />
                <button
                  onClick={() => {
                    const t = addTerminal(ctxTab!.connectionParams!);
                    onActiveTerminalChange(t.id);
                    setActiveTerminal(t.id);
                    closeContextMenu();
                  }}
                  style={contextMenuItemStyle}
                >
                  重新连接
                </button>
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  background: "var(--bg-primary)",
  overflow: "hidden",
};

const tabBarStyle: React.CSSProperties = {
  display: "flex",
  height: "var(--tab-height)",
  background: "var(--tab-inactive-bg)",
  // 不在 tabBar 整体设 borderBottom —— 分割线改由各 tab 的 borderBottom 承担
  // active tab: borderBottom = var(--bg-primary)（与编辑器同色，视觉消失）
  // inactive / 右侧空白: borderBottom = var(--border-color)
};

const tabCloseBtnStyle: React.CSSProperties = {
  width: 18,
  height: 18,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  border: "none",
  color: "var(--text-muted)",
  cursor: "pointer",
  borderRadius: 3,
  flexShrink: 0,
};

const emptyStateStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const contextMenuStyle: React.CSSProperties = {
  background: "var(--bg-tertiary)",
  border: "1px solid var(--border-color)",
  borderRadius: 4,
  padding: "4px 0",
  zIndex: 200,
  minWidth: 120,
  boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
};

const contextMenuItemStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "6px 16px",
  background: "transparent",
  border: "none",
  color: "var(--text-primary)",
  cursor: "pointer",
  fontSize: "var(--font-size-sm)",
  textAlign: "left",
};

const contextMenuDividerStyle: React.CSSProperties = {
  height: 1,
  background: "var(--border-color)",
  margin: "4px 0",
};
