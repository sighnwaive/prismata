import type {
  AuthBootstrapResult,
  AuthSessionState,
  AuthStateSnapshot,
  DeviceRecordResult,
} from '../src/auth';

type ExpectedAppFacingAuthBootstrapResult = {
  state: AuthSessionState;
  snapshot: AuthStateSnapshot;
  deviceRecord: DeviceRecordResult;
};

type IsExact<A, B> =
  (<Value>() => Value extends A ? 1 : 2) extends (<Value>() => Value extends B ? 1 : 2)
    ? (<Value>() => Value extends B ? 1 : 2) extends (<Value>() => Value extends A ? 1 : 2)
      ? true
      : false
    : false;

type Assert<T extends true> = T;

type AuthBootstrapResultMatchesAppFacingContract = Assert<
  IsExact<AuthBootstrapResult, ExpectedAppFacingAuthBootstrapResult>
>;

const authBootstrapResultMatchesAppFacingContract: AuthBootstrapResultMatchesAppFacingContract =
  true;

void authBootstrapResultMatchesAppFacingContract;
