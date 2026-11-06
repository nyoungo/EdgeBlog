import type { ComponentType } from 'react';
import type { TabDef, TabId } from './types';
import { IdentityTab } from './IdentityTab';
import { HeaderTab } from './HeaderTab';
import { HeroTab } from './HeroTab';
import { HomeTab } from './HomeTab';
import { AppearanceTab } from './AppearanceTab';
import { FooterTab } from './FooterTab';
import { ContentTab } from './ContentTab';
import { CommentsTab } from './CommentsTab';
import { MusicTab } from './MusicTab';
import { AdvancedTab } from './AdvancedTab';

export const TAB_DEFS: TabDef[] = [
  {
    id: 'identity',
    label: '站点标识',
    icon: 'home',
    hint: '站点名称、标语、描述、语言、Logo 与浏览器图标',
    namespaces: ['site'],
    defaults: [
      { ns: 'site', path: ['name'] },
      { ns: 'site', path: ['tagline'] },
      { ns: 'site', path: ['description'] },
      { ns: 'site', path: ['locale'] },
      { ns: 'site', path: ['logo'] },
      { ns: 'site', path: ['favicon'] },
    ],
  },
  {
    id: 'header',
    label: '顶栏与导航',
    icon: 'globe',
    hint: '顶栏布局、三处颜色、搜索入口与导航菜单',
    namespaces: ['layout', 'navigation', 'features'],
    defaults: [
      { ns: 'layout', path: ['header'] },
      { ns: 'navigation', path: [] },
      { ns: 'features', path: ['search'] },
    ],
  },
  {
    id: 'hero',
    label: '英雄区',
    icon: 'image',
    hint: '首页欢迎区的背景（视频 → 图片 → 颜色）、尺寸、遮罩与文字',
    namespaces: ['layout'],
    defaults: [{ ns: 'layout', path: ['hero'] }],
  },
  {
    id: 'home',
    label: '首页与列表',
    icon: 'list',
    hint: '首页模块顺序与开关、文章卡片形态、侧边栏与分页',
    namespaces: ['layout'],
    defaults: [
      { ns: 'layout', path: ['homeModules'] },
      { ns: 'layout', path: ['cardStyle'] },
      { ns: 'layout', path: ['cardSize'] },
      { ns: 'layout', path: ['cardBlur'] },
      { ns: 'layout', path: ['sidebar'] },
      { ns: 'layout', path: ['postsPerPage'] },
    ],
  },
  {
    id: 'appearance',
    label: '配色与版式',
    icon: 'palette',
    hint: '预设色板、主色、全局背景、字体、圆角与代码主题',
    namespaces: ['theme'],
    defaults: [
      { ns: 'theme', path: ['preset'] },
      { ns: 'theme', path: ['mode'] },
      { ns: 'theme', path: ['primaryColor'] },
      { ns: 'theme', path: ['backgroundColor'] },
      { ns: 'theme', path: ['backgroundColorLight'] },
      { ns: 'theme', path: ['backgroundColorDark'] },
      { ns: 'theme', path: ['backgroundImage'] },
      { ns: 'theme', path: ['backgroundLayout'] },
      { ns: 'theme', path: ['backgroundAttachment'] },
      { ns: 'theme', path: ['backgroundScrim'] },
      { ns: 'theme', path: ['fontBody'] },
      { ns: 'theme', path: ['fontHeading'] },
      { ns: 'theme', path: ['fontScale'] },
      { ns: 'theme', path: ['radius'] },
      { ns: 'theme', path: ['maxWidth'] },
      { ns: 'theme', path: ['lineHeight'] },
      { ns: 'theme', path: ['codeTheme'] },
    ],
  },
  {
    id: 'footer',
    label: '页脚与社交',
    icon: 'link',
    hint: '页脚版权、页脚链接、RSS 开关与社交图标',
    namespaces: ['site', 'social', 'features'],
    defaults: [
      { ns: 'site', path: ['footerText'] },
      { ns: 'site', path: ['footerLinks'] },
      { ns: 'social', path: [] },
      { ns: 'features', path: ['rss'] },
    ],
  },
  {
    id: 'content',
    label: '文章页与页面',
    icon: 'fileText',
    hint: '文章目录、浏览量、相关文章、上下篇与关于页内容',
    namespaces: ['features', 'pages'],
    defaults: [
      { ns: 'features', path: ['views'] },
      { ns: 'features', path: ['toc'] },
      { ns: 'features', path: ['relatedPosts'] },
      { ns: 'features', path: ['prevNext'] },
      { ns: 'pages', path: ['about'] },
    ],
  },
  {
    id: 'comments',
    label: '评论区',
    icon: 'message',
    hint: '评论开关、审核策略、发布间隔与长度限制',
    namespaces: ['comments', 'features'],
    defaults: [
      { ns: 'comments', path: [] },
      { ns: 'features', path: ['comments'] },
    ],
  },
  {
    id: 'music',
    label: '音乐播放器',
    icon: 'music',
    hint: '悬浮播放器、数据源、外观与交互',
    namespaces: ['music'],
    defaults: [{ ns: 'music', path: [] }],
  },
  {
    id: 'advanced',
    label: '高级',
    icon: 'sparkles',
    hint: '自定义 CSS、注入 HTML、访问统计与站内交互',
    namespaces: ['advanced', 'features'],
    defaults: [
      { ns: 'advanced', path: [] },
      { ns: 'features', path: ['viewTransitions'] },
      { ns: 'features', path: ['backToTop'] },
    ],
  },
];

/** Left navigation groups; grouping is purely visual. */
export const GROUPS: Array<{ label: string; tabs: TabId[] }> = [
  { label: '站点框架', tabs: ['identity', 'header', 'footer'] },
  { label: '页面区域', tabs: ['hero', 'home', 'content', 'comments'] },
  { label: '全局外观', tabs: ['appearance'] },
  { label: '扩展', tabs: ['music', 'advanced'] },
];

export const TAB_MAP = Object.fromEntries(TAB_DEFS.map((tab) => [tab.id, tab])) as Record<TabId, TabDef>;

export const TAB_COMPONENTS: Record<TabId, ComponentType> = {
  identity: IdentityTab,
  header: HeaderTab,
  hero: HeroTab,
  home: HomeTab,
  appearance: AppearanceTab,
  footer: FooterTab,
  content: ContentTab,
  comments: CommentsTab,
  music: MusicTab,
  advanced: AdvancedTab,
};