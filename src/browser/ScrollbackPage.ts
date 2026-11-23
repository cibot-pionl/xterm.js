/**
 * Copyright (c) 2026 The xterm.js authors. All rights reserved.
 * @license MIT
 */

import type { IScrollbackRow, ScrollbackColor } from '@xterm/xterm';
import { BufferLine } from '../common/buffer/BufferLine';
import { CellData } from '../common/buffer/CellData';
import { Attributes, BgFlags, FgFlags } from '../common/buffer/Constants';
import type { CharData } from '../common/buffer/Types';

// oxlint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\x00-\x1f\x7f-\x9f]/;

export const enum ScrollbackPageLimits {
  ADJACENT_PAGE = 65_536
}

/** Translate public palette/RGB colors into xterm cell flags, rejecting out-of-range values. */
function encodeColor(color: ScrollbackColor | undefined): number | undefined {
  if (color === undefined) {
    return 0;
  }
  if (!Number.isInteger(color.value) || color.value < 0) {
    return undefined;
  }
  switch (color.kind) {
    case 'palette':
      return color.value <= 255 ? Attributes.CM_P256 | color.value : undefined;
    case 'rgb':
      return color.value <= Attributes.RGB_MASK ? Attributes.CM_RGB | color.value : undefined;
  }
}

/**
 * Materialize an oldest-first page at its recorded width before queuing it.
 * Addons supply printable cells. Only core constructs native wide-cell trailers
 * and color flags. Reject the entire page if any row exceeds the bounds.
 */
export function createScrollbackLines(
  rows: ReadonlyArray<IScrollbackRow>, columns: number, limit: number = ScrollbackPageLimits.ADJACENT_PAGE
): BufferLine[] | undefined {
  if (!rows.length || rows[0].isWrapped || rows.length * columns > limit) {
    return undefined;
  }

  let textLength = 0;
  const lines: BufferLine[] = [];
  const cell = new CellData();
  const charData: CharData = [0, '', 1, 0];
  for (const row of rows) {
    if (row.cells.length > columns) {
      return undefined;
    }
    const line = new BufferLine(columns, undefined, row.isWrapped);
    let column = 0;
    for (const { text, width, foreground, background, bold, italic, underline } of row.cells) {
      if ((width !== 1 && width !== 2) || column + width > columns || typeof text !== 'string' ||
          text.length > limit - textLength || CONTROL_CHARACTER.test(text) || (width === 2 && !text)) {
        return undefined;
      }
      textLength += text.length;

      const fg = encodeColor(foreground);
      const bg = encodeColor(background);
      if (fg === undefined || bg === undefined) {
        return undefined;
      }
      charData[1] = text;
      charData[2] = width;
      cell.setFromCharData(charData);
      cell.fg = fg | (bold ? FgFlags.BOLD : 0) | (underline ? FgFlags.UNDERLINE : 0);
      cell.bg = bg | (italic ? BgFlags.ITALIC : 0);
      line.setCell(column, cell);
      if (width === 2) {
        line.setCellFromCodepoint(column + 1, 0, 0, cell);
      }
      column += width;
    }
    lines.push(line);
  }
  return lines;
}
