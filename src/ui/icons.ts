/** Inline SVG icon set (stroke-based, chunky, readable at thumb size). */
const svg = (inner: string, vb = '0 0 48 48') => `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

export const ICONS = {
  fire: svg('<circle cx="24" cy="24" r="12"/><path d="M24 4v8M24 36v8M4 24h8M36 24h8"/><circle cx="24" cy="24" r="2.5" fill="currentColor"/>'),
  ads: svg('<circle cx="24" cy="24" r="16"/><circle cx="24" cy="24" r="6"/><path d="M24 2v6M24 40v6M2 24h6M40 24h6"/>'),
  jump: svg('<path d="M24 38V12M12 22l12-12 12 12"/><path d="M14 44h20"/>'),
  crouch: svg('<path d="M24 8v24M12 22l12 12 12-12"/><path d="M10 42h28"/>'),
  reload: svg('<path d="M38 20a15 15 0 1 0 1 10"/><path d="M40 8v12H28"/>'),
  interact: svg('<path d="M18 26V10a4 4 0 0 1 8 0v12M26 20a4 4 0 0 1 8 0v4M34 23a4 4 0 0 1 7 2v7c0 7-5 12-12 12h-4c-5 0-8-3-11-7l-5-8a3.5 3.5 0 0 1 6-4l3 4"/>'),
  bug: svg('<ellipse cx="24" cy="27" rx="11" ry="10" fill="currentColor" fill-opacity="0.25"/><circle cx="19.5" cy="25" r="3" fill="currentColor"/><circle cx="28.5" cy="25" r="3" fill="currentColor"/><path d="M18 17l-4-7M30 17l4-7"/><path d="M13 30c-4 2-7 1-9-1M35 30c4 2 7 1 9-1"/>'),
  throwBug: svg('<path d="M6 38c6-18 18-28 34-28" stroke-dasharray="4 7"/><ellipse cx="38" cy="12" rx="6" ry="5.5" fill="currentColor"/><circle cx="10" cy="38" r="4"/>'),
  blink: svg('<path d="M10 24a14 14 0 1 1 6 11.5"/><path d="M24 14v10l6 4"/><path d="M6 34l4-10 9 5"/>'),
  heal: svg('<rect x="12" y="16" width="24" height="26" rx="6"/><path d="M14 10h20v6H14z"/><path d="M24 23v12M18 29h12"/>'),
  utility: svg('<circle cx="22" cy="28" r="12"/><path d="M28 16l6-6M31 7l6 6"/>'),
  heart: svg('<path d="M24 41S7 31 7 18a9 9 0 0 1 17-4 9 9 0 0 1 17 4c0 13-17 23-17 23z" fill="currentColor"/>'),
  tincan: svg('<path d="M4 22h24l6-4h10v8H34l-2 3H20l-4 9H8l3-9H4z" fill="currentColor" fill-opacity="0.3"/><circle cx="22" cy="31" r="5"/>'),
  pause: svg('<path d="M17 12v24M31 12v24"/>'),
  skull: svg('<path d="M24 6c-9 0-15 6-15 14 0 5 3 8 5 10v6h20v-6c2-2 5-5 5-10 0-8-6-14-15-14z"/><circle cx="18" cy="22" r="3" fill="currentColor"/><circle cx="30" cy="22" r="3" fill="currentColor"/>'),
  people: svg('<circle cx="17" cy="16" r="6"/><circle cx="33" cy="18" r="5"/><path d="M6 40c1-8 6-12 11-12s10 4 11 12M29 40c0-6 2-10 6-10s7 3 8 10"/>'),
};
