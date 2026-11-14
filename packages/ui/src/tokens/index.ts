import { createFont, createTokens } from 'tamagui';

import { themes } from './themes';
import { fontTemplate, radiusScale, shadowScale, sizeScale, spaceScale, zIndexScale } from './templates';

export { themes } from './themes';
export {
  fontTemplate,
  palette,
  radiusScale,
  shadowScale,
  sizeScale,
  spaceScale,
  zIndexScale
} from './templates';

export const tokens = createTokens({
  color: {
    background: themes.light.background,
    text: themes.light.color,
    muted: themes.light.muted,
    panel: themes.light.panel,
    panelAlt: themes.light.panelAlt,
    border: themes.light.borderColor,
    primary: themes.light.primary,
    primaryHover: themes.light.primaryHover,
    primaryText: themes.light.primaryText,
    secondary: themes.light.secondary,
    secondaryText: themes.light.secondaryText,
    success: themes.light.success,
    danger: themes.light.danger
  },
  space: spaceScale,
  size: sizeScale,
  radius: radiusScale,
  zIndex: zIndexScale
});

export const bodyFont = createFont(fontTemplate);
export const headingFont = createFont({
  ...fontTemplate,
  weight: {
    4: '500',
    5: '600',
    6: '700',
    7: '700'
  }
});

export const fonts = {
  body: bodyFont,
  heading: headingFont
} as const;

export const shorthands = {
  p: 'padding',
  px: 'paddingHorizontal',
  py: 'paddingVertical',
  bg: 'backgroundColor'
} as const;

export type AppTokens = typeof tokens;
export type AppFonts = typeof fonts;
