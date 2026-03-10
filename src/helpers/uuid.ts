/**
 * generateUUID() that works in non-secure contexts (plain HTTP on non-localhost).
 * crypto.randomUUID is only available in secure contexts (HTTPS or localhost).
 * Falls back to crypto.getRandomValues(), then Math.random() as last resort.
 */
export const generateUUID = (): string => {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  if (crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return [...bytes].map((b, i) =>
      ([4, 6, 8, 10].includes(i) ? '-' : '') + b.toString(16).padStart(2, '0')
    ).join('');
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
};
