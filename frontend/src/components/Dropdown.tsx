import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Icon } from "../icons";

export interface DropdownOption {
  value: string;
  label: string;
}

export function Dropdown({
  label,
  value,
  options,
  onChange,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, minWidth: 0, maxHeight: 0 });

  useEffect(() => {
    if (!open) {
      return;
    }
    const place = () => {
      const bounds = root.current?.getBoundingClientRect();
      if (!bounds) return;
      setPosition({
        top: bounds.bottom + 4,
        left: Math.max(
          8,
          Math.min(bounds.left, window.innerWidth - Math.max(bounds.width, 220) - 8),
        ),
        minWidth: bounds.width,
        maxHeight: Math.max(70, Math.min(288, window.innerHeight - bounds.bottom - 12)),
      });
    };
    const close = (event: MouseEvent) => {
      if (
        !root.current?.contains(event.target as Node) &&
        !menu.current?.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const current = options.find((option) => option.value === value);
  const shown = current?.label ?? placeholder ?? "";

  return (
    <div className={`dropdown${className ? ` ${className}` : ""}`} ref={root}>
      <button
        type="button"
        className="taiga-input dropdown-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        title={shown}
        onClick={() => setOpen(!open)}
      >
        <span className="dropdown-value">{shown}</span>
        <Icon name="chevronDown" />
      </button>
      {open &&
        createPortal(
          <ul
            ref={menu}
            className="dropdown-menu dropdown-menu-portal"
            role="listbox"
            aria-label={label}
            style={position}
          >
            {options.map((option) => (
              <li key={option.value} role="option" aria-selected={option.value === value}>
                <button
                  type="button"
                  className={option.value === value ? "active" : ""}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  {option.label}
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  );
}
