const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';
let token: string | undefined = localStorage.getItem('accessToken') ?? undefined;

export function setToken(nextToken: string) {
  token = nextToken;
  localStorage.setItem('accessToken', nextToken);
}

export function getToken() {
  return token;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const url = new URL(`${baseUrl}${path}`);
  if (method === 'GET') {
    url.searchParams.set('_ts', Date.now().toString());
  }

  const response = await fetch(url.toString(), {
    ...init,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  if (response.status === 204 || response.status === 304) {
    return undefined as T;
  }

  const text = await response.text();
  if (!text) {
    return undefined as T;
  }

  return JSON.parse(text) as T;
}
