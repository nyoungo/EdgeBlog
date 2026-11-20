/**
 * 公众号推送失败后的自动修复。
 *
 * 只处理「图片格式 / 体积」这类明确可修的失败：正文图必须是 jpg/png 且单张
 * 小于 1MB，封面图要 jpg/png/gif/bmp 且不超过 10MB。鉴权、配置、限流、正文
 * 超长等错误不在修复范围内，直接抛原始错误，不做无意义的重试。
 *
 * 修复方式是让 AI 只调用三个工具：压缩、转格式、替换文章里的图片地址。
 * 它拿不到「重写正文」的能力，避免修图顺手把文章改坏。
 */
import type { Post, WechatPushResult, WechatSettings } from '@shared/types';
import type { Env, SessionUser } from './env';
import { AppError } from './errors';
import { getPostById } from './posts-repo';
import { runToolAgent } from './ai-agent';
import { pushPostToWechatDraft, type PushDraftOptions } from './wechat-draft';
import { renderWechatContent } from './wechat-render';

/** 修复代理可用的工具：看不了别的文档，也不能重写正文。 */
const REPAIR_TOOLS = ['compress_image_from_url', 'convert_image_format', 'replace_post_image'];

/** 修复代理的整体预算：一张图压缩 + 替换 + 重推，留足余量。 */
const REPAIR_BUDGET_MS = 150_000;

/** 图片体积 / 格式类错误才可能由图片工具修复。 */
const REPAIRABLE_CODES = new Set<string>(['PAYLOAD_TOO_LARGE', 'UNSUPPORTED_MEDIA_TYPE']);

/** 错误描述里必须能定位到具体图片，否则不是图片问题。 */
const REPAIRABLE_MESSAGE = /正文图|正文图片|封面图|小程序卡片配图/;

export function isRepairableWechatError(err: unknown): err is AppError {
  return (
    err instanceof AppError && REPAIRABLE_CODES.has(err.code) && REPAIRABLE_MESSAGE.test(err.message)
  );
}

const REPAIR_SYSTEM_PROMPT = [
  '你是公众号草稿推送的修复助手。推送因为图片不符合微信要求而失败，你的任务是修好图片并替换文章里的地址，系统会随后自动重推。',
  '',
  '微信的限制：',
  '- 正文图片：只收 jpg/png，单张必须小于 1MB；',
  '- 封面图：收 jpg/png/gif/bmp，不超过 10MB。',
  '',
  '处理步骤：',
  '1. 从「推送错误」里找出失败的那张图（正文第 N 张，或封面）；',
  '2. 格式不支持（如 webp）→ 用 convert_image_format 换成 jpeg；',
  '3. 体积超限 → 用 compress_image_from_url 压到上限以内（正文图 maxBytes 用 900000，封面图可用 5000000）；',
  '4. 拿到新地址后用 replace_post_image 把文章里的原始地址替换成新地址；',
  '5. 只处理报错涉及的那张图，不要动其他图片和正文文字。',
  '',
  '完成后用一句话说明改了哪张图。不要重写正文，也不要尝试自己推送。',
].join('\n');

interface RepairOutcome {
  repaired: boolean;
  post: Post | null;
}

/** 跑一次受限的修复代理，并以「文章是否真的被改动」判定是否修复成功。 */
async function repairWechatImages(
  env: Env,
  actor: SessionUser,
  post: Post,
  error: AppError,
  budgetMs: number,
): Promise<RepairOutcome> {
  const images = renderWechatContent(post.content_md ?? '').images;
  const lines = [
    `文章 id：${post.id}`,
    `标题：《${post.title}》`,
    `封面图：${post.cover_url ?? '（未设置）'}`,
    images.length > 0
      ? `正文图片：\n${images.map((url, index) => `${index + 1}. ${url}`).join('\n')}`
      : '正文图片：（无）',
    '',
    `推送错误：${error.message}`,
  ];

  try {
    await runToolAgent(env, actor, REPAIR_SYSTEM_PROMPT, lines.join('\n'), {
      tools: REPAIR_TOOLS,
      maxRounds: 4,
      budgetMs,
      maxToolResultChars: 2000,
    });
  } catch (err) {
    // AI 未启用 / 调用失败都只是「没修成」，不能盖掉原始的推送错误。
    console.error('[wechat-repair] 修复代理执行失败', err);
    return { repaired: false, post: null };
  }

  const updated = await getPostById(env, post.id);
  const changed =
    updated !== null &&
    ((updated.content_md ?? '') !== (post.content_md ?? '') ||
      (updated.cover_url ?? '') !== (post.cover_url ?? ''));
  return { repaired: changed, post: changed ? updated : null };
}

export interface WechatRepairResult extends WechatPushResult {
  /** 是否经历过「图片修复后重推」。 */
  repaired: boolean;
  /** 修复后文章的最新正文/封面，供前端同步编辑器，避免用户再次保存时退回旧图。 */
  post?: { contentMd: string; coverUrl: string | null };
}

export interface RepairPushOptions extends PushDraftOptions {
  /** 触发推送的身份；没有身份（例如任务创建者已删除）时不自动修复。 */
  actor: SessionUser | null;
  /** 修复预算，默认 150 秒。 */
  budgetMs?: number;
}

/**
 * 推送草稿；因图片格式/体积失败时让 AI 修图并重推一次。
 *
 * 修复失败（AI 不可用、修完没改动、重推仍失败）时抛出原始错误，
 * 让调用方看到真正的失败原因，而不是「修复失败」这种二手信息。
 */
export async function pushPostToWechatWithRepair(
  env: Env,
  settings: WechatSettings,
  post: Post,
  options: RepairPushOptions,
): Promise<WechatRepairResult> {
  const { actor, budgetMs, ...pushOptions } = options;

  try {
    return { ...(await pushPostToWechatDraft(env, settings, post, pushOptions)), repaired: false };
  } catch (err) {
    if (!settings.repairPushFailures || !actor || !isRepairableWechatError(err)) throw err;

    const outcome = await repairWechatImages(env, actor, post, err, budgetMs ?? REPAIR_BUDGET_MS);
    if (!outcome.repaired || !outcome.post) throw err;

    const result = await pushPostToWechatDraft(env, settings, outcome.post, pushOptions);
    return {
      ...result,
      repaired: true,
      post: { contentMd: outcome.post.content_md ?? '', coverUrl: outcome.post.cover_url },
    };
  }
}