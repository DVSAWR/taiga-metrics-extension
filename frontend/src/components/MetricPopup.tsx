import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Coordinate list controls that manage their own inline rows with MetricPopup. */
export function useExclusiveMetricList(close: () => void) {
  const owner = useRef({});
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const closeOther = (event: Event) => {
      if ((event as CustomEvent<unknown>).detail !== owner.current) closeRef.current();
    };
    window.addEventListener("metric-list-open", closeOther);
    return () => window.removeEventListener("metric-list-open", closeOther);
  }, []);
  return useCallback(
    () => window.dispatchEvent(new CustomEvent("metric-list-open", { detail: owner.current })),
    [],
  );
}

/** A number expands its list below its table row or the complete KPI grid. */
export function MetricPopup({
  label,
  children,
  content,
  onOpen,
  className = "count-open",
}: {
  label: string;
  children: ReactNode;
  content: ReactNode;
  onOpen?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [inlineHost, setInlineHost] = useState<HTMLElement | null>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const closeOther = (event: Event) => {
      if ((event as CustomEvent<HTMLButtonElement>).detail !== button.current) {
        setOpen(false);
        setInlineHost(null);
      }
    };
    window.addEventListener("metric-list-open", closeOther);
    return () => window.removeEventListener("metric-list-open", closeOther);
  }, []);

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const row = button.current.closest("tr");
    const tableBody = row?.parentElement;
    let host: HTMLElement;
    let contentHost: HTMLElement;
    let anchor: Element;
    if (row && tableBody && ["TBODY", "TFOOT"].includes(tableBody.tagName)) {
      const extraRow = document.createElement("tr");
      extraRow.className = "metric-expanded-row";
      const cell = document.createElement("td");
      cell.colSpan = Array.from(row.cells).reduce((width, item) => width + item.colSpan, 0);
      extraRow.append(cell);
      const list = document.createElement("div");
      list.className = "inline-metric-list";
      cell.append(list);
      host = extraRow;
      contentHost = list;
      anchor = row;
    } else {
      const list = document.createElement("div");
      const grid = button.current.closest(".key-numbers");
      list.className = `inline-metric-list metric-expanded-block${grid ? " card" : ""}`;
      host = list;
      contentHost = list;
      anchor = grid ?? button.current;
    }
    anchor.insertAdjacentElement("afterend", host);
    setInlineHost(contentHost);
    const observer = new MutationObserver(() => {
      if (anchor.isConnected && host.previousElementSibling !== anchor) {
        anchor.insertAdjacentElement("afterend", host);
      }
    });
    observer.observe(anchor.parentElement ?? document.body, { childList: true });
    return () => {
      observer.disconnect();
      host.remove();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`${className}${open ? " open" : ""}`}
        aria-label={label}
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          if (!open) {
            window.dispatchEvent(new CustomEvent("metric-list-open", { detail: button.current }));
            onOpen?.();
          }
          setInlineHost(null);
          setOpen(!open);
        }}
      >
        {children}
      </button>
      {open && inlineHost && createPortal(content, inlineHost)}
    </>
  );
}
