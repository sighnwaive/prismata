import type { Preview } from '@storybook/react';
import { createElement } from 'react';
import { TamaguiProvider } from 'tamagui';
import tamaguiConfig from '../../../packages/ui/tamagui.config';

const preview: Preview = {
  decorators: [
    (Story) =>
      createElement(
        TamaguiProvider,
        { config: tamaguiConfig },
        createElement(Story),
      )
  ],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i
      }
    },
    layout: 'centered'
  }
};

export default preview;
