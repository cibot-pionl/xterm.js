/**
 * Copyright (c) 2026 The xterm.js authors. All rights reserved.
 * @license MIT
 */

import { expect, test } from '@playwright/test';
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

test('the native scrollbar keeps its logical position across a page import', async ({ browser }) => {
  const ctx = await createTestContext(browser);
  try {
    await openTerminal(ctx, { cols: 10, rows: 4, smoothScrollDuration: 0 });
    await ctx.proxy.write('A\r\nB\r\nC\r\nD\r\nE\r\nF');
    const result = await ctx.termHandle.evaluate(async term => {
      const view = term.element!.ownerDocument.defaultView!;
      await new Promise<void>(resolve => view.requestAnimationFrame(() => view.requestAnimationFrame(() => resolve())));
      const buffer = term.buffer.normal;
      const slider = term.element!.querySelector<HTMLElement>('.xterm-scrollbar.xterm-vertical .xterm-slider')!;
      const thumb = () => ({ top: slider.offsetTop, height: slider.offsetHeight });
      const residentOnly = thumb().height;
      const head = term.registerMarker(-buffer.baseY - buffer.cursorY)!;
      const requests: string[] = [];
      term.setScrollbackViewport({
        getRange: () => ({ rows: 100, offset: 94 - head.line }),
        requestPage: direction => requests.push(direction)
      });

      term.scrollLines(-1);
      const before = thumb();
      const row = buffer.getLine(buffer.viewportY)?.translateToString(true);
      const inserted = await term.editScrollback([{ cells: [{ text: 'P', width: 1 }] }], {
        columns: term.cols, direction: 'older', head
      });
      const after = thumb();
      const sameRow = buffer.getLine(buffer.viewportY)?.translateToString(true) === row;
      term.scrollLines(-200);
      return { before, after, sameRow, inserted, residentOnly, requests, edge: buffer.viewportY };
    });
    deepStrictEqual(result.after, result.before);
    deepStrictEqual(result.sameRow, true);
    deepStrictEqual(result.inserted, 'inserted');
    deepStrictEqual(result.before.height < result.residentOnly, true, JSON.stringify(result));
    deepStrictEqual(result.requests, ['older']);
    deepStrictEqual(result.edge, 0);
  } finally {
    await ctx.page.close();
  }
});

test('the scrollbar track and thumb report logical seek targets while the wheel requests adjacent rows', async ({ browser }) => {
  const ctx = await createTestContext(browser);
  try {
    await openTerminal(ctx, { cols: 10, rows: 4, smoothScrollDuration: 0 });
    await ctx.proxy.write('A\r\nB\r\nC\r\nD\r\nE\r\nF');
    const calls = await ctx.termHandle.evaluateHandle(term => {
      const seeks: number[] = [];
      const requests: string[] = [];
      term.setScrollbackViewport({
        getRange: () => ({ rows: 100, offset: 40 }),
        requestPage: direction => requests.push(direction),
        seek: row => seeks.push(row)
      });
      return { seeks, requests };
    });
    const snapshot = () => calls.evaluate(value => value);
    const track = ctx.page.locator('.xterm-scrollbar.xterm-vertical');
    await track.hover();
    const trackBox = (await track.boundingBox())!;
    const thumbBox = (await track.locator('.xterm-slider').boundingBox())!;
    const x = thumbBox.x + thumbBox.width / 2;
    const y = thumbBox.y + thumbBox.height / 2;

    await ctx.page.mouse.click(x, trackBox.y + 1);
    await ctx.page.mouse.move(x, y);
    await ctx.page.mouse.down();
    await ctx.page.mouse.move(x, trackBox.y + trackBox.height - 1);
    await ctx.page.mouse.up();
    deepStrictEqual(await snapshot(), { seeks: [0, 96], requests: [] });
    deepStrictEqual(await ctx.termHandle.evaluate(term => term.buffer.normal.viewportY), 2);

    await ctx.page.locator('.xterm-screen').hover();
    await ctx.page.mouse.wheel(0, -100);
    await expect.poll(snapshot).toEqual({ seeks: [0, 96], requests: ['older'] });
  } finally {
    await ctx.page.close();
  }
});
