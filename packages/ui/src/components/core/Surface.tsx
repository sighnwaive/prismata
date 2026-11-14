import { createElement } from 'react';
import type { ReactNode } from 'react';
import { YStack } from 'tamagui';

export type SurfaceProps = {
  children?: ReactNode;
  tone?: 'default' | 'subtle';
  elevated?: boolean;
  bg?: string;
  [key: string]: unknown;
};

export function Surface({ bg, children, elevated = false, tone = 'default', ...props }: SurfaceProps) {
  const frameProps = {
    backgroundColor: bg ?? (tone === 'subtle' ? '$panelAlt' : '$panel'),
    borderColor: '$borderColor',
    borderRadius: '$3',
    borderWidth: 1,
    padding: '$4',
    ...(elevated
      ? {
          shadowColor: 'rgba(15, 23, 42, 0.12)',
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 1,
          shadowRadius: 18,
        }
      : null),
    ...props,
  };

  return createElement(YStack as any, frameProps, children);
}
