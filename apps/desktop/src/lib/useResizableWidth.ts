import { useRef, useState } from "react";

export interface UseResizableWidthOptions {
  /** localStorage key the chosen width is persisted under, per view. */
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  /** Leaves at least this much room for the rest of the layout, even on a small window. */
  minOppositeWidth: number;
  /**
   * Which edge of the resized panel the handle sits on: "right" for a panel
   * anchored to the left (dragging right grows it), "left" for a panel
   * anchored to the right (dragging left grows it).
   */
  handleEdge: "left" | "right";
}

function loadWidth(storageKey: string, defaultWidth: number): number {
  const raw = Number(localStorage.getItem(storageKey));
  return Number.isFinite(raw) && raw > 0 ? raw : defaultWidth;
}

/**
 * Drag-to-resize a panel's pixel width, persisted in localStorage. Attach
 * `containerRef` to the flex/grid container (used to cap the resize so the
 * rest of the layout keeps `minOppositeWidth`), and `startResize` to a
 * handle's `onMouseDown`.
 */
export function useResizableWidth({
  storageKey,
  defaultWidth,
  minWidth,
  minOppositeWidth,
  handleEdge,
}: UseResizableWidthOptions) {
  const [width, setWidth] = useState(() => loadWidth(storageKey, defaultWidth));
  const [resizing, setResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const containerWidth = containerRef.current?.clientWidth ?? Infinity;
    const maxWidth = Math.max(minWidth, containerWidth - minOppositeWidth);
    const sign = handleEdge === "right" ? 1 : -1;

    setResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    let latestWidth = startWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      latestWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + sign * (moveEvent.clientX - startX)));
      setWidth(latestWidth);
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setResizing(false);
      localStorage.setItem(storageKey, String(latestWidth));
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  return { width, resizing, containerRef, startResize };
}
