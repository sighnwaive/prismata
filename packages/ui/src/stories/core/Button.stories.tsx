import type { Meta, StoryObj } from '@storybook/react';
import { Stack } from '../../components/core/Stack';
import { Button } from '../../components/core/Button';

const meta = {
  title: 'Core/Button',
  component: Button,
  args: {
    children: 'Launch prism',
    tone: 'primary'
  },
  tags: ['autodocs']
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Primary: Story = {};

export const States: Story = {
  render: () => (
    <Stack>
      <Button>Launch prism</Button>
      <Button tone="secondary">Queue action</Button>
      <Button loading>Syncing</Button>
      <Button disabled>Unavailable</Button>
    </Stack>
  )
};
