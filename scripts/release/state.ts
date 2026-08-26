export type ReleaseAction = 'create-tag' | 'publish-tarball' | 'create-github-release';

export interface ReleaseState {
  expectedCommit: string;
  expectedIntegrity: string;
  tagCommit: string | null;
  npmIntegrity: string | null;
  githubReleaseExists: boolean;
}

export function planRelease(state: ReleaseState): ReleaseAction[] {
  if (state.tagCommit !== null && state.tagCommit !== state.expectedCommit) {
    throw new Error('The release tag points at a different commit.');
  }

  if (state.npmIntegrity !== null && state.tagCommit === null) {
    throw new Error('The npm version exists without a release tag.');
  }

  if (state.npmIntegrity !== null && state.npmIntegrity !== state.expectedIntegrity) {
    throw new Error('The npm package integrity does not match the verified tarball.');
  }

  if (state.githubReleaseExists && state.tagCommit === null) {
    throw new Error('The GitHub release exists without a release tag.');
  }

  if (state.githubReleaseExists && state.npmIntegrity === null) {
    throw new Error('The GitHub release exists before npm publication.');
  }

  const actions: ReleaseAction[] = [];
  if (state.tagCommit === null) actions.push('create-tag');
  if (state.npmIntegrity === null) actions.push('publish-tarball');
  if (!state.githubReleaseExists) actions.push('create-github-release');
  return actions;
}
