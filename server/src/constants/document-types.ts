// A module to map between MIME and file extensions for incoming files.
// Note that browsers always send 'image/jpeg' as the MIME type for both
// .jpg and .jpeg files. Therefore there is no need to consider 'image/jpg'.

export const DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

export type DocumentMimeType = (typeof DOCUMENT_MIME_TYPES)[number];

const DOCUMENT_MIME_TYPE_SET = new Set<string>(DOCUMENT_MIME_TYPES);

export function isDocumentMimeType(value: unknown): value is DocumentMimeType {
  return typeof value === 'string' && DOCUMENT_MIME_TYPE_SET.has(value);
}

// Used at upload time
export const DOCUMENT_MIME_TO_EXT: Record<DocumentMimeType, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

// Used at readback time
export const DOCUMENT_EXT_TO_MIME: Record<string, DocumentMimeType> =
  Object.fromEntries(
    Object.entries(DOCUMENT_MIME_TO_EXT).map(([mime, ext]) => [
      ext,
      mime as DocumentMimeType,
    ]),
  );
