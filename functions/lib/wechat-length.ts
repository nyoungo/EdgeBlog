/**
 * 公众号正文的装配与长度预检(纯函数,无 env / 网络)。
 *
 * 推送链路和"预检"必须走同一套装配逻辑,否则编辑器里看到的字符数和真正
 * 推给微信的字符串会不一致。所以这里把「Markdown → 内联样式 HTML + 图片清单」
 * 抽成 `buildWechatBody`,由 `wechat-draft.ts`(真实推送)、
 * `/api/wechat/preflight`(编辑器预检)和 AI 的 `count_chars` 工具共用。
 *
 * 微信 `draft/add` 的 `content` 限制是「必须少于 2 万字符且小于 1M」,统计的对象是
 * **渲染后的 HTML 字符串**(含标签与内联样式),不是 Markdown 字数。Markdown 写着
 * 六千字,渲染后两万多字符是正常现象。
 */
import type { WechatLengthReport, WechatSettings } from '@shared/types';
import {
  insertBodyCover,
  measureWechatContent,
  renderMiniprogramCard,
  renderWechatContent,
  substituteWechatImages,
  WECHAT_CONTENT_MAX_BYTES,
  WECHAT_CONTENT_MAX_CHARS,
  WX_IMAGE_PLACEHOLDER,
  validateWechatContent,
  type WechatMiniProgramCard,
} from './wechat-render';

/**
 * 估算用的 mmbiz 图片地址长度。
 *
 * `media/uploadimg` 返回的真实地址在推送时才生成,预检阶段不可能知道,只能按典型
 * 长度估算。2026-11 实测(对线上公众号连传 4 次 8×8 PNG)真实地址是 154–162 字符,
 * 均值 158,形如 `http://mmbiz.qpic.cn/sz_mmbiz_png/<路径>?wx_fmt=png`,所以取 158。
 * 每张图的误差在 ±10 字符以内(远小于 2 万上限),报告里会把 `imageUrlChars`
 * 一起返回,方便解释误差来源。
 */
export const WECHAT_IMAGE_URL_CHARS = 158;

/** 正文图片(推送时需要下载并上传到微信)。 */
export interface WechatBodyImage {
  url: string;
  /** 报错文案里的定位信息,如「第 2 张正文图片(...)」「封面图」。 */
  label: string;
  /** 与封面同一地址:推送时与 `thumb_media_id` 共用同一次 HTTP 读取的字节。 */
  shareCoverSource?: boolean;
}

export interface WechatBody {
  /** 含 `{{WXIMG:n}}` 占位符的正文 HTML。 */
  html: string;
  /** 与占位符一一对应的图片清单。 */
  images: WechatBodyImage[];
  /** 文末小程序卡片 HTML(未启用为空串)。 */
  cardHtml: string;
}

/** URL fragment 不会随 HTTP 请求发送;比较时去掉 fragment,确保同一资源只取一次。 */
export function imageSourceKey(rawUrl: string): string {
  const value = rawUrl.trim();
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString();
  } catch {
    return value;
  }
}

/** 正文封面块的样式:与历史推送结果保持一致,改动会影响已推草稿的长度。 */
const COVER_IMAGE_STYLE = 'max-width:100%;height:auto;display:block;margin:8px auto;';

/**
 * 由 Markdown 装配出「即将推送」的正文。
 *
 * 顺序与真实推送一致:正文渲染 → 插入正文封面 → 追加文末小程序卡片。
 * 图片先写成占位符,真正上传后由 `substituteWechatImages` 回填。
 */
