import { useEffect, useRef, useState } from "react";

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

  useEffect(() => {
    if (!open) {
      return;
    }
    const close = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
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
      {open && (
        <ul className="dropdown-menu" role="listbox" aria-label={label}>
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
        </ul>
      )}
    </div>
  );
}
