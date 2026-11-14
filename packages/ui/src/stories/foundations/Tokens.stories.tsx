import type { Meta, StoryObj } from '@storybook/react';
import { Stack } from '../../components/core/Stack';
import { Surface } from '../../components/core/Surface';
import { Text } from '../../components/core/Text';
import { palette, radiusScale, sizeScale, spaceScale, themes } from '../../tokens';

const meta = {
  title: 'Foundations/Tokens',
  tags: ['autodocs']
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const scaleEntries = {
  Space: spaceScale,
  Size: sizeScale,
  Radius: radiusScale
} as const;

export const Overview: Story = {
  render: () => (
    <Stack gap="$4">
      <Surface elevated>
        <Stack gap="$2">
          <Text size="lg" weight="semibold">Theme colors</Text>
          <Text tone="muted">Light theme semantic values exposed to shared primitives.</Text>
          {Object.entries(themes.light).map(([name, value]) => (
            <Stack key={name} align="center" flexDirection="row" gap="$3">
              <Surface bg={value} borderRadius="$2" height={40} width={40} />
              <Text>{name}: {value}</Text>
            </Stack>
          ))}
        </Stack>
      </Surface>
      <Surface>
        <Stack gap="$3">
          <Text size="lg" weight="semibold">Core scales</Text>
          {Object.entries(scaleEntries).map(([scaleName, values]) => (
            <Stack key={scaleName} gap="$2">
              <Text weight="semibold">{scaleName}</Text>
              {Object.entries(values).map(([name, value]) => (
                <Text key={name} tone="muted">{name}: {String(value)}</Text>
              ))}
            </Stack>
          ))}
        </Stack>
      </Surface>
      <Surface tone="subtle">
        <Stack gap="$2">
          <Text size="lg" weight="semibold">Palette</Text>
          {Object.entries(palette).map(([name, value]) => (
            <Text key={name}>{name}: {value}</Text>
          ))}
        </Stack>
      </Surface>
    </Stack>
  )
};
