/**
 * Helper DOM kecil untuk seluruh UI Shirabe.
 *
 * Semua konten dinamis (termasuk definisi dari dataset) masuk lewat `textContent`,
 * tidak pernah `innerHTML`, sehingga markup/script pada data kamus tidak dapat
 * dieksekusi (PRD 4.3, 10 Keamanan).
 */

export interface ElementOptions {
  className?: string;
  text?: string;
  attrs?: Record<string, string | number | boolean | undefined>;
  children?: readonly (Node | null | undefined)[];
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (options.className !== undefined) {
    element.className = options.className;
  }
  if (options.text !== undefined) {
    element.textContent = options.text;
  }
  if (options.attrs !== undefined) {
    for (const [name, value] of Object.entries(options.attrs)) {
      if (value !== undefined && value !== false) {
        element.setAttribute(name, value === true ? '' : String(value));
      }
    }
  }
  for (const child of options.children ?? []) {
    if (child !== null && child !== undefined) {
      element.append(child);
    }
  }
  return element;
}

export function clear(element: HTMLElement): void {
  element.replaceChildren();
}

/** Fokuskan elemen pertama yang dapat difokuskan, atau elemen itu sendiri. */
export function focusFirst(container: HTMLElement): void {
  const target = container.querySelector<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  (target ?? container).focus();
}
