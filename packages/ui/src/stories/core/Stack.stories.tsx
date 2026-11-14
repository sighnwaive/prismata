import type { Meta, StoryObj } from '@storybook/react';
import { Stack } from '../../components/core/Stack';
import { Surface } from '../../components/core/Surface';
import { Text } from '../../components/core/Text';

const meta = {
  title: 'Core/Stack',
  component: Stack,
  tags: ['autodocs']
} satisfies Meta<typeof Stack>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Stack>
      <Surface>
        <Text weight="semibold">Primary content</Text>
      </Surface>
      <Surface tone="subtle">
        <Text tone="muted">Secondary content</Text>
      </Surface>
    </Stack>
  )
};

export const SurfaceLayout: Story = {
  render: () => (
    <Stack surface>
      <Text size="lg" weight="semibold">Stack as a framed layout primitive</Text>
      <Text tone="muted">Use the surface variant when layout and container styling should stay coupled.</Text>
    </Stack>
  )
};
