import { describe, expect, test } from 'vite-plus/test';

import { planRelease, type ReleaseAction, type ReleaseState } from '../scripts/release/state.ts';

const expectedCommit = '0123456789abcdef0123456789abcdef01234567';
const expectedIntegrity = 'sha512-expected';

function state(overrides: Partial<ReleaseState>): ReleaseState {
  return {
    expectedCommit,
    expectedIntegrity,
    tagCommit: null,
    npmIntegrity: null,
    githubReleaseExists: false,
    ...overrides
  };
}
describe('planRelease', () => {
  test.each<{
    name: string;
    state: ReleaseState;
    actions: ReleaseAction[];
  }>([
    {
      name: 'fresh release',
      state: state({}),
      actions: ['create-tag', 'publish-tarball', 'create-github-release']
    },
    {
      name: 'tag already exists at the correct commit',
      state: state({ tagCommit: expectedCommit }),
      actions: ['publish-tarball', 'create-github-release']
    },
    {
      name: 'tag and matching npm version already exist',
      state: state({ tagCommit: expectedCommit, npmIntegrity: expectedIntegrity }),
      actions: ['create-github-release']
    },
    {
      name: 'release is already complete',
      state: state({
        tagCommit: expectedCommit,
        npmIntegrity: expectedIntegrity,
        githubReleaseExists: true
      }),
      actions: []
    }
  ])('returns ordered missing actions for $name', ({ state: releaseState, actions }) => {
    expect(planRelease(releaseState)).toEqual(actions);
  });

  test.each<{
    name: string;
    state: ReleaseState;
  }>([
    {
      name: 'tag points at the wrong commit',
      state: state({ tagCommit: 'ffffffffffffffffffffffffffffffffffffffff' })
    },
    {
      name: 'npm version exists without a tag',
      state: state({ npmIntegrity: expectedIntegrity })
    },
    {
      name: 'npm integrity differs',
      state: state({ tagCommit: expectedCommit, npmIntegrity: 'sha512-wrong' })
    },
    {
      name: 'GitHub release exists without a tag',
      state: state({ githubReleaseExists: true })
    },
    {
      name: 'GitHub release exists before npm publication',
      state: state({ tagCommit: expectedCommit, githubReleaseExists: true })
    }
  ])('throws before returning actions when $name', ({ state: releaseState }) => {
    expect(() => planRelease(releaseState)).toThrow();
  });
});
