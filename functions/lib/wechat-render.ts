/**
 * 微信公众号草稿正文渲染（服务端专用）。
 *
 * 与前端 `src/lib/markdown.ts` 不能复用：那条链路依赖 DOMPurify + DOM，
 * Workers 运行时没有 DOM。这里只用 marked 做纯字符串渲染，并遵守微信的硬约束：
 *
 *   * 微信会剥掉 `<style>` 与外链样式，所有样式必须**内联**在标签上；
 *   * 正文图片 URL 必须来自 `media/uploadimg`，外链会被过滤 —— 所以图片先渲染成
 *     占位符 `{{WXIMG:n}}`，由调用方上传后再替换成真实 URL；
 *   * 原始 HTML 一律丢弃（微信会清 JS，服务端也没有安全的 DOM 清洗器），
 *     文章内容应以 Markdown 表达。
 *
 * 本模块保持纯函数（无 env / 网络），便于单测。
 */
import { Marked, type Tokens } from 'marked';
import { escapeHtml } from './sanitize';

/** draft/add 的硬约束（已核对官方文档）。 */
export const WECHAT_TITLE_MAX = 32;
export const WECHAT_DIGEST_MAX = 120;
export const WECHAT_CONTENT_MAX_CHARS = 20_000;
export const WECHAT_CONTENT_MAX_BYTES = 1024 * 1024;

/** 正文图片占位符前缀；调用方按索引替换成 uploadimg 返回的 URL。 */
export const WX_IMAGE_PLACEHOLDER = '{{WXIMG:';

/** 按 Unicode 码点截断，避免把代理对（emoji）截成半个字符。 */
export function truncateChars(input: string, max: number): string {
  const chars = Array.from(input);
  return chars.length <= max ? input : chars.slice(0, max).join('');
}

/** 微信正文常用配色：正文深灰、链接蓝、代码块浅灰底。 */
const LINK_STYLE = 'color:#576b95;text-decoration:none;word-break:break-all;';
const H_STYLE = 'margin:24px 0 16px;font-weight:700;color:#1a1a1a;line-height:1.4;';
const TEXT_STYLE = 'font-size:16px;line-height:1.75;color:#3f3f3f;';

/** 只保留安全的链接协议；相对链接、锚点、邮件地址仍可用。 */
function safeLinkHref(raw: string): string | null {
  const href = raw.trim();
  if (!href || href.startsWith('//')) return null;
  if (href.startsWith('/') || href.startsWith('#')) return href;
  try {
    const url = new URL(href);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? href : null;
  } catch {
    // 无协议的普通相对地址可保留；其他无法解析的格式不输出为链接。
    return /^[\p{L}\p{N}._~-]/u.test(href) ? href : null;
  }
}

export interface WechatRenderedContent {
  /** 含 `{{WXIMG:n}}` 占位符的 HTML，调用方替换后即为最终正文。 */
  html: string;
  /** 按出现顺序记录的图片地址（与占位符索引一一对应）。 */
  images: string[];
}

/**
 * 把 Markdown 渲染成微信可用的内联样式 HTML，并收集图片地址。
 *
 * 每次调用创建独立的 marked 实例与图片收集器，避免多个请求之间互相串味。
 * marked 在调用渲染器时才注入 `this.parser`，因此这里用普通函数接收 this。
 */
