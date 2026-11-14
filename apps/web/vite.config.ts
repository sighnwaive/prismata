import { defineConfig } from 'vite';

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1];
const isUserOrOrganizationSite = repositoryName?.endsWith('.github.io') ?? false;
const base =
  process.env.GITHUB_ACTIONS === 'true' && repositoryName && !isUserOrOrganizationSite
    ? `/${repositoryName}/`
    : '/';

export default defineConfig({ base });
