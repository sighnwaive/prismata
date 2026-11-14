import { createTamagui } from 'tamagui';

import { fonts, shorthands, themes, tokens } from './src/tokens';

const config = createTamagui({
  tokens,
  fonts,
  themes,
  defaultTheme: 'light',
  shorthands
});

export type AppTamaguiConfig = typeof config;

declare module 'tamagui' {
  interface TamaguiCustomConfig extends AppTamaguiConfig {}
}

export default config;
