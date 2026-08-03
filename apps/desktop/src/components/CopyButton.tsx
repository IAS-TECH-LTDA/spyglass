import { useEffect, useRef, useState } from "react";

export interface CopyButtonProps {
  /** Text to copy, or a lazy getter — useful when building the string (e.g. cURL) is only worth doing on click. */
  text: string | (() => string);
  title?: string;
  /** sm = 14px icon for dense rows (log lines, list items); md = default for detail-panel buttons. */
  size?: "sm" | "md";
  className?: string;
}

type Status = "idle" | "copied" | "failed";

const RESET_DELAY_MS = 1200;

export function CopyButton({ text, title, size = "md", className = "" }: CopyButtonProps) {
  const [status, setStatus] = useState<Status>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleClick = async (event: React.MouseEvent) => {
    // CopyButton usually lives inside a clickable row (log line, network
    // list item) — don't let the click also select/toggle that row.
    event.stopPropagation();

    const value = typeof text === "function" ? text() : text;
    try {
      await navigator.clipboard.writeText(value);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setStatus("idle"), RESET_DELAY_MS);
  };

  const dimension = size === "sm" ? 14 : 16;

  return (
    <button
      type="button"
      className={`icon-btn copy-btn copy-btn-${size} ${status === "copied" ? "copied" : ""} ${className}`}
      title={status === "failed" ? "Copy failed" : (title ?? "Copy")}
      aria-label={title ?? "Copy"}
      onClick={handleClick}
    >
      {status === "copied" ? (
        <svg width={dimension} height={dimension} viewBox="0 0 16 16" fill="none">
          <path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : status === "failed" ? (
        <svg width={dimension} height={dimension} viewBox="0 0 16 16" fill="none">
          <path d="M8 4v5M8 11.5v.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width={dimension} height={dimension} viewBox="0 0 16 16" fill="none">
          <rect x="5.5" y="5.5" width="8" height="8" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
          <path d="M3.5 10.5V3.9A1.4 1.4 0 0 1 4.9 2.5h6.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}
