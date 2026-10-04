"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";
import { interviewRoles } from "@/lib/interview/roles";
import { filterRoles } from "@/lib/interview/role-filter.mjs";

/**
 * Editable combobox with list autocomplete (WAI-ARIA APG): pick a suggested role or type any other.
 * Focus stays in the input; the highlighted option is exposed through aria-activedescendant.
 */
export function RoleCombobox({
  id,
  value,
  onChange,
  placeholder,
  invalid,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  // Typing filters; just opening the list (chevron / arrow) shows every role.
  const [filtering, setFiltering] = useState(false);

  const options = filtering ? filterRoles(interviewRoles, value) : [...interviewRoles];
  const expanded = open && options.length > 0;
  const optionId = (index: number) => `${listId}-option-${index}`;

  const choose = (role: string) => {
    onChange(role);
    setOpen(false);
    setFiltering(false);
    setActiveIndex(-1);
  };

  const move = (delta: number) => {
    if (!expanded) {
      setFiltering(false);
      setOpen(true);
      setActiveIndex(delta > 0 ? 0 : options.length - 1);
      return;
    }
    setActiveIndex((current) => (current + delta + options.length) % options.length);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        break;
      case "Home":
      case "End":
        if (expanded) {
          event.preventDefault();
          setActiveIndex(event.key === "Home" ? 0 : options.length - 1);
        }
        break;
      case "Enter":
        // Only intercept Enter when an option is highlighted; otherwise the form submits normally.
        if (expanded && activeIndex >= 0) {
          event.preventDefault();
          choose(options[activeIndex]);
        }
        break;
      case "Escape":
        if (expanded) {
          event.preventDefault();
          setOpen(false);
          setActiveIndex(-1);
        }
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={expanded && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        autoComplete="off"
        autoCapitalize="words"
        spellCheck={false}
        required
        className="ds-field pr-11"
        value={value}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
          setFiltering(true);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => {
          setFiltering(false);
          setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
          setActiveIndex(-1);
        }}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Mostrar sugestões de cargo"
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-[0.875rem] text-text-2"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (expanded) {
            setOpen(false);
          } else {
            inputRef.current?.focus();
            setFiltering(false);
            setOpen(true);
          }
        }}
      >
        <ChevronDown className="ds-chevron size-4" style={{ transform: expanded ? "rotate(180deg)" : undefined }} aria-hidden="true" />
      </button>
      {expanded && (
        <ul id={listId} role="listbox" aria-label="Cargos sugeridos" className="ds-combo-list">
          {options.map((role, index) => (
            <li
              key={role}
              id={optionId(index)}
              role="option"
              aria-selected={role === value}
              data-active={index === activeIndex}
              className="ds-combo-option"
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => setActiveIndex(index)}
              onClick={() => choose(role)}
            >
              {role}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
