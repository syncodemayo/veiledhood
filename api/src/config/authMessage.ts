const DEFAULT_LOGIN_MESSAGE =
  "Welcome to Veiledhood! Sign this message to Login to the app";

export function getLoginMessage(override?: string | undefined): string {
  if (override && override.trim().length > 0) {
    return override;
  }
  return DEFAULT_LOGIN_MESSAGE;
}
