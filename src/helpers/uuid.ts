/**
 * generateUUID() that works in non-secure contexts (plain HTTP on non-localhost).
 * crypto.randomUUID is only available in secure contexts (HTTPS or localhost).
 */
export const generateUUID = (): string =>
  crypto.randomUUID?.() ??
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
