export const loadBackendConfig = (env = process.env) => {
  const required = (name, variable) => {
    const value = env[variable];
    if (!value) throw new Error(`Missing backend configuration: ${name}`);
    return value;
  };
  return {
    databaseUrl: required('databaseUrl', 'DATABASE_URL'),
    jwtSecret: required('jwtSecret', 'PRISMATA_JWT_SECRET'),
    sessionSecret: required('sessionSecret', 'PRISMATA_SESSION_SECRET'),
    joystickClientId: required('joystickClientId', 'JOYSTICK_CLIENT_ID'),
    joystickClientSecret: required('joystickClientSecret', 'JOYSTICK_CLIENT_SECRET'),
    joystickTokenUrl: required('joystickTokenUrl', 'JOYSTICK_TOKEN_URL'),
    apiUrl: required('apiUrl', 'PRISMATA_API_URL'),
    publicUrl: required('publicUrl', 'PRISMATA_PUBLIC_URL'),
    desktopCallbackUrl: required('desktopCallbackUrl', 'PRISMATA_DESKTOP_CALLBACK_URL'),
    mobileCallbackUrl: required('mobileCallbackUrl', 'PRISMATA_MOBILE_CALLBACK_URL'),
  };
};
