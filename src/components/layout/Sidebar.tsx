import { useState, useMemo, useRef, useEffect } from "react";
import { X, Plus, Search, FolderPlus, ChevronRight } from "lucide-react";
import { useHostStore, SshHost, SshGroup } from "../../stores/hostStore";
import { useToastStore } from "../../stores/toastStore";
import { useTerminalStore } from "../../stores/terminalStore";
import { ContextMenu, ContextMenuItem } from "../ui/ContextMenu";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent, type DragOverEvent, type DragStartEvent } from "@dnd-kit/core";
import { HostDragPreview } from "../host/HostDragPreview";

interface SidebarProps {
  view: "hosts" | "search";
  onClose: () => void;
  onHostConnect?: (host: SshHost) => void;
  onHostEdit?: (host: SshHost) => void;
  onAddHost?: (defaultGroup?: string) => void;
  width?: number;
}

type ContextTarget =
  | { kind: "host"; host: SshHost }
  | { kind: "group"; group: SshGroup }
  | { kind: "empty" };

export function Sidebar({ view, onClose, onHostConnect, onHostEdit, onAddHost, width = 280 }: SidebarProps) {
  const { hosts, groups, removeHost, addGroup, removeGroup, updateGroup, updateHost } = useHostStore();
  const addToast = useToastStore((s) => s.addToast);
  const [search, setSearch] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const newGroupInputRef = useRef<HTMLInputElement>(null);

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; target: ContextTarget } | null>(null);
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<SshGroup | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const [activeHost, setActiveHost] = useState<SshHost | null>(null);
  const hoverExpandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverGroupIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (creatingGroup) {
      newGroupInputRef.current?.focus();
    }
  }, [creatingGroup]);

  useEffect(() => {
    if (renamingGroupId) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingGroupId]);

  useEffect(() => {
    return () => {
      document.body.style.cursor = "";
      if (hoverExpandTimerRef.current) {
        clearTimeout(hoverExpandTimerRef.current);
      }
    };
  }, []);

  const filtered = hosts.filter(
    (h) =>
      h.name.toLowerCase().includes(search.toLowerCase()) ||
      h.hostname.toLowerCase().includes(search.toLowerCase()),
  );

  const groups_with_hosts = useMemo(() => {
    const map = new Map<string, SshHost[]>();
    // Include all groups from store (even empty ones)
    for (const g of groups) {
      map.set(g.name, []);
    }
    // Bucket hosts into groups
    for (const host of filtered) {
      const group = host.group_name || "未分组";
      const list = map.get(group) || [];
      list.push(host);
      map.set(group, list);
    }
    // Sort: named groups first (alphabetical), "未分组" last
    const sorted = [...map.entries()].sort(([a], [b]) => {
      if (a === "未分组") return 1;
      if (b === "未分组") return -1;
      return a.localeCompare(b);
    });
    return sorted;
  }, [filtered, groups]);

  const toggleGroup = (group: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group); else next.add(group);
      return next;
    });
  };

  const handleCreateGroup = () => {
    const name = newGroupName.trim();
    if (name) {
      addGroup(name);
      addToast({ type: "success", message: `分组 "${name}" 已创建` });
    }
    setNewGroupName("");
    setCreatingGroup(false);
  };

  const commitRename = () => {
    if (!renamingGroupId) return;
    const trimmed = renameInput.trim();
    const original = groups.find((g) => g.id === renamingGroupId);
    if (!trimmed || !original || trimmed === original.name) {
      setRenamingGroupId(null);
      setRenameInput("");
      return;
    }
    const dup = groups.some((g) => g.id !== renamingGroupId && g.name === trimmed);
    if (dup) {
      addToast({ type: "error", message: `分组名 "${trimmed}" 已存在` });
      return;
    }
    updateGroup(renamingGroupId, trimmed);
    setCollapsedGroups((prev) => {
      if (!prev.has(original.name)) return prev;
      const next = new Set(prev);
      next.delete(original.name);
      next.add(trimmed);
      return next;
    });
    addToast({ type: "success", message: `分组已重命名为 "${trimmed}"` });
    setRenamingGroupId(null);
    setRenameInput("");
  };

  const buildMenuItems = (target: ContextTarget): ContextMenuItem[] => {
    if (target.kind === "host") {
      const h = target.host;
      return [
        { label: "连接", onClick: () => onHostConnect?.(h) },
        { label: "编辑", onClick: () => onHostEdit?.(h) },
        { divider: true, label: "" },
        {
          label: "删除",
          danger: true,
          onClick: () => {
            removeHost(h.id);
            addToast({ type: "success", message: `已删除 ${h.name}` });
          },
        },
      ];
    }
    if (target.kind === "group") {
      const g = target.group;
      return [
        {
          label: "添加主机到此分组",
          onClick: () => onAddHost?.(g.name),
        },
        {
          label: "重命名",
          onClick: () => {
            setRenamingGroupId(g.id);
            setRenameInput(g.name);
          },
        },
        { divider: true, label: "" },
        {
          label: "删除分组",
          danger: true,
          onClick: () => setDeleteGroupTarget(g),
        },
      ];
    }
    return [
      { label: "新建主机", onClick: () => onAddHost?.() },
      { label: "新建分组", onClick: () => setCreatingGroup(true) },
    ];
  };

  const resetDragEphemera = () => {
    document.body.style.cursor = "";
    if (hoverExpandTimerRef.current) {
      clearTimeout(hoverExpandTimerRef.current);
      hoverExpandTimerRef.current = null;
    }
    hoverGroupIdRef.current = null;
    setActiveHost(null);
  };

  const handleDragStart = (e: DragStartEvent) => {
    const host = e.active.data.current?.host as SshHost | undefined;
    if (host) setActiveHost(host);
  };

  const handleDragOver = (e: DragOverEvent) => {
    const overId = e.over ? String(e.over.id) : null;
    document.body.style.cursor = e.over ? "grabbing" : "not-allowed";

    if (overId !== hoverGroupIdRef.current) {
      if (hoverExpandTimerRef.current) {
        clearTimeout(hoverExpandTimerRef.current);
        hoverExpandTimerRef.current = null;
      }
      hoverGroupIdRef.current = overId;

      if (overId && overId.startsWith("group:")) {
        const gName = e.over!.data.current?.groupName as string | undefined;
        if (gName && collapsedGroups.has(gName)) {
          hoverExpandTimerRef.current = setTimeout(() => {
            setCollapsedGroups((prev) => {
              if (!prev.has(gName)) return prev;
              const next = new Set(prev);
              next.delete(gName);
              return next;
            });
          }, 500);
        }
      }
    }
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    const activeH = e.active.data.current?.host as SshHost | undefined;
    const overData = e.over?.data.current as
      | { kind: "group"; groupName: string }
      | { kind: "ungrouped" }
      | undefined;
    resetDragEphemera();
    if (!activeH || !overData) return;
    const targetGroup =
      overData.kind === "ungrouped" ? null : overData.groupName;
    if ((activeH.group_name ?? null) === targetGroup) return;
    try {
      await updateHost({ ...activeH, group_name: targetGroup });
      addToast({
        type: "success",
        message: `已移动 ${activeH.name} 到 ${targetGroup ?? "未分组"}`,
      });
    } catch {
      addToast({
        type: "error",
        message: `移动 ${activeH.name} 失败`,
      });
    }
  };

  const handleDragCancel = () => {
    resetDragEphemera();
  };

  if (view === "hosts") {
    return (
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div style={{ ...sidebarBaseStyle, width, minWidth: width }}>
          <div style={headerStyle}>
            <span style={headerTitleStyle}>主机列表</span>
            <div style={{ display: "flex", gap: 2 }}>
              <HoverIconButton onClick={() => onAddHost?.()} title="新建主机">
                <Plus size={16} />
              </HoverIconButton>
              <HoverIconButton onClick={() => setCreatingGroup(true)} title="新建分组">
                <FolderPlus size={16} />
              </HoverIconButton>
              <HoverIconButton onClick={onClose} title="关闭">
                <X size={16} />
              </HoverIconButton>
            </div>
          </div>

          <div style={{ padding: "8px 12px 8px" }}>
            <div style={{ ...searchBoxStyle, borderColor: searchFocused ? "var(--accent)" : "var(--border-color)" }}>
              <Search size={14} style={{ color: searchFocused ? "var(--accent)" : "var(--text-muted)", flexShrink: 0 }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                placeholder="搜索主机..."
                style={searchInputStyle}
              />
            </div>
          </div>

          <div
            style={{ flex: 1, overflow: "auto" }}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtxMenu({ x: e.clientX, y: e.clientY, target: { kind: "empty" } });
            }}
          >
            {creatingGroup && (
              <div style={{ padding: "8px 12px" }}>
                <input
                  ref={newGroupInputRef}
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateGroup();
                    if (e.key === "Escape") { setCreatingGroup(false); setNewGroupName(""); }
                  }}
                  onBlur={() => { if (!newGroupName.trim()) { setCreatingGroup(false); setNewGroupName(""); } }}
                  placeholder="输入分组名称，回车确认"
                  style={{
                    width: "100%",
                    padding: "6px 10px",
                    background: "var(--bg-primary)",
                    border: "1px solid var(--border-color)",
                    borderRadius: 4,
                    color: "var(--text-primary)",
                    fontSize: "var(--font-size-sm)",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            )}
            {groups_with_hosts.map(([groupName, groupHosts]) => {
              const collapsed = collapsedGroups.has(groupName);
              const groupObj = groups.find((g) => g.name === groupName);
              const isRenaming = groupObj && renamingGroupId === groupObj.id;
              const droppableId = groupObj ? `group:${groupObj.id}` : "ungrouped";
              const droppableData = groupObj
                ? ({ kind: "group", groupName: groupObj.name } as const)
                : ({ kind: "ungrouped" } as const);
              return (
                <DroppableGroup key={groupName} id={droppableId} data={droppableData}>
                  <div
                    onClick={() => { if (!isRenaming) toggleGroup(groupName); }}
                    onContextMenu={(e) => {
                      if (!groupObj) return;
                      e.preventDefault();
                      e.stopPropagation();
                      setCtxMenu({ x: e.clientX, y: e.clientY, target: { kind: "group", group: groupObj } });
                    }}
                    style={groupHeaderStyle}
                  >
                    <ChevronRight
                      size={14}
                      style={{
                        transition: "transform 0.15s",
                        transform: collapsed ? "rotate(0deg)" : "rotate(90deg)",
                        flexShrink: 0,
                      }}
                    />
                    {isRenaming ? (
                      <input
                        ref={renameInputRef}
                        value={renameInput}
                        onChange={(e) => setRenameInput(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") { setRenamingGroupId(null); setRenameInput(""); }
                        }}
                        onBlur={commitRename}
                        style={{
                          flex: 1,
                          padding: "2px 6px",
                          background: "var(--bg-primary)",
                          border: "1px solid var(--accent)",
                          borderRadius: 3,
                          color: "var(--text-primary)",
                          fontSize: "11px",
                          textTransform: "none",
                          letterSpacing: 0,
                          outline: "none",
                        }}
                      />
                    ) : (
                      <>
                        <span style={{ fontWeight: 600 }}>{groupName}</span>
                        <span style={{ color: "var(--text-muted)", fontSize: "11px", marginLeft: "auto" }}>
                          {groupHosts.length}
                        </span>
                      </>
                    )}
                  </div>
                  {!collapsed && groupHosts.map((host) => (
                    <HostNode
                      key={host.id}
                      host={host}
                      onContextMenu={(x, y) =>
                        setCtxMenu({ x, y, target: { kind: "host", host } })
                      }
                      onConnect={() => onHostConnect?.(host)}
                    />
                  ))}
                </DroppableGroup>
              );
            })}
            {filtered.length === 0 && (
              <div style={emptyStyle}>
                {hosts.length === 0 ? "暂无主机，点击 + 添加" : "无匹配结果"}
              </div>
            )}
          </div>

          {ctxMenu && (
            <ContextMenu
              x={ctxMenu.x}
              y={ctxMenu.y}
              items={buildMenuItems(ctxMenu.target)}
              onClose={() => setCtxMenu(null)}
            />
          )}

          {deleteGroupTarget && (
            <ConfirmDialog
              title={`删除分组 "${deleteGroupTarget.name}"`}
              body={
                hosts.filter((h) => h.group_name === deleteGroupTarget.name).length > 0
                  ? `该分组下有 ${hosts.filter((h) => h.group_name === deleteGroupTarget.name).length} 台主机，删除后它们将移到"未分组"。主机数据不会丢失。`
                  : "确认删除该分组？"
              }
              confirmLabel="删除分组"
              danger
              onCancel={() => setDeleteGroupTarget(null)}
              onConfirm={() => {
                const target = deleteGroupTarget;
                removeGroup(target.id);
                setCollapsedGroups((prev) => {
                  if (!prev.has(target.name)) return prev;
                  const next = new Set(prev);
                  next.delete(target.name);
                  return next;
                });
                addToast({ type: "success", message: `分组 "${target.name}" 已删除` });
                setDeleteGroupTarget(null);
              }}
            />
          )}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeHost && <HostDragPreview host={activeHost} />}
        </DragOverlay>
      </DndContext>
    );
  }

  if (view === "search") {
    return (
      <div style={{ ...sidebarBaseStyle, width, minWidth: width }}>
        <div style={headerStyle}>
          <span style={headerTitleStyle}>搜索</span>
          <button onClick={onClose} title="关闭" style={iconBtnStyle}>
            <X size={16} />
          </button>
        </div>
        <div style={placeholderStyle}>全局搜索功能即将推出</div>
      </div>
    );
  }

  return null;
}

