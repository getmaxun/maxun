/**
 * Remove credential-bearing URL components before a URL crosses a model or
 * durable-correlation boundary. The browser may still display the live URL in
 * the ephemeral visual stream, but API observations and session state do not.
 */
export function sanitizeBrowserUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}
