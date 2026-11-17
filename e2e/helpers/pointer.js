// A fake pointer for demos, which screen captures don't show, plus window
// sizing. The pointer lives in window.__demoDoc (set by resolveTarget()), so
// it shows in whichever window is being recorded. Every `el` argument is a JS
// expression, evaluated in the main window, that returns an element in that
// document.
import { evalJs, evalJson, waitFor } from "./obsidian";
import { resolveTarget } from "./recorder";
import { setOutcome } from "./rollover";

const POINTER_CSS = `
#demo-pointer { position: fixed; left: 50%; top: 50%; width: 22px; height: 30px; overflow: visible; pointer-events: none; z-index: 2147483647; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.4)); transition-property: left, top; transition-timing-function: ease-in-out; }
.demo-ripple { position: fixed; width: 36px; height: 36px; margin: -18px 0 0 -18px; border-radius: 50%; border: 3px solid var(--interactive-accent); pointer-events: none; z-index: 2147483646; animation: demo-ripple 450ms ease-out forwards; }
@keyframes demo-ripple { from { transform: scale(0.2); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }
`;

const ARROW = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="30" viewBox="0 0 22 30"><path d="M1 1 L1 23 L6.5 17.5 L10.5 26.5 L14 25 L10 16 L17.5 16 Z" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/></svg>`;

export const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Gives the main window a content area of `width` × `height` CSS pixels and,
 * when asked, collapses the side panels. restoreWindow() undoes it.
 */
export async function prepareWindow({ width, height, collapsePanels = false }) {
  await resolveTarget("main");
  await evalJs(`(() => {
    const win = window.__demoTarget;
    if (!window.__demoSaved) {
      window.__demoSaved = {
        bounds: win.getBounds(),
        maximized: win.isMaximized(),
        left: app.workspace.leftSplit.collapsed,
        right: app.workspace.rightSplit.collapsed,
      };
    }
    if (win.isMaximized()) win.unmaximize();
    const zoom = require('electron').webFrame.getZoomFactor();
    win.setContentSize(Math.round(${width} * zoom), Math.round(${height} * zoom));
    if (${collapsePanels}) {
      app.workspace.leftSplit.collapse();
      app.workspace.rightSplit.collapse();
    }
    return true;
  })()`);
  await waitFor(
    async () =>
      JSON.stringify(await evalJson("[innerWidth, innerHeight]")) ===
      JSON.stringify([width, height]),
    { message: `a ${width}×${height} window` }
  );
}

/** Puts back what prepareWindow() changed; nothing when it was not called. */
export async function restoreWindow() {
  const restored = await evalJson(`(() => {
    const saved = window.__demoSaved;
    if (!saved) return false;
    const win = require('@electron/remote').getCurrentWindow();
    win.setBounds(saved.bounds);
    if (saved.maximized) win.maximize();
    const split = (s, collapsed) => {
      if (s.collapsed !== collapsed) collapsed ? s.collapse() : s.expand();
    };
    split(app.workspace.leftSplit, saved.left);
    split(app.workspace.rightSplit, saved.right);
    delete window.__demoSaved;
    return saved.bounds;
  })()`);
  if (!restored) return;
  await waitFor(
    async () =>
      evalJson(
        `(() => { const b = require('@electron/remote').getCurrentWindow().getBounds(); return b.width === ${restored.width} && b.height === ${restored.height}; })()`
      ),
    { message: "the window's size to be restored" }
  );
}

/** Adds the pointer to window.__demoDoc, in the middle of its window. */
export async function showPointer() {
  await evalJs(`(() => {
    const doc = window.__demoDoc;
    if (!doc.getElementById('demo-pointer-style')) {
      const style = doc.createElement('style');
      style.id = 'demo-pointer-style';
      style.textContent = ${JSON.stringify(POINTER_CSS)};
      doc.head.appendChild(style);
    }
    if (!doc.getElementById('demo-pointer')) {
      const holder = doc.createElement('div');
      holder.innerHTML = ${JSON.stringify(ARROW)};
      const pointer = holder.firstElementChild;
      pointer.id = 'demo-pointer';
      doc.body.appendChild(pointer);
    }
    return true;
  })()`);
}

/** Glides the pointer's tip to the element's centre over `ms`. */
export async function moveTo(el, ms = 400) {
  const found = await evalJson(`(() => {
    const doc = window.__demoDoc;
    const pointer = doc.getElementById('demo-pointer');
    const target = (${el});
    if (!pointer || !target) return false;
    const r = target.getBoundingClientRect();
    pointer.style.transitionDuration = '${ms}ms';
    pointer.style.left = (r.left + r.width / 2) + 'px';
    pointer.style.top = (r.top + r.height / 2) + 'px';
    return true;
  })()`);
  if (!found) throw new Error(`moveTo: no pointer, or nothing at ${el}`);
  await pause(ms);
  // a window in the background can run the transition late
  await waitFor(
    async () =>
      evalJson(`(() => {
        const pointer = window.__demoDoc.getElementById('demo-pointer');
        const p = pointer.getBoundingClientRect();
        return Math.abs(p.left - parseFloat(pointer.style.left)) <= 1 &&
          Math.abs(p.top - parseFloat(pointer.style.top)) <= 1;
      })()`),
    { message: "the pointer to arrive", interval: 50 }
  );
}

async function ripple() {
  await evalJs(`(() => {
    const doc = window.__demoDoc;
    const pointer = doc.getElementById('demo-pointer');
    const r = pointer.getBoundingClientRect();
    const ring = doc.createElement('div');
    ring.className = 'demo-ripple';
    ring.style.left = r.left + 'px';
    ring.style.top = r.top + 'px';
    doc.body.appendChild(ring);
    doc.defaultView.setTimeout(() => ring.remove(), 500);
    return true;
  })()`);
}

/** Moves to the element, shows a click, then clicks it. */
export async function click(el) {
  await moveTo(el);
  await ripple();
  await pause(150);
  const clicked = await evalJson(
    `(() => { const t = (${el}); t?.click(); return Boolean(t); })()`
  );
  if (!clicked) throw new Error(`click: nothing at ${el}`);
}

/** The review dialog's dropdown for the row with this label, as an `el`. */
export function reviewSelect(label) {
  return `[...document.querySelectorAll('.modal .rollover-review > .setting-item')].find((item) => [...(item.querySelector('.setting-item-name')?.childNodes ?? [])].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim() === ${JSON.stringify(
    label
  )})?.querySelector('select')`;
}

/**
 * Changes a review row's outcome as a viewer would see it. The native list
 * can't be recorded, so the dropdown is outlined briefly instead.
 */
export async function choose(label, outcome) {
  const el = reviewSelect(label);
  await moveTo(el);
  await ripple();
  await pause(150);
  await setOutcome(label, outcome);
  await evalJs(`(() => {
    const select = (${el});
    select.style.outline = '3px solid var(--interactive-accent)';
    select.style.outlineOffset = '2px';
    window.setTimeout(() => { select.style.outline = ''; select.style.outlineOffset = ''; }, 600);
    return true;
  })()`);
}

/** Removes the pointer, any ripple and their styles. */
export async function removePointer() {
  await evalJs(`(() => {
    for (const doc of new Set([document, window.__demoDoc].filter(Boolean))) {
      doc.querySelectorAll('#demo-pointer, .demo-ripple, #demo-pointer-style').forEach((n) => n.remove());
    }
    return true;
  })()`);
}
