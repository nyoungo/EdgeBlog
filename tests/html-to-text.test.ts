import { describe, expect, it } from 'vitest';
import { decodeHtmlEntities, htmlToText } from '../functions/lib/html-to-text';

describe('decodeHtmlEntities', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeHtmlEntities('a&amp;b &lt;c&gt; &#65; &#x4f60; &nbsp;')).toBe('a&b <c> A 你  ');
  });

  it('leaves unknown entities untouched', () => {
    expect(decodeHtmlEntities('&unknown; &amp')).toBe('&unknown; &amp');
  });
});

describe('htmlToText', () => {
  it('drops scripts, styles and comments', () => {
    const html = `
      <html><head><title>标题 &amp; 站点</title>
        <style>.a{color:red}</style>
      </head>
      <body>
        <script>alert('x')</script>
        <!-- 注释 -->
        <p>第一段</p>
        <p>第二段</p>
      </body></html>`;
    const result = htmlToText(html);
    expect(result.title).toBe('标题 & 站点');
    expect(result.text).toBe('第一段\n第二段');
    expect(result.text).not.toContain('alert');
    expect(result.text).not.toContain('color:red');
    expect(result.text).not.toContain('注释');
  });

  it('prefers the article container over nav/footer noise', () => {
    const html =
      '<body><nav>导航链接</nav><article>' +
      '<h1>正文标题</h1><p>' +
      '这是一段足够长的正文内容。'.repeat(20) +
      '</p></article><footer>页脚</footer></body>';
    const result = htmlToText(html);
    expect(result.text).toContain('正文标题');
    expect(result.text).not.toContain('导航链接');
    expect(result.text).not.toContain('页脚');
  });

  it('turns <br> and list items into line breaks', () => {
    const result = htmlToText('<div>甲<br>乙</div><ul><li>一</li><li>二</li></ul>');
    expect(result.text).toBe('甲\n乙\n一\n二');
  });

  it('truncates long content and reports it', () => {
    const long = `<p>${'字'.repeat(5000)}</p>`;
    const result = htmlToText(long, { maxChars: 1000 });
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBe(1000);
  });
});
