import type { Config } from 'tailwindcss';

/**
 * All colors reference CSS custom properties (space separated RGB channels),
 * so the whole palette can be swapped at runtime via `data-theme` + inline vars
 * without recompiling Tailwind. See src/styles/tokens.css.
 */
const withVar = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-mode="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: withVar('--c-bg'),
        surface: withVar('--c-surface'),
        'surface-2': withVar('--c-surface-2'),
        border: withVar('--c-border'),
        fg: withVar('--c-fg'),
        muted: withVar('--c-muted'),
        faint: withVar('--c-faint'),
        brand: withVar('--c-brand'),
        'brand-fg': withVar('--c-brand-fg'),
        danger: withVar('--c-danger'),
        success: withVar('--c-success'),
        warning: withVar('--c-warning'),
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        serif: ['var(--font-serif)'],
        heading: ['var(--font-heading)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        sm: 'calc(var(--radius) * 0.5)',
        DEFAULT: 'var(--radius)',
        lg: 'var(--radius)',
        xl: 'calc(var(--radius) * 1.5)',
        '2xl': 'calc(var(--radius) * 2)',
      },
      maxWidth: {
        content: 'var(--max-width)',
        prose: 'var(--max-width)',
      },
      fontSize: {
        base: 'var(--font-size-base)',
      },
      lineHeight: {
        reading: 'var(--line-height)',
      },
      spacing: {
        gutter: 'var(--gutter)',
      },
      boxShadow: {
        card: '0 1px 2px rgb(0 0 0 / 0.04), 0 4px 16px -8px rgb(0 0 0 / 0.12)',
        pop: '0 8px 30px -12px rgb(0 0 0 / 0.24)',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) both',
        'fade-in': 'fade-in 0.3s ease both',
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
