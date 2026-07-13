import { extractTables } from './table-extractor';

describe('table-extractor', () => {
  it('extracts a table with thead headers and tbody rows', () => {
    const html = `
      <table>
        <caption>Prices</caption>
        <thead><tr><th>Name</th><th>Price</th></tr></thead>
        <tbody>
          <tr><td>Widget</td><td>$10</td></tr>
          <tr><td>Gadget</td><td>$20</td></tr>
        </tbody>
      </table>`;
    const [t] = extractTables(html);
    expect(t.caption).toBe('Prices');
    expect(t.headers).toEqual(['Name', 'Price']);
    expect(t.rows).toEqual([['Widget', '$10'], ['Gadget', '$20']]);
    expect(t.rowCount).toBe(2);
    expect(t.columnCount).toBe(2);
  });

  it('treats a leading all-th row as the header when there is no thead', () => {
    const html = `<table>
      <tr><th>A</th><th>B</th></tr>
      <tr><td>1</td><td>2</td></tr>
    </table>`;
    const [t] = extractTables(html);
    expect(t.headers).toEqual(['A', 'B']);
    expect(t.rows).toEqual([['1', '2']]);
  });

  it('expands colspan into positional slots', () => {
    const html = `<table><tr><td colspan="2">merged</td><td>x</td></tr></table>`;
    const [t] = extractTables(html);
    expect(t.rows[0]).toEqual(['merged', '', 'x']);
  });

  it('returns [] for no tables or empty input', () => {
    expect(extractTables('<div>no tables</div>')).toEqual([]);
    expect(extractTables('')).toEqual([]);
  });

  it('extracts multiple tables', () => {
    const html = `<table><tr><th>H</th></tr><tr><td>a</td></tr></table>
                  <table><tr><th>K</th></tr><tr><td>b</td></tr></table>`;
    expect(extractTables(html)).toHaveLength(2);
  });
});
