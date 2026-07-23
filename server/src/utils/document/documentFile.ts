import path from 'path';

export const PDF_MIME_TYPE = 'application/pdf';
export const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const SUPPORTED_DOCUMENT_MIME_TYPES = new Set<string>([PDF_MIME_TYPE, DOCX_MIME_TYPE]);

export const isSupportedDocumentMimeType = (mimeType: string | undefined): boolean =>
  Boolean(mimeType && SUPPORTED_DOCUMENT_MIME_TYPES.has(mimeType));

export const normalizeDocumentMimeType = (
  mimeType: string | undefined,
  originalFileName?: string
): string | null => {
  if (isSupportedDocumentMimeType(mimeType)) return mimeType as string;

  const extension = path.extname(originalFileName || '').toLowerCase();
  if (extension === '.pdf') return PDF_MIME_TYPE;
  if (extension === '.docx') return DOCX_MIME_TYPE;
  return null;
};

export const getDocumentExtensionForMimeType = (mimeType: string): '.pdf' | '.docx' => (
  mimeType === DOCX_MIME_TYPE ? '.docx' : '.pdf'
);

