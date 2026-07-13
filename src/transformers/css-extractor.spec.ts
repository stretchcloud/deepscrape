import {
  extractWithCssSchema,
  CssExtractionSchema,
} from './css-extractor';

describe('extractWithCssSchema', () => {
  describe('product list (text / number / attribute)', () => {
    const html = `
      <html>
        <body>
          <ul class="products">
            <li class="product">
              <h2 class="name">Wireless Mouse</h2>
              <span class="price">$1,299.99</span>
              <a class="link" href="/p/wireless-mouse">Buy</a>
            </li>
            <li class="product">
              <h2 class="name">Mechanical Keyboard</h2>
              <span class="price">USD 89</span>
              <a class="link" href="/p/mechanical-keyboard">Buy</a>
            </li>
          </ul>
        </body>
      </html>
    `;

    const schema: CssExtractionSchema = {
      name: 'products',
      baseSelector: 'li.product',
      fields: [
        { name: 'name', selector: '.name', type: 'text' },
        { name: 'price', selector: '.price', type: 'number' },
        { name: 'link', selector: 'a.link', type: 'attribute', attribute: 'href' },
      ],
    };

    it('returns one record per baseSelector match', () => {
      const records = extractWithCssSchema(html, schema);
      expect(records).toHaveLength(2);
    });

    it('extracts trimmed text, parsed numbers and attributes', () => {
      const records = extractWithCssSchema(html, schema);

      expect(records[0]).toEqual({
        name: 'Wireless Mouse',
        price: 1299.99, // "$1,299.99" -> currency + thousands separator stripped
        link: '/p/wireless-mouse',
      });

      expect(records[1]).toEqual({
        name: 'Mechanical Keyboard',
        price: 89, // "USD 89" -> 89
        link: '/p/mechanical-keyboard',
      });
    });
  });

  describe('number parsing edge cases', () => {
    const build = (priceHtml: string) =>
      extractWithCssSchema(
        `<div class="row"><span class="p">${priceHtml}</span></div>`,
        {
          baseSelector: '.row',
          fields: [{ name: 'price', selector: '.p', type: 'number' }],
        }
      )[0].price;

    it('strips currency symbols and commas', () => {
      expect(build('$1,234,567.50')).toBe(1234567.5);
    });

    it('parses plain integers', () => {
      expect(build('42')).toBe(42);
    });

    it('parses negative numbers', () => {
      expect(build('-15.5')).toBe(-15.5);
    });

    it('extracts the first number embedded in prose', () => {
      expect(build('Only 7 left in stock')).toBe(7);
    });

    it('returns null when no number is present', () => {
      expect(build('Out of stock')).toBeNull();
    });
  });

  describe('nested_list (reviews within a product)', () => {
    const html = `
      <div class="product" id="widget">
        <h1 class="title">Super Widget</h1>
        <ul class="reviews">
          <li class="review">
            <span class="author">Alice</span>
            <span class="rating">5</span>
          </li>
          <li class="review">
            <span class="author">Bob</span>
            <span class="rating">4</span>
          </li>
          <li class="review">
            <span class="author">Carol</span>
            <span class="rating">3</span>
          </li>
        </ul>
      </div>
    `;

    const schema: CssExtractionSchema = {
      baseSelector: '.product',
      fields: [
        { name: 'title', selector: '.title', type: 'text' },
        {
          name: 'reviews',
          selector: 'li.review',
          type: 'nested_list',
          fields: [
            { name: 'author', selector: '.author', type: 'text' },
            { name: 'rating', selector: '.rating', type: 'number' },
          ],
        },
      ],
    };

    it('builds a sub-record for each match', () => {
      const records = extractWithCssSchema(html, schema);

      expect(records).toHaveLength(1);
      expect(records[0].title).toBe('Super Widget');
      expect(records[0].reviews).toEqual([
        { author: 'Alice', rating: 5 },
        { author: 'Bob', rating: 4 },
        { author: 'Carol', rating: 3 },
      ]);
    });

    it('returns [] for a nested_list with no matches', () => {
      const noReviewsHtml = `
        <div class="product">
          <h1 class="title">Lonely Widget</h1>
        </div>
      `;
      const records = extractWithCssSchema(noReviewsHtml, schema);

      expect(records).toHaveLength(1);
      expect(records[0].reviews).toEqual([]);
    });
  });

  describe('nested (single sub-record)', () => {
    const html = `
      <article class="post">
        <h1 class="headline">Breaking News</h1>
        <div class="author-box">
          <span class="author-name">Jane Doe</span>
          <a class="author-url" href="https://example.com/jane">Profile</a>
        </div>
      </article>
    `;

    const schema: CssExtractionSchema = {
      baseSelector: 'article.post',
      fields: [
        { name: 'headline', selector: '.headline', type: 'text' },
        {
          name: 'author',
          selector: '.author-box',
          type: 'nested',
          fields: [
            { name: 'name', selector: '.author-name', type: 'text' },
            { name: 'url', selector: '.author-url', type: 'attribute', attribute: 'href' },
          ],
        },
      ],
    };

    it('builds a single nested record from the first match', () => {
      const records = extractWithCssSchema(html, schema);

      expect(records[0]).toEqual({
        headline: 'Breaking News',
        author: {
          name: 'Jane Doe',
          url: 'https://example.com/jane',
        },
      });
    });

    it('returns null when the nested selector has no match', () => {
      const noAuthorHtml = `
        <article class="post">
          <h1 class="headline">Anonymous</h1>
        </article>
      `;
      const records = extractWithCssSchema(noAuthorHtml, schema);

      expect(records[0].author).toBeNull();
    });
  });

  describe('list type', () => {
    const html = `
      <div class="recipe">
        <h1 class="name">Pancakes</h1>
        <ul class="ingredients">
          <li>Flour</li>
          <li>  Milk  </li>
          <li>Eggs</li>
        </ul>
      </div>
    `;

    it('returns trimmed text for every match', () => {
      const records = extractWithCssSchema(html, {
        baseSelector: '.recipe',
        fields: [
          { name: 'name', selector: '.name', type: 'text' },
          { name: 'ingredients', selector: '.ingredients li', type: 'list' },
        ],
      });

      expect(records[0].ingredients).toEqual(['Flour', 'Milk', 'Eggs']);
    });

    it('returns [] when the list selector matches nothing', () => {
      const records = extractWithCssSchema(html, {
        baseSelector: '.recipe',
        fields: [{ name: 'steps', selector: '.steps li', type: 'list' }],
      });

      expect(records[0].steps).toEqual([]);
    });
  });

  describe('html type', () => {
    it('returns the inner HTML of the first match', () => {
      const html = `
        <div class="card">
          <div class="body"><p>Hello <strong>world</strong></p></div>
        </div>
      `;
      const records = extractWithCssSchema(html, {
        baseSelector: '.card',
        fields: [{ name: 'body', selector: '.body', type: 'html' }],
      });

      expect(records[0].body).toBe('<p>Hello <strong>world</strong></p>');
    });
  });

  describe('missing fields yield null (never throw)', () => {
    const html = `
      <div class="item">
        <span class="title">Only a title</span>
      </div>
    `;

    it('null for a missing text/number/attribute selector', () => {
      const records = extractWithCssSchema(html, {
        baseSelector: '.item',
        fields: [
          { name: 'title', selector: '.title', type: 'text' },
          { name: 'subtitle', selector: '.subtitle', type: 'text' },
          { name: 'price', selector: '.price', type: 'number' },
          { name: 'link', selector: 'a', type: 'attribute', attribute: 'href' },
          { name: 'markup', selector: '.missing', type: 'html' },
        ],
      });

      expect(records[0]).toEqual({
        title: 'Only a title',
        subtitle: null,
        price: null,
        link: null,
        markup: null,
      });
    });

    it('null when an attribute field omits the attribute name', () => {
      const records = extractWithCssSchema(html, {
        baseSelector: '.item',
        fields: [{ name: 'link', selector: '.title', type: 'attribute' }],
      });

      expect(records[0].link).toBeNull();
    });

    it('null when the requested attribute is absent on the match', () => {
      const records = extractWithCssSchema(html, {
        baseSelector: '.item',
        fields: [
          { name: 'href', selector: '.title', type: 'attribute', attribute: 'href' },
        ],
      });

      expect(records[0].href).toBeNull();
    });
  });

  describe('self selector (empty or ".") targets the base element', () => {
    const html = `
      <ul>
        <li class="tag">alpha</li>
        <li class="tag">beta</li>
      </ul>
    `;

    it('uses the base element text when the selector is empty', () => {
      const records = extractWithCssSchema(html, {
        baseSelector: 'li.tag',
        fields: [{ name: 'value', selector: '', type: 'text' }],
      });

      expect(records.map((r) => r.value)).toEqual(['alpha', 'beta']);
    });

    it('uses the base element attribute for "." selectors', () => {
      const linkHtml = `<a class="cta" href="/go">Go</a>`;
      const records = extractWithCssSchema(linkHtml, {
        baseSelector: 'a.cta',
        fields: [{ name: 'href', selector: '.', type: 'attribute', attribute: 'href' }],
      });

      expect(records[0].href).toBe('/go');
    });
  });

  describe('empty / edge inputs', () => {
    const schema: CssExtractionSchema = {
      baseSelector: '.product',
      fields: [{ name: 'name', selector: '.name', type: 'text' }],
    };

    it('returns [] when the baseSelector matches nothing', () => {
      expect(extractWithCssSchema('<div class="other">x</div>', schema)).toEqual([]);
    });

    it('returns [] for empty html', () => {
      expect(extractWithCssSchema('', schema)).toEqual([]);
    });

    it('returns [] when the baseSelector is empty', () => {
      expect(
        extractWithCssSchema('<div class="product"></div>', {
          baseSelector: '',
          fields: [],
        })
      ).toEqual([]);
    });

    it('does not throw on malformed HTML', () => {
      const malformed = '<div class="product"><span class="name">Broken';
      const records = extractWithCssSchema(malformed, schema);

      expect(records).toHaveLength(1);
      expect(records[0].name).toBe('Broken');
    });

    it('scopes descendant selectors to each base element', () => {
      // The stray ".name" outside any product must not leak into records.
      const html = `
        <span class="name">not a product</span>
        <div class="product"><span class="name">Real</span></div>
      `;
      const records = extractWithCssSchema(html, schema);

      expect(records).toHaveLength(1);
      expect(records[0].name).toBe('Real');
    });
  });
});
