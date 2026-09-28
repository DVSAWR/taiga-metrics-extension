import { useEffect, type ReactNode } from "react";

export function SidePanel({
  title,
  onClose,
  children,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return (
    <div className="side-panel-layer" role="presentation" onClick={onClose}>
      <aside
        className="side-panel"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="side-panel-head">
          <h2>{title}</h2>
          <button type="button" className="side-panel-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="side-panel-body">{children}</div>
      </aside>
    </div>
  );
}
