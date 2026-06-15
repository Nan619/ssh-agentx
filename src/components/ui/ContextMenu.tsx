import { useEffect, useRef } from "react";

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  divider?: boolean;
}

export interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

const MENU_WIDTH = 200;
const APPROX_ITEM_HEIGHT = 28;
const DIVIDER_HEIGHT = 9;

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onCloseRef.current();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, []);

  const approxHeight =
    items.reduce(
      (sum, it) => sum + (it.divider ? DIVIDER_HEIGHT : APPROX_ITEM_HEIGHT),
      0,
    ) + 8;
  const adjustedX = Math.min(x, window.innerWidth - MENU_WIDTH - 4);
  const adjustedY = Math.min(y, window.innerHeight - approxHeight - 4);

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
        minWidth: MENU_WIDTH,
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      }}
    >
      {items.map((item, idx) => {
        if (item.divider) {
          return (
            <div
              key={`div-${idx}`}
              style={{
                height: 1,
                background: "var(--border-color)",
                margin: "4px 8px",
              }}
            />
          );
        }
        return (
          <button
            key={`${item.label}-${idx}`}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              item.onClick?.();
              onClose();
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "6px 12px",
              background: "transparent",
              border: "none",
              color: item.disabled
                ? "var(--text-muted)"
                : item.danger
                  ? "var(--color-error)"
                  : "var(--text-primary)",
              cursor: item.disabled ? "default" : "pointer",
              fontSize: "var(--font-size-sm)",
              textAlign: "left",
              opacity: item.disabled ? 0.5 : 1,
            }}
            onMouseEnter={(e) => {
              if (!item.disabled)
                e.currentTarget.style.background = "var(--bg-hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            {item.icon && (
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  width: 16,
                  flexShrink: 0,
                }}
              >
                {item.icon}
              </span>
            )}
            <span style={{ flex: 1 }}>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
