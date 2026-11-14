import { createElement } from 'react';
import { getStorybookUI, configure } from '@storybook/react-native';
import { TamaguiProvider } from 'tamagui';
import tamaguiConfig from '../../../packages/ui/tamagui.config';

configure(() => {
  require('../../../packages/ui/src/stories/Button.stories');
}, module);

const StorybookUI = getStorybookUI({});

export default function StorybookRoot() {
  return createElement(
    TamaguiProvider,
    { config: tamaguiConfig },
    createElement(StorybookUI),
  );
}
