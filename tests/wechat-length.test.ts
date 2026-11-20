import { describe, expect, it } from 'vitest';
import { buildWechatBody, measureWechatBody, WECHAT_IMAGE_URL_CHARS } from '../functions/lib/wechat-length';

const COVER = 'https://images.example/cover.jpg';

describe('buildWechatBody', () => {
  it('正文没有封面图时,按 bodyCoverPosition 插入一张封面并标记复用封面字节', () => {
    const body = buildWechatBody({
      markdown: '第一段\n\n第二段\n\n第三段',
      coverUrl: COVER,
      bodyCoverPosition: 'top',
    });

    expect(body.images).toHaveLength(1);
    expect(body.images[0]?.url).toBe(COVER);
    expect(body.images[0]?.label).toBe('封面图');
    expect(body.images[0]?.shareCoverSource).toBe(true);
    expect(body.html.startsWith('<p style="margin:0 0 16px;"><img src="{{WXIMG:0}}"')).toBe(true);
  });

  it('正文已经嵌入同一封面(仅 fragment 不同)时,不重复插入图片', () => {
    const body = buildWechatBody({
      markdown: '正文\n\n![封面](https://images.example/cover.jpg#body)',
      coverUrl: COVER,
      bodyCoverPosition: 'top',
    });

    expect(body.images).toHaveLength(1);
    expect(body.images[0]?.label).toBe('封面图');
    expect(body.images[0]?.shareCoverSource).toBe(true);
    // 只保留正文里的那张,没有再额外插入
    expect((body.html.match(/<img /g) ?? []).length).toBe(1);
  });

  it('文末小程序卡片会追加到正文末尾,配图也计入图片清单', () => {
    const body = buildWechatBody({
      markdown: '正文',
      card: {
        appId: 'wx123',
        path: 'pages/index/index',
        title: '进入小程序',
        desc: '',
        image: 'https://images.example/card.jpg',
        button: '点击进入',
      },
    });

    expect(body.cardHtml).toContain('data-miniprogram-appid="wx123"');
    expect(body.images).toHaveLength(1);
    expect(body.images[0]?.url).toBe('https://images.example/card.jpg');
    expect(body.cardHtml).toContain('{{WXIMG:0}}');
  });
});

describe('measureWechatBody', () => {
  it('字符数按渲染后的 HTML 计算,并随图片地址估算增加', () => {
    const markdown = '# 标题\n\n一段正文,带 ![图](https://images.example/a.png) 图片。';
    const body = buildWechatBody({ markdown });
    const report = measureWechatBody(body, markdown);

    expect(report.imageCount).toBe(1);
    // 占位符 {{WXIMG:0}} 是 11 字符,替换成估算地址后应精确增加这么多
    expect(report.chars - report.charsMin).toBe(WECHAT_IMAGE_URL_CHARS - '{{WXIMG:0}}'.length);
    // 渲染后的 HTML 一定比 Markdown 长,且可见文字少于总字符
    expect(report.chars).toBeGreaterThan(report.markdownChars);
    expect(report.visibleChars).toBeLessThan(report.chars);
    expect(report.styleChars).toBeGreaterThan(0);
    expect(report.limitChars).toBe(20_000);
    expect(report.ok).toBe(true);
    expect(report.error).toBeNull();
  });

  it('超过 2 万字符时报错,并给出至少需要删减的字数', () => {
    // 大量长段落:Markdown 不到 2 万字符,渲染后的标签会把总数顶过上限
    const markdown = Array.from({ length: 400 }, (_, index) => `第 ${index} 段的正文内容。`).join('\n\n');
    const body = buildWechatBody({ markdown });
    const report = measureWechatBody(body, markdown);

    expect(report.ok).toBe(false);
    expect(report.chars).toBeGreaterThanOrEqual(20_000);
    expect(report.overChars).toBeGreaterThan(0);
    expect(report.error).toContain('2 万字符');
    // 报错里同时点明 Markdown 口径,避免误以为正文真有两万多字
    expect(report.error).toContain(`原文 Markdown ${report.markdownChars} 字符`);
  });

  it('计入文末小程序卡片的开销', () => {
    const markdown = '正文';
    const withoutCard = measureWechatBody(buildWechatBody({ markdown }), markdown);
    const withCard = measureWechatBody(
      buildWechatBody({
        markdown,
        card: { appId: 'wx123', path: 'pages/index/index', title: '进入小程序', button: '点击进入' },
      }),
      markdown,
    );

    expect(withCard.cardChars).toBeGreaterThan(0);
    expect(withCard.chars - withoutCard.chars).toBe(withCard.cardChars);
  });
});