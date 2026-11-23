/**
 * Copyright (c) 2026 The xterm.js authors. All rights reserved.
 * @license MIT
 */

import { test } from '@playwright/test';
import { deepStrictEqual } from 'assert';
import { createTestContext, openTerminal } from './TestUtils';

test('a page edit rebases the next scroll and keeps the selection attached to its text', async ({ browser }) => {
  const ctx = await createTestContext(browser);
  try {
    await openTerminal(ctx, { cols: 10, rows: 2, smoothScrollDuration: 0 });
    await ctx.proxy.write('A\r\nB\r\nC\r\nD\r\nE\r\nF');
    const state = await ctx.termHandle.evaluate(async term => {
      const buffer = term.buffer.normal;
      term.scrollToTop();
      term.select(0, 1, 1);
      const head = term.registerMarker(-buffer.baseY - buffer.cursorY)!;
      const inserted = await term.editScrollback([{ cells: [{ text: 'P', width: 1 }] }], { columns: term.cols, direction: 'older', head });

      // A second scroll must start at the rebased position even before the next animation frame.
      term.scrollLines(1);
      const afterScroll = buffer.viewportY;
      const active = term.setScrollbackWindowActive(true);
      const updated = await term.editScrollback([{ cells: [{ text: 'Q', width: 1 }] }], {
        columns: term.cols, direction: 'newer', discard: 1
      });
      term.scrollLines(1);
      const retained = { viewport: buffer.viewportY, text: term.getSelection(), range: term.getSelectionPosition(), head: head.line };

      term.select(0, 0, 1);
      const discarded = await term.editScrollback([{ cells: [{ text: 'R', width: 1 }] }], {
        columns: term.cols, direction: 'newer', discard: 1
      });
      return { inserted, afterScroll, active, updated, retained, discarded, hasSelection: term.hasSelection(), headDisposed: head.isDisposed };
    });
    deepStrictEqual(state, {
      inserted: 'inserted', afterScroll: 2, active: true, updated: 'inserted',
      retained: { viewport: 2, text: 'B', range: { start: { x: 0, y: 1 }, end: { x: 1, y: 1 } }, head: 0 },
      discarded: 'inserted', hasSelection: false, headDisposed: true
    });
  } finally {
    await ctx.page.close();
  }
});
