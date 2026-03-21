const API_URL = process.env['MERIDIAN_API_URL'] ?? 'http://localhost:3000';

export async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const url = `${API_URL}/api/v1${path}`;
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);
  const data = res.status === 204 ? null : await res.json();

  if (res.status >= 400) {
    const err = data as { error?: { code?: string; message?: string } };
    const message = err?.error?.message ?? `Request failed with status ${res.status}`;
    throw new Error(message);
  }

  return { status: res.status, data };
}