export function renderWechatContent(markdown: string): WechatRenderedContent {
  const images: string[] = [];
  const instance = new Marked({ gfm: true, breaks: false });

  type This = { parser: { parse: (tokens: Tokens.Generic[], top?: boolean) => string; parseInline: (tokens: Tokens.Generic[]) => string } };

  const renderer = {
    heading(this: This, token: Tokens.Heading): string {
      const text = this.parser.parseInline(token.tokens);
      const sizes: Record<number, string> = { 1: '22px', 2: '20px', 3: '18px', 4: '17px', 5: '16px', 6: '15px' };
      const size = sizes[token.depth] ?? '16px';
      return `<h${token.depth} style="${H_STYLE}font-size:${size};">${text}</h${token.depth}>`;
    },
    paragraph(this: This, token: Tokens.Paragraph): string {
      const text = this.parser.parseInline(token.tokens);
      return `<p style="margin:0 0 16px;${TEXT_STYLE}">${text}</p>`;
    },
    blockquote(this: This, token: Tokens.Blockquote): string {
      const body = this.parser.parse(token.tokens as Tokens.Generic[]);
      return `<blockquote style="margin:0 0 16px;padding:8px 16px;border-left:3px solid #d0d0d0;background:#f7f7f7;color:#666;${TEXT_STYLE}">${body}</blockquote>`;
    },
    list(this: This, token: Tokens.List): string {
      const tag = token.ordered ? 'ol' : 'ul';
      const start = token.ordered && typeof token.start === 'number' && token.start !== 1 ? ` start="${token.start}"` : '';
      const items = token.items
        .map((item) => `<li style="margin:4px 0;${TEXT_STYLE}">${this.parser.parse(item.tokens, !!item.loose)}</li>`)
        .join('');
      return `<${tag}${start} style="margin:0 0 16px;padding-left:24px;">${items}</${tag}>`;
    },
    code({ text, lang }: Tokens.Code): string {
      const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : '';
      return `<pre${langAttr} style="margin:0 0 16px;padding:12px 14px;background:#f6f8fa;border-radius:6px;overflow-x:auto;"><code style="font-family:Consolas,Monaco,monospace;font-size:13px;line-height:1.6;color:#24292e;">${escapeHtml(text)}</code></pre>`;
    },
    codespan({ text }: Tokens.Codespan): string {
      return `<code style="padding:1px 5px;background:#f2f2f2;border-radius:4px;font-family:Consolas,Monaco,monospace;font-size:14px;color:#c7254e;">${escapeHtml(text)}</code>`;
    },
    strong(this: This, token: Tokens.Strong): string {
      return `<strong style="font-weight:700;color:#1a1a1a;">${this.parser.parseInline(token.tokens)}</strong>`;
    },
    em(this: This, token: Tokens.Em): string {
      return `<em style="font-style:italic;">${this.parser.parseInline(token.tokens)}</em>`;
    },
    del(this: This, token: Tokens.Del): string {
      return `<span style="text-decoration:line-through;">${this.parser.parseInline(token.tokens)}</span>`;
    },
    link(this: This, token: Tokens.Link): string {
      const text = this.parser.parseInline(token.tokens);
      const href = safeLinkHref(token.href);
      return href
        ? `<a href="${escapeHtml(href)}" style="${LINK_STYLE}">${text}</a>`
        : text;
    },
    image(token: Tokens.Image): string {
      const index = images.length;
      images.push(token.href);
      const alt = escapeHtml(token.text ?? '');
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
      // src 先放占位符，上传成功后再替换成 mmbiz URL。
      return `<img src="${WX_IMAGE_PLACEHOLDER}${index}}}" alt="${alt}"${title} style="max-width:100%;height:auto;display:block;margin:8px auto;" />`;
    },
    hr(): string {
      return '<hr style="margin:24px 0;border:none;border-top:1px solid #e5e5e5;" />';
    },
    br(): string {
      return '<br />';
    },
    // 原始 HTML 直接丢弃：服务端没有 DOM 清洗器，微信也会清 JS。
    html(): string {
      return '';
    },
    table(this: This, token: Tokens.Table): string {
      const head = token.header
        .map(
          (cell) =>
            `<th style="padding:8px 10px;border:1px solid #e0e0e0;background:#f7f7f7;font-weight:700;text-align:left;">${this.parser.parseInline(cell.tokens)}</th>`,
        )
        .join('');
      const body = token.rows
        .map(
          (row) =>
            `<tr>${row
              .map((cell) => `<td style="padding:8px 10px;border:1px solid #e0e0e0;">${this.parser.parseInline(cell.tokens)}</td>`)
              .join('')}</tr>`,
        )
        .join('');
      return `<table style="width:100%;border-collapse:collapse;margin:0 0 16px;font-size:15px;"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    },
  };

  instance.use({ renderer: renderer as never });
  const tokens = instance.lexer(markdown ?? '');
  const html = instance.parser(tokens);
  return { html, images };
}

/**
 * 把正文里的图片占位符替换成真实 URL。
 * `urls` 与 `renderWechatContent().images` 一一对应。
 */
export function substituteWechatImages(html: string, urls: string[]): string {
  let out = html;
  urls.forEach((url, index) => {
    out = out.split(`${WX_IMAGE_PLACEHOLDER}${index}}}`).join(url);
  });
  return out;
}

/** 正文体积校验：微信要求 < 2 万字符且 < 1M。返回错误信息或 null。 */
export function validateWechatContent(html: string): string | null {
  const chars = Array.from(html).length;
  if (chars >= WECHAT_CONTENT_MAX_CHARS) {
    return `正文长度 ${chars} 字符，超过微信 2 万字符上限，请精简后再推送`;
  }
  const bytes = new TextEncoder().encode(html).byteLength;
  if (bytes >= WECHAT_CONTENT_MAX_BYTES) {
    return `正文体积 ${Math.round(bytes / 1024)}KB，超过微信 1MB 上限，请精简后再推送`;
  }
  return null;
}
