import * as auth from '../src/auth';

type Assert<T extends true> = T;

type SharedAuthContractRemovedLegacySubscription = Assert<
  'subscribeToAuthSession' extends keyof typeof auth ? false : true
>;

const sharedAuthContractRemovedLegacySubscription: SharedAuthContractRemovedLegacySubscription =
  true;

void sharedAuthContractRemovedLegacySubscription;