function DroppableGroup({
  id,
  data,
  children,
}: {
  id: string;
  data: { kind: "group"; groupName: string } | { kind: "ungrouped" };
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, data });
  return (
    <div
      ref={setNodeRef}
      style={{
        outline: isOver ? "1px solid var(--accent)" : "1px solid transparent",
        background: isOver
          ? "color-mix(in srgb, var(--accent) 12%, transparent)"
          : "transparent",
        borderRadius: 4,
      }}
    >
      {children}
    </div>
  );
}

function HoverIconButton({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      style={{ ...iconBtnStyle, background: hovered ? "var(--bg-hover)" : "transparent" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
    </button>
  );
}

function HostNode({
  host,
  onContextMenu,
  onConnect,
}: {
  host: SshHost;
  onContextMenu: (x: number, y: number) => void;
  onConnect: () => void;
}) {
  const terminals = useTerminalStore((s) => s.terminals);
  const isConnected = terminals.some(
    (t) => t.hostId === host.id && t.status === "connected",
  );
  const isConnecting = terminals.some(
    (t) => t.hostId === host.id && t.status === "connecting",
  );
  const statusColor = isConnected
    ? "var(--color-success)"
    : isConnecting
      ? "var(--color-warning)"
      : "var(--text-muted)";

  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: host.id,
    data: { host },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        padding: "6px 12px 6px 24px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        cursor: isDragging ? "grabbing" : "pointer",
        fontSize: "var(--font-size)",
        position: "relative",
        opacity: isDragging ? 0.4 : 1,
        touchAction: "none",
      }}
      onMouseEnter={(e) => {
        if (!isDragging) e.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(e) => {
        if (!isDragging) e.currentTarget.style.background = "transparent";
      }}
      onDoubleClick={onConnect}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e.clientX, e.clientY);
      }}
    >
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: statusColor,
          flexShrink: 0,
          animation: isConnecting ? "status-pulse 1.2s ease-in-out infinite" : undefined,
        }}
      />
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        <span style={{ fontWeight: 500 }}>{host.name}</span>
        <span style={{ color: "var(--text-muted)", marginLeft: 6, fontSize: "var(--font-size-sm)" }}>
          {host.username}@{host.hostname}
        </span>
      </span>
    </div>
  );
}

