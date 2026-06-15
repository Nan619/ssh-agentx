import { useCallback, useRef } from "react";

interface ResizeHandleProps {
  position: "left" | "right";
  onResize: (width: number) => void;
  minWidth: number;
  currentWidth: number;
  /**
   * Width below which the panel auto-collapses during drag.
   * Must be less than minWidth.  Default: minWidth / 2.
   */
  collapseThreshold?: number;
  onCollapse?: () => void;
  /** Called when dragging back past collapseThreshold to re-expand the panel. */
  onExpand?: () => void;
}

export function ResizeHandle({
  position,
  onResize,
  minWidth,
  currentWidth,
  collapseThreshold = Math.floor(minWidth / 2),
  onCollapse,
  onExpand,
}: ResizeHandleProps) {
  const dragging = useRef(false);
  const widthRef = useRef(currentWidth);
  widthRef.current = currentWidth;

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragging.current = true;

      const startX = e.clientX;
      const startWidth = widthRef.current;
      let collapsed = startWidth < minWidth;

      const cleanup = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      const handleMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;

        const delta = position === "left"
          ? ev.clientX - startX
          : startX - ev.clientX;
        const rawWidth = startWidth + delta;

        // Bidirectional collapse / expand during a single drag gesture
        if (collapsed) {
          if (onExpand && rawWidth >= collapseThreshold) {
            collapsed = false;
            onExpand();
          }
        } else {
          if (onCollapse && rawWidth < collapseThreshold) {
            collapsed = true;
            onCollapse();
          }
        }

        // Don't update panel width while collapsed (nothing to resize)
        if (!collapsed) {
          onResize(Math.max(minWidth, rawWidth));
        }
      };

      const handleMouseUp = () => {
        if (dragging.current) {
          cleanup();
          if (!collapsed && widthRef.current < minWidth) {
            onResize(minWidth);
          }
        }
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [position, onResize, minWidth, collapseThreshold, onCollapse, onExpand],
  );

  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        width: 4,
        minWidth: 4,
        cursor: "col-resize",
        background: "transparent",
        transition: "background 0.15s",
        zIndex: 10,
        flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--accent)";
      }}
      onMouseLeave={(e) => {
        if (!dragging.current) {
          e.currentTarget.style.background = "transparent";
        }
      }}
    />
  );
}
