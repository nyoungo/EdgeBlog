/**
 * Code-highlight palettes for the `theme.codeTheme` setting.
 *
 * The raw CSS is bundled (no runtime CDN request) and injected into a single
 * <style id="eb-code-theme"> element by the theme engine, so switching the
 * highlight theme is instant and works offline.
 */
import github from 'highlight.js/styles/github.css?raw';
import githubDark from 'highlight.js/styles/github-dark.css?raw';
import atomOneLight from 'highlight.js/styles/atom-one-light.css?raw';
import atomOneDark from 'highlight.js/styles/atom-one-dark.css?raw';
import monokai from 'highlight.js/styles/monokai.css?raw';
import vs2015 from 'highlight.js/styles/vs2015.css?raw';

export const DEFAULT_CODE_THEME = 'github-dark';

export const CODE_THEMES: Record<string, { label: string; css: string }> = {
  'github-dark': { label: 'GitHub 暗', css: githubDark },
  github: { label: 'GitHub 亮', css: github },
  'atom-one-dark': { label: 'Atom 暗', css: atomOneDark },
  'atom-one-light': { label: 'Atom 亮', css: atomOneLight },
  monokai: { label: 'Monokai', css: monokai },
  vs2015: { label: 'VS2015', css: vs2015 },
};

export function codeThemeCss(name: string): string {
  return (CODE_THEMES[name] ?? CODE_THEMES[DEFAULT_CODE_THEME]!).css;
}
