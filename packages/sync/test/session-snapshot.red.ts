import { describeAuthState, type AuthStateSnapshot } from '../src/auth';

const snapshot: AuthStateSnapshot = {
  state: 'anonymous',
  isAnonymous: true,
  userId: 'user-123',
  expiresAt: 1_700_000_000,
};

describeAuthState(snapshot);

describeAuthState(snapshot);
