export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly issues: {
      path: (string | number)[];
      message: string;
    }[] = [],
  ) {
    super(message);
  }
}
async function requestLocal(path: string, init: RequestInit) {
  try {
    return await fetch(path, init);
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ApiError(
      0,
      "Unable to reach the server. Check your connection and try again.",
    );
  }
}
async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError(
      response.status,
      "The server returned an unreadable response. Try again.",
    );
  }
}
let csrfToken: string | null = null;
let refreshing: Promise<void> | null = null;
export function setCsrf(token: string | null) {
  csrfToken = token;
}
export async function refreshCsrf() {
  if (!refreshing)
    refreshing = (async () => {
      const response = await requestLocal("/api/auth/csrf", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok)
        throw new ApiError(
          response.status,
          "Your session expired. Sign in again.",
        );
      const data = await readJson<{ csrfToken: string }>(response);
      csrfToken = data.csrfToken;
    })().finally(() => {
      refreshing = null;
    });
  return refreshing;
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
  retried = false,
): Promise<T> {
  if (!path.startsWith("/api/")) throw new Error("API path must be local");
  const mutation = !["GET", "HEAD"].includes(method);
  if (mutation && path !== "/api/auth/browser" && !csrfToken)
    await refreshCsrf();
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (mutation && csrfToken) headers["X-CSRF-Token"] = csrfToken;
  const response = await requestLocal(path, {
    method,
    headers,
    credentials: "same-origin",
    cache: "no-store",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal ? { signal } : {}),
  });
  if (response.status === 204) return undefined as T;
  if (response.status === 401 && path !== "/api/auth/browser")
    window.dispatchEvent(new Event("mytuner:expired"));
  const data = await readJson<
    T & {
      error?: string;
      issues?: { path: (string | number)[]; message: string }[];
    }
  >(response);
  if (!response.ok) {
    if (
      response.status === 403 &&
      data.error === "CSRF token required" &&
      !retried
    ) {
      await refreshCsrf();
      return api<T>(path, method, body, signal, true);
    }
    throw new ApiError(
      response.status,
      data.error ?? "The request could not be completed.",
      data.issues ?? [],
    );
  }
  return data;
}
