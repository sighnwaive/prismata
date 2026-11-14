# Shared UI

`@prismata/ui` is the shared component package for both desktop/web and React Native surfaces.

## Structure

- `src/tokens` holds the shared token scales, semantic themes, and Tamagui token/font builders.
- `src/components/core` holds the first cross-platform core app kit primitives: `Stack`, `Text`, `Surface`, and `Button`.
- `tamagui.config.ts` composes the shared Tamagui config from `src/tokens`.
- `src/stories` holds token foundations stories plus shared component stories for Storybook.

## Storybook hosts

- `apps/storybook` is the dedicated web Storybook host so component stories stay independent from the desktop shell.
- `apps/mobile/.rnstorybook` is the React Native Storybook bootstrap kept inside the mobile app.

## Commands

- `pnpm storybook:web` starts the web Storybook host.
- `pnpm storybook:web:build` builds the web Storybook host.
- `pnpm storybook:mobile` starts Metro for the mobile app, with `.rnstorybook` available as the Storybook entrypoint scaffold.
