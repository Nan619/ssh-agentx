import { useEffect, useRef } from "react";
import { Copy, ClipboardPaste, Search, Upload, Download, CheckSquare } from "lucide-react";

interface ContextMenuProps {
  x: number;
  y: number;
  hasSelection: boolean;
  onCopy: () => void;
  onPaste: () => void;
  onSelectAll: () => void;
  onSearch: () => void;
  onUpload: () => void;
  onDownload: (pathHint: string | null) => void;
  pathHint: string | null;
  onClose: () => void;
}

export function TerminalContextMenu({
  x, y, hasSelection, onCopy, onPaste, onSelectAll,
  onSearch, onUpload, onDownload, pathHint, onClose,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // Adjust position to stay within viewport
  const adjustedX = Math.min(x, window.innerWidth - 220);
  const adjustedY = Math.min(y, window.innerHeight - 260);

  return (
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        left: adjustedX,
        top: adjustedY,
        zIndex: 1000,
        background: "var(--bg-tertiary)",
        border: "1px solid var(--border-color)",
        borderRadius: 6,
        padding: "4px 0",
        minWidth: 200,
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      }}
    >
      <MenuItem
        icon={<Copy size={14} />}
        label="复制"
        shortcut="Alt+C"
        disabled={!hasSelection}
        onClick={() => { onCopy(); onClose(); }}
      />
      <MenuItem
        icon={<ClipboardPaste size={14} />}
        label="粘贴"
        shortcut="Alt+V"
        onClick={() => { onPaste(); onClose(); }}
      />
      <MenuItem
        icon={<CheckSquare size={14} />}
        label="全选"
        onClick={() => { onSelectAll(); onClose(); }}
      />
      <Divider />
      <MenuItem
        icon={<Search size={14} />}
        label="搜索"
        shortcut="Ctrl+Shift+F"
        onClick={() => { onSearch(); onClose(); }}
      />
      <Divider />
      <MenuItem
        icon={<Upload size={14} />}
        label="SCP上传文件"
        onClick={() => { onUpload(); onClose(); }}
      />
      <MenuItem
        icon={<Download size={14} />}
        label="SCP下载文件"
        onClick={() => { onDownload(pathHint); onClose(); }}
      />
    </div>
  );
}

function MenuItem({
  icon, label, shortcut, disabled, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "6px 12px",
        background: "transparent",
        border: "none",
        color: disabled ? "var(--text-muted)" : "var(--text-primary)",
        cursor: disabled ? "default" : "pointer",
        fontSize: "var(--font-size-sm)",
        textAlign: "left",
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <span style={{ display: "flex", alignItems: "center", width: 16, flexShrink: 0 }}>
        {icon}
      </span>
      <span style={{ flex: 1 }}>{label}</span>
      {shortcut && (
        <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>{shortcut}</span>
      )}
    </button>
  );
}

function Divider() {
  return (
    <div style={{
      height: 1,
      background: "var(--border-color)",
      margin: "4px 8px",
    }} />
  );
}