export function buildWechatBody(input: {
  markdown: string;
  /** 文章封面地址;为空表示没有封面(推送会因此被拒,但预检仍可计算)。 */
  coverUrl?: string | null;
  bodyCoverPosition?: WechatSettings['bodyCoverPosition'];
  card?: WechatMiniProgramCard | null;
}): WechatBody {
  const rendered = renderWechatContent(input.markdown ?? '');
  const images: WechatBodyImage[] = rendered.images.map((url, index) => ({
    url,
    label: `第 ${index + 1} 张正文图片(${url})`,
  }));

  let html = rendered.html;
  const coverUrl = (input.coverUrl ?? '').trim();
  const position = input.bodyCoverPosition ?? 'none';
  if (coverUrl) {
    // 随机图片接口每次访问都可能返回不同图片:同一篇推送里正文封面与
    // thumb_media_id 必须复用同一次 HTTP 访问读到的同一份字节。
    const coverKey = imageSourceKey(coverUrl);
    const existingImages = images.filter((image) => imageSourceKey(image.url) === coverKey);
    for (const image of existingImages) {
      image.shareCoverSource = true;
      image.label = '封面图';
    }
    if (position !== 'none' && existingImages.length === 0) {
      const index = images.length;
      images.push({ url: coverUrl, label: '封面图', shareCoverSource: true });
      const coverPlaceholder = `${WX_IMAGE_PLACEHOLDER}${index}}}`;
      const coverHtml = `<p style="margin:0 0 16px;"><img src="${coverPlaceholder}" alt="封面图" style="${COVER_IMAGE_STYLE}" /></p>`;
      html = insertBodyCover(html, coverHtml, position);
    }
  }

  // 文末小程序卡片(可选):配图同样走 uploadimg,所以先占位再统一替换。
  let cardHtml = '';
  if (input.card) {
    let cardImageSrc = '';
    if (input.card.image) {
      const index = images.length;
      images.push({ url: input.card.image, label: `小程序卡片配图(${input.card.image})` });
      cardImageSrc = `${WX_IMAGE_PLACEHOLDER}${index}}}`;
    }
    cardHtml = renderMiniprogramCard(input.card, cardImageSrc);
  }

  return { html, images, cardHtml };
}

/** 从设置组装文末小程序卡片;未启用或缺 AppID/路径时返回 null。 */
export function miniProgramCardFromSettings(settings: WechatSettings): WechatMiniProgramCard | null {
  if (!settings.miniprogramEnabled) return null;
  const appId = settings.miniprogramAppId.trim();
  const path = settings.miniprogramPath.trim();
  if (!appId || !path) return null;
  return {
    appId,
    path,
    title: settings.miniprogramTitle.trim() || settings.miniprogramButton.trim() || '点击进入小程序',
    desc: settings.miniprogramDesc.trim(),
    image: settings.miniprogramImage.trim(),
    button: settings.miniprogramButton.trim() || '点击进入小程序',
  };
}

/** 构造与真实地址等长的占位 URL,用于估算「图片地址会占多少字符」。 */
function dummyImageUrl(chars: number): string {
  // 与实测真实地址一致的前缀;实测地址里还有 ?wx_fmt=,但总长度才是关键。
  const prefix = 'http://mmbiz.qpic.cn/sz_mmbiz_png/';
  return prefix.length >= chars ? prefix.slice(0, chars) : prefix + 'x'.repeat(chars - prefix.length);
}

/**
 * 量出「推给微信的 content」会是多少字符。
 *
 * 除了图片地址长度是估算(见 `WECHAT_IMAGE_URL_CHARS`),其余部分与真实推送逐字符一致:
 * 同一个渲染器、同一个封面插入位置、同一个小程序卡片。
 */
export function measureWechatBody(
  body: WechatBody,
  markdown: string,
  imageUrlChars = WECHAT_IMAGE_URL_CHARS,
): WechatLengthReport {
  const dummy = dummyImageUrl(imageUrlChars);
  const placeholders = body.images.map((_, index) => `${WX_IMAGE_PLACEHOLDER}${index}}}`);

  const withPlaceholders = body.html + body.cardHtml;
  const asPushed = substituteWechatImages(
    withPlaceholders,
    body.images.map(() => dummy),
  );
  const size = measureWechatContent(asPushed);
  const markdownChars = Array.from(markdown ?? '').length;

  const visibleChars = Array.from(asPushed.replace(/<[^>]+>/g, '').replace(/\s+/g, '')).length;
  const styleChars = (asPushed.match(/style="[^"]*"/g) ?? []).reduce((sum, attr) => sum + attr.length, 0);

  let cardHtml = body.cardHtml;
  for (let index = 0; index < placeholders.length; index++) {
    cardHtml = cardHtml.split(placeholders[index] ?? '').join(dummy);
  }

  return {
    chars: size.chars,
    charsMin: Array.from(withPlaceholders).length,
    bytes: size.bytes,
    limitChars: WECHAT_CONTENT_MAX_CHARS,
    limitBytes: WECHAT_CONTENT_MAX_BYTES,
    overChars: size.overChars,
    ok: size.ok,
    imageCount: body.images.length,
    imageUrlChars,
    markdownChars,
    visibleChars,
    styleChars,
    cardChars: Array.from(cardHtml).length,
    error: validateWechatContent(asPushed, markdownChars),
  };
}