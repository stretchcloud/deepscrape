import * as cheerio from 'cheerio';

/**
 * Automatic HTML `<table>` extraction into structured JSON.
 *
 * an upstream project exposes `result.tables`; this is the equivalent. It parses every
 * `<table>` in a document into `{ headers, rows }`, handling `<thead>`/`<tbody>`,
 * header rows without `<thead>`, `colspan`, and caption text. Pure/testable —
 * takes an HTML string, returns plain objects, never throws.
 */

export interface ExtractedTable {
  caption?: string;
  headers: string[];
  rows: string[][];
  rowCount: number;
  columnCount: number;
}

/** Expand a cell's colspan into N identical-position slots (value only in the first). */
function cellsOf($: cheerio.CheerioAPI, $row: cheerio.Cheerio<any>): string[] {
  const out: string[] = [];
  $row.children('td,th').each((_i, el) => {
    const $cell = $(el);
    const text = $cell.text().replace(/\s+/g, ' ').trim();
    const span = Math.max(1, parseInt($cell.attr('colspan') || '1', 10) || 1);
    out.push(text);
    for (let s = 1; s < span; s++) out.push('');
  });
  return out;
}

/** Extract all tables from an HTML document. */
export function extractTables(html: string): ExtractedTable[] {
  if (!html) return [];
  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(html);
  } catch {
    return [];
  }

  const tables: ExtractedTable[] = [];

  $('table').each((_i, tableEl) => {
    try {
      const $table = $(tableEl);
      const caption = $table.children('caption').first().text().replace(/\s+/g, ' ').trim() || undefined;

      let headers: string[] = [];
      const bodyRows: string[][] = [];

      // Prefer an explicit <thead>.
      const $thead = $table.children('thead').first();
      if ($thead.length) {
        const headRow = $thead.find('tr').first();
        if (headRow.length) headers = cellsOf($, headRow);
      }

      // Rows: <tbody> rows if present, else all <tr> not in <thead>.
      const $bodyRows = $table.children('tbody').length
        ? $table.children('tbody').find('tr')
        : $table.find('tr');

      $bodyRows.each((idx, trEl) => {
        const $tr = $(trEl);
        // Skip rows that live inside the thead.
        if ($tr.closest('thead').length) return;
        const cells = cellsOf($, $tr);
        // If no <thead> was found, treat the first all-<th> row as the header.
        if (headers.length === 0 && $tr.children('th').length > 0 && $tr.children('td').length === 0) {
          headers = cells;
          return;
        }
        if (cells.some(c => c.length > 0)) bodyRows.push(cells);
      });

      const columnCount = Math.max(headers.length, ...bodyRows.map(r => r.length), 0);
      tables.push({
        caption,
        headers,
        rows: bodyRows,
        rowCount: bodyRows.length,
        columnCount
      });
    } catch {
      /* skip malformed table */
    }
  });

  return tables;
}
