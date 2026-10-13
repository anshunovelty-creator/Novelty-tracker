// src/hooks/useListKeys.ts
// Keyboard for a type-to-search field with a suggestion list under it
// (party, PM code): ↓ / ↑ move through the list, Enter picks the highlighted
// one instead of submitting the form, Escape closes the list without
// closing the modal around it. The highlighted option scrolls into view, so
// a long list can be walked without the mouse.
//
// Spread `inputProps` on the <input>, `listProps` on the list and
// `optionProps(i)` on each option.

import { useEffect, useId, useState } from 'react';

export function useListKeys<T>({ items, open, onPick, onClose }: {
  items: T[];
  open: boolean;
  onPick: (item: T) => void;
  onClose: () => void;
}) {
  const [active, setActive] = useState(-1);
  const listId = useId();
  const optionId = (i: number) => `${listId}-${i}`;

  // A new list (new search, or reopened) starts with nothing highlighted.
  useEffect(() => { setActive(-1); }, [items, open]);

  useEffect(() => {
    if (active >= 0) document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === 'Escape') {
      e.stopPropagation();   // close the list, not the modal
      onClose();
      return;
    }
    if (items.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();    // pick, don't submit
      onPick(items[active]);
    }
  }

  return {
    active,
    inputProps: {
      role: 'combobox' as const,
      'aria-autocomplete': 'list' as const,
      'aria-expanded': open,
      'aria-controls': listId,
      'aria-activedescendant': open && active >= 0 ? optionId(active) : undefined,
      onKeyDown,
    },
    listProps: { id: listId, role: 'listbox' as const },
    optionProps: (i: number) => ({
      id: optionId(i),
      role: 'option' as const,
      'aria-selected': i === active,
      tabIndex: -1,
      onMouseEnter: () => setActive(i),
    }),
  };
}
