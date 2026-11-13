import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * `clsx` 只做条件拼接，不做冲突消解：把组件默认类与调用方覆盖类直接相加后，
 * 谁生效取决于生成 CSS 的先后顺序，覆盖会随机失效（Modal 的 max-w-md 就曾
 * 压过调用方的 max-w-3xl）。`tailwind-merge` 按「后写的同类工具类获胜」合并。
 *
 * 注意：tailwind-merge 只认识内置工具类，本项目的自定义 scale（maxWidth /
 * boxShadow / zIndex / animation 等，见 tailwind.config.ts）需要显式登记，
 * 否则覆盖自定义 token 时同样不会被消解。未登记的自定义类不会被误删，只是不参与合并。
 */
const twMerge = extendTailwindMerge({
  extend: {
    // 与 tailwind.config.ts 的 extend 保持一致，新增自定义 token 时同步到这里。
    classGroups: {
      'max-w': ['max-w-content', 'max-w-reading', 'max-w-rail'],
      'font-family': ['font-heading'],
      'font-size': ['text-2xs'],
      leading: ['leading-reading'],
      shadow: ['shadow-card', 'shadow-lift', 'shadow-pop'],
      z: ['z-sticky', 'z-header', 'z-overlay', 'z-dialog', 'z-toast'],
      animate: ['animate-fade-up', 'animate-fade-in', 'animate-shimmer'],
    },
  },
});

/** Merge conditional class names with Tailwind conflict resolution. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Clamp a number into [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
