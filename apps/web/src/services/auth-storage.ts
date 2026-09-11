/**
 * Auth tokens live in sessionStorage so each browser tab/window keeps its own
 * login. localStorage is shared by every tab of the same origin, which let a
 * second window's login silently take over the first window's session.
 */
const ACCESS_TOKEN_KEY = 'accessToken';
const REFRESH_TOKEN_KEY = 'refreshToken';

const storage = () => window.sessionStorage;

export const getAccessToken = () => storage().getItem(ACCESS_TOKEN_KEY);
export const getRefreshToken = () => storage().getItem(REFRESH_TOKEN_KEY);

export const setAuthTokens = (accessToken: string, refreshToken: string) => {
  storage().setItem(ACCESS_TOKEN_KEY, accessToken);
  storage().setItem(REFRESH_TOKEN_KEY, refreshToken);
};

export const clearAuthTokens = () => {
  storage().removeItem(ACCESS_TOKEN_KEY);
  storage().removeItem(REFRESH_TOKEN_KEY);
  // Drop tokens written by older builds that used localStorage.
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
};
