import {
  getBackendSettings,
  upsertBackendDeviceSelf,
  type BackendSettingsResponse,
  type UpsertBackendDeviceSelfRequest,
  type UpsertBackendDeviceSelfResponse,
} from '../src/index';

type ExpectedBackendSettingsResponse = {
  settings: Record<string, unknown>;
  updatedAt: string;
  version: number;
};

type ExpectedUpsertBackendDeviceSelfRequest = {
  appInstanceId: string;
  deviceId: string;
  deviceName: string;
  platform: 'desktop' | 'mobile';
};

type ExpectedUpsertBackendDeviceSelfResponse = ExpectedUpsertBackendDeviceSelfRequest & {
  lastSeenAt: string;
};

type ExpectedGetBackendSettings = (input: {
  backendUrl: string;
  sessionCookie: string;
  fetchImpl?: typeof fetch;
}) => Promise<BackendSettingsResponse>;

type ExpectedUpsertBackendDeviceSelf = (input: {
  backendUrl: string;
  sessionCookie: string;
  device: UpsertBackendDeviceSelfRequest;
  fetchImpl?: typeof fetch;
}) => Promise<UpsertBackendDeviceSelfResponse>;

type IsExact<A, B> =
  (<Value>() => Value extends A ? 1 : 2) extends (<Value>() => Value extends B ? 1 : 2)
    ? (<Value>() => Value extends B ? 1 : 2) extends (<Value>() => Value extends A ? 1 : 2)
      ? true
      : false
    : false;

type Assert<T extends true> = T;

type BackendSettingsResponseMatchesContract = Assert<
  IsExact<BackendSettingsResponse, ExpectedBackendSettingsResponse>
>;

type UpsertBackendDeviceSelfRequestMatchesContract = Assert<
  IsExact<UpsertBackendDeviceSelfRequest, ExpectedUpsertBackendDeviceSelfRequest>
>;

type UpsertBackendDeviceSelfResponseMatchesContract = Assert<
  IsExact<UpsertBackendDeviceSelfResponse, ExpectedUpsertBackendDeviceSelfResponse>
>;

const typedGetBackendSettings: ExpectedGetBackendSettings = getBackendSettings;
const typedUpsertBackendDeviceSelf: ExpectedUpsertBackendDeviceSelf =
  upsertBackendDeviceSelf;
const backendSettingsResponseMatchesContract: BackendSettingsResponseMatchesContract = true;
const upsertBackendDeviceSelfRequestMatchesContract: UpsertBackendDeviceSelfRequestMatchesContract =
  true;
const upsertBackendDeviceSelfResponseMatchesContract: UpsertBackendDeviceSelfResponseMatchesContract =
  true;

void typedGetBackendSettings;
void typedUpsertBackendDeviceSelf;
void backendSettingsResponseMatchesContract;
void upsertBackendDeviceSelfRequestMatchesContract;
void upsertBackendDeviceSelfResponseMatchesContract;
