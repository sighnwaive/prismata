import { createElement } from 'react';
import type { ReactNode } from 'react';
import { YStack } from 'tamagui';

export type StackProps = {
  children?: ReactNode;
  align?: 'start' | 'center' | 'end' | 'stretch';
  surface?: boolean;
  [key: string]: unknown;
};

const alignItemsByVariant = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
} as const;

export function Stack({ align = 'stretch', children, surface = false, ...props }: StackProps) {
  const frameProps = {
    alignItems: alignItemsByVariant[align],
    gap: '$3',
    ...(surface
      ? {
          backgroundColor: '$panel',
          borderColor: '$borderColor',
          borderWidth: 1,
          borderRadius: '$3',
          padding: '$4',
        }
      : null),
    ...props,
  };

  return createElement(YStack as any, frameProps, children);
}
