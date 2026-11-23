/**
 * Copyright (c) 2026 The xterm.js authors. All rights reserved.
 * @license MIT
 */

import { Terminal, type IScrollbackRow } from '@xterm/xterm';

type Direction = 'older' | 'newer';

const enum Demo {
  COLS = 76,
  ROWS = 24,
  RECENT_ROWS = 48,
  PAGE_ROWS = 48,
  SCROLLBACK = 144,
  PREFETCH_ROWS = 48,
  FIRST_ROW = 1,
  INITIAL_OUTPUT_ROW = 24000,
  READ_DELAY = 180,
  OUTPUT_INTERVAL = 250
}

const output = document.querySelector<HTMLElement>('#terminal')!;
const live = document.querySelector<HTMLInputElement>('#live')!;
const readStatus = document.querySelector<HTMLElement>('#status')!;
const bufferStatus = document.querySelector<HTMLElement>('#buffer')!;

const terminal = new Terminal({
  allowProposedApi: true,
  cols: Demo.COLS,
  rows: Demo.ROWS,
  scrollback: Demo.SCROLLBACK,
  smoothScrollDuration: 0,
  theme: { background: '#161716', foreground: '#f8f8f8' }
});
const lifetime = new AbortController();
let nextOutputRow: number = Demo.INITIAL_OUTPUT_ROW;
let lastParsedRow: number = Demo.INITIAL_OUTPUT_ROW;
let firstArchivedRow: number | undefined;
let requesting = false;
let viewportY = 0;

function label(row: number): string {
  return `HISTORY_${String(row).padStart(6, '0')}`;
}

// Live writes use ANSI. The provider returns display cells with the same styles and widths.
function outputRow(row: number): string {
  return `\x1b[1;38;5;81m${label(row)}\x1b[0m  build output  \x1b[38;2;240;145;70m中\x1b[0m e\u0301`;
}

function historyRow(row: number): IScrollbackRow {
  return {
    cells: [
      ...Array.from(label(row), text => ({ text, width: 1 as const, foreground: { kind: 'palette' as const, value: 81 }, bold: true })),
      ...Array.from('  build output  ', text => ({ text, width: 1 as const })),
      { text: '中', width: 2, foreground: { kind: 'rgb', value: 0xf09146 } },
      { text: ' ', width: 1 },
      { text: 'e\u0301', width: 1 }
    ]
  };
}

// Each generated row is a complete logical line, so an ID maps directly to a physical row.
async function readRows(first: number, count: number): Promise<IScrollbackRow[]> {
  await new Promise<void>(resolve => window.setTimeout(resolve, Demo.READ_DELAY));
  return Array.from({ length: count }, (_, index) => historyRow(first + index));
}

function liveStart(): number {
  return lastParsedRow - terminal.rows + 1;
}

function updateStatus(): void {
  const buffer = terminal.buffer.normal;
  const first = firstArchivedRow ?? liveStart() - buffer.baseY;
  const mode = firstArchivedRow === undefined ? 'Live buffer' : 'Reading history';
  bufferStatus.textContent = `${mode} · ${buffer.baseY}/${Demo.SCROLLBACK} history rows · First visible row ${first + buffer.viewportY} · Latest output row ${lastParsedRow}`;
}

// Rejoin when the loaded archive ends at the first row of the live screen.
// Until then, newer pages fill the missing rows between the two ranges.
function rejoin(): void {
  if (terminal.setScrollbackWindowActive(false)) {
    firstArchivedRow = undefined;
  }
}

