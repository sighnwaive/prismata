import type { Meta, StoryObj } from '@storybook/react';
import { Stack } from '../../components/core/Stack';
import { Surface } from '../../components/core/Surface';
import { Text } from '../../components/core/Text';

const meta = {
  title: 'Core/Surface',
  component: Surface,
  tags: ['autodocs']
} satisfies Meta<typeof Surface>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Surface>
      <Text>Default surface for cards, settings groups, and app sections.</Text>
    </Surface>
  )
};

export const Elevated: Story = {
  render: () => (
    <Stack>
      <Surface elevated>
        <Text weight="semibold">Elevated panel</Text>
        <Text tone="muted">Adds a shadow for focus-heavy content.</Text>
      </Surface>
      <Surface tone="subtle">
        <Text>Subtle tone for grouped content.</Text>
      </Surface>
    </Stack>
  )
};
