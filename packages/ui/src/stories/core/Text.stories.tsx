import type { Meta, StoryObj } from '@storybook/react';
import { Stack } from '../../components/core/Stack';
import { Text } from '../../components/core/Text';

const meta = {
  title: 'Core/Text',
  component: Text,
  args: {
    children: 'Prismata shared typography'
  },
  tags: ['autodocs']
} satisfies Meta<typeof Text>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ScaleAndTone: Story = {
  render: () => (
    <Stack>
      <Text size="xl" weight="bold">Headline</Text>
      <Text size="lg" weight="semibold">Section title</Text>
      <Text>Body copy for shared surfaces and actions.</Text>
      <Text tone="muted">Muted supporting text.</Text>
      <Text tone="primary">Highlighted primary text.</Text>
      <Text tone="danger">Destructive or error state text.</Text>
    </Stack>
  )
};