async function requestPage(direction: Direction): Promise<void> {
  const buffer = terminal.buffer.normal;
  const columns = terminal.cols;
  const detached = firstArchivedRow !== undefined;
  const first = firstArchivedRow ?? liveStart() - buffer.baseY;
  const end = first + buffer.baseY;
  const older = direction === 'older';
  const count = Math.min(Demo.PAGE_ROWS, older ? first - Demo.FIRST_ROW : liveStart() - end);
  if (!older && !detached) {
    return;
  }
  if (count <= 0) {
    if (older) {
      readStatus.textContent = 'First history row reached.';
    } else {
      rejoin();
      readStatus.textContent = '';
      updateStatus();
    }
    return;
  }

  // With a live buffer, use a row-zero marker to detect trim during the provider read.
  const head = detached ? undefined : terminal.registerMarker(-buffer.baseY - buffer.cursorY);
  const pageStart = older ? first - count : end;
  requesting = true;
  readStatus.textContent = older ? 'Loading earlier rows…' : 'Loading newer rows…';
  try {
    const rows = await readRows(pageStart, count);
    if (lifetime.signal.aborted) {
      return;
    }
    if (head?.isDisposed || (firstArchivedRow ?? liveStart() - buffer.baseY) !== first) {
      readStatus.textContent = 'Scroll again to retry the page.';
      return;
    }

    // A full reading window discards rows from the opposite edge. Core checks
    // that the visible rows still fit in the retained range after pending writes.
    const discard = detached ? Math.max(0, buffer.baseY + rows.length - Demo.SCROLLBACK) : 0;
    const result = await terminal.editScrollback(rows, { columns, direction, discard, head, signal: lifetime.signal });
    if (result === 'inserted' && detached) {
      firstArchivedRow = older ? pageStart : first + discard;
      if (!older && end + count === liveStart()) {
        rejoin();
      }
    }
    readStatus.textContent = result === 'inserted' ? '' : 'Scroll again to retry the page.';
  } catch {
    readStatus.textContent = 'Could not load the page. Scroll again to retry.';
  } finally {
    head?.dispose();
    requesting = false;
    if (!lifetime.signal.aborted) {
      updateStatus();
    }
  }
}

function navigate(direction: Direction): void {
  if (requesting) {
    return;
  }
  const buffer = terminal.buffer.normal;
  if (direction === 'older' && firstArchivedRow === undefined &&
      buffer.viewportY + terminal.rows <= buffer.baseY) {
    const first = liveStart() - buffer.baseY;
    if (terminal.setScrollbackWindowActive(true)) {
      firstArchivedRow = first;
      updateStatus();
    }
  }

  const nearBoundary = direction === 'older'
    ? buffer.viewportY <= Demo.PREFETCH_ROWS
    : firstArchivedRow !== undefined &&
      buffer.baseY - terminal.rows - buffer.viewportY <= Demo.PREFETCH_ROWS;
  if (nearBoundary) {
    void requestPage(direction);
  }
}

terminal.open(output);
const firstRecent = Demo.INITIAL_OUTPUT_ROW - Demo.RECENT_ROWS - Demo.ROWS + 1;
const seed = Array.from({ length: Demo.RECENT_ROWS + Demo.ROWS }, (_, index) => outputRow(firstRecent + index));
terminal.write(seed.join('\r\n'), () => {
  viewportY = terminal.buffer.normal.viewportY;
  terminal.onScroll(position => {
    const previous = viewportY;
    viewportY = position;
    updateStatus();
    // At capacity, live writes trim the oldest row and can move the viewport
    // index backward. Only treat position changes outside a live write as navigation.
    if (position !== previous && lastParsedRow === nextOutputRow) {
      navigate(position < previous ? 'older' : 'newer');
    }
  });

  // At either edge, the viewport cannot move and onScroll does not fire.
  // The wheel gesture still lets the reader request the next page.
  output.addEventListener('wheel', event => {
    if (event.deltaY && !event.ctrlKey) {
      navigate(event.deltaY < 0 ? 'older' : 'newer');
    }
  }, { capture: true, passive: true, signal: lifetime.signal });
  live.disabled = false;
  readStatus.textContent = '';
  updateStatus();
});

const interval = window.setInterval(() => {
  if (live.checked) {
    const row = ++nextOutputRow;
    terminal.write(`\r\n${outputRow(row)}`, () => {
      lastParsedRow = row;
      updateStatus();
    });
  }
}, Demo.OUTPUT_INTERVAL);

window.addEventListener('pagehide', event => {
  if (!event.persisted) {
    lifetime.abort();
    window.clearInterval(interval);
    terminal.dispose();
  }
});
