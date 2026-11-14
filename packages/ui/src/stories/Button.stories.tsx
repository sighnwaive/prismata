import type { Meta, StoryObj } from '@storybook/react';
import { Button } from '../components/core/Button';

const meta = {
  title: 'Components/Button',
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

export const Secondary: Story = {
  args: {
    children: 'Queue action',
    tone: 'secondary'
  }
};