const sidebarBaseStyle: React.CSSProperties = {
  width: "var(--sidebar-default-width)",
  minWidth: "var(--sidebar-min-width)",
  background: "var(--bg-secondary)",
  borderRight: "1px solid var(--border-color)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  height: "var(--tab-height)",
  padding: "0 12px 0 16px",
};

const headerTitleStyle: React.CSSProperties = {
  fontSize: "11px",
  fontWeight: 600,
  textTransform: "uppercase" as const,
  letterSpacing: 1,
};

const iconBtnStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  border: "none",
  color: "var(--text-muted)",
  cursor: "pointer",
  borderRadius: 4,
};

const searchBoxStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "4px 8px",
  background: "var(--bg-primary)",
  border: "1px solid var(--border-color)",
  borderRadius: 4,
};

const searchInputStyle: React.CSSProperties = {
  flex: 1,
  background: "transparent",
  border: "none",
  outline: "none",
  color: "var(--text-primary)",
  fontSize: "var(--font-size-sm)",
};

const emptyStyle: React.CSSProperties = {
  padding: "16px 12px",
  color: "var(--text-muted)",
  fontSize: "var(--font-size-sm)",
  textAlign: "center",
};

const groupHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 12px 6px 12px",
  cursor: "pointer",
  fontSize: "11px",
  textTransform: "uppercase" as const,
  letterSpacing: 0.5,
  color: "var(--text-secondary)",
  userSelect: "none",
};

const placeholderStyle: React.CSSProperties = {
  padding: "16px 12px",
  color: "var(--text-muted)",
  fontSize: "var(--font-size-sm)",
  textAlign: "center",
};
