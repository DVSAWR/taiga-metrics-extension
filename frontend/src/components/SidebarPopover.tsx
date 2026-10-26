import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Small menu for sidebar actions; metric numbers use inline lists instead. */
export function SidebarPopover({
  label,
  children,
  content,
}: {
  label: string;
  children: ReactNode;
  content: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const bounds = button.current?.getBoundingClientRect();
      if (!bounds) return;
      const width = Math.min(280, window.innerWidth - 24);
      setPosition({
        top: Math.min(bounds.bottom + 4, window.innerHeight - 100),
        left: Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12)),
        width,
      });
    };
    const outside = (event: MouseEvent) => {
      if (
        !button.current?.contains(event.target as Node) &&
        !panel.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`sidebar-action${open ? " open" : ""}`}
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            role="region"
            aria-label={label}
            className="metric-popup"
            style={{ top: position.top, left: position.left, width: position.width }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
