export type RecordData = {
  id: string;
  revision: number;
  [key: string]: unknown;
};
export type Page = { items: RecordData[]; next_cursor: string | null };
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const uncertainKeys = new Map<string, string>();
let accessToken: () => Promise<string> = async () => "";
export function setTokenProvider(provider: () => Promise<string>) {
  accessToken = provider;
}
export async function request<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    revision?: number;
    key?: string;
    csrf?: string;
    public?: boolean;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  const fingerprint = JSON.stringify([
    path,
    options.method,
    options.revision,
    options.body instanceof FormData
      ? [...options.body.entries()].map(([k, v]) => [
          k,
          typeof v === "string"
            ? v
            : { name: v.name, size: v.size, lastModified: v.lastModified },
        ])
      : options.body,
  ]);
  const mutationKey =
    options.key ?? uncertainKeys.get(fingerprint) ?? crypto.randomUUID();
  if (!options.public) {
    const token = await accessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  if (options.method && options.method !== "GET") {
    headers["Idempotency-Key"] = mutationKey;
    if (options.revision !== undefined)
      headers["If-Match"] = `"${options.revision}"`;
  }
  if (options.csrf) headers["X-CSRF-Token"] = options.csrf;
  const body =
    options.body instanceof FormData
      ? options.body
      : options.body === undefined
        ? undefined
        : JSON.stringify(options.body);
  if (body && !(body instanceof FormData))
    headers["Content-Type"] = "application/json";
  let response: Response;
  try {
    response = await fetch(
      `${options.public ? "/public/v1" : "/api/v1"}${path}`,
      {
        method: options.method ?? "GET",
        headers,
        body,
        credentials: "same-origin",
      },
    );
  } catch (error) {
    if (options.method && options.method !== "GET")
      uncertainKeys.set(fingerprint, mutationKey);
    throw error;
  }
  if (response.status >= 500) uncertainKeys.set(fingerprint, mutationKey);
  else uncertainKeys.delete(fingerprint);
  if (!response.ok) {
    let error;
    try {
      error = await response.json();
    } catch {
      error = {};
    }
    throw new ApiError(
      response.status,
      error.error?.code ?? "request_failed",
      error.error?.message ?? `Request failed (${response.status})`,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}
export function answerValue(type: string, value: string) {
  if (type === "multiple_choice") return value ? value.split(",") : [];
  return value;
}
