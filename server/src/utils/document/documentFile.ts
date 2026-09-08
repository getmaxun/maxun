import path from 'path';

export const PDF_MIME_TYPE = 'application/pdf';
export const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const CSV_MIME_TYPE = 'text/csv';
export const JPEG_MIME_TYPE = 'image/jpeg';
export const PNG_MIME_TYPE = 'image/png';

const ALTERNATE_CSV_MIME_TYPES = new Set<string>(['application/csv', 'text/x-csv']);
const ALTERNATE_JPEG_MIME_TYPES = new Set<string>(['image/jpg']);

const SUPPORTED_DOCUMENT_MIME_TYPES = new Set<string>([
  PDF_MIME_TYPE,
  DOCX_MIME_TYPE,
  XLSX_MIME_TYPE,
  CSV_MIME_TYPE,
  JPEG_MIME_TYPE,
  PNG_MIME_TYPE
]);

export const isSupportedDocumentMimeType = (mimeType: string | undefined): boolean =>
  Boolean(mimeType && (
    SUPPORTED_DOCUMENT_MIME_TYPES.has(mimeType) 
    || ALTERNATE_CSV_MIME_TYPES.has(mimeType)
    || ALTERNATE_JPEG_MIME_TYPES.has(mimeType)));

export const isImageMimeType = (mimeType: string | undefined): boolean => 
  mimeType === JPEG_MIME_TYPE || mimeType === PNG_MIME_TYPE;

export const normalizeDocumentMimeType = (
  mimeType: string | undefined,
  originalFileName?: string
): string | null => {
  if (mimeType && ALTERNATE_CSV_MIME_TYPES.has(mimeType)) return CSV_MIME_TYPE;
  if (mimeType && ALTERNATE_JPEG_MIME_TYPES.has(mimeType)) return JPEG_MIME_TYPE;
  if (isSupportedDocumentMimeType(mimeType)) return mimeType as string;

  const extension = path.extname(originalFileName || '').toLowerCase();
  if (extension === '.pdf') return PDF_MIME_TYPE;
  if (extension === '.docx') return DOCX_MIME_TYPE;
  if (extension === '.xlsx') return XLSX_MIME_TYPE;
  if (extension === '.csv') return CSV_MIME_TYPE;
  if (extension === '.jpg' || extension === '.jpeg') return JPEG_MIME_TYPE;
  if (extension === '.png') return PNG_MIME_TYPE;
  return null;
};

export const getDocumentExtensionForMimeType = (mimeType: string): '.pdf' | '.docx' | '.xlsx' | '.csv' | '.jpg' | '.png' => {
  if (mimeType === DOCX_MIME_TYPE) return '.docx';
  if (mimeType === XLSX_MIME_TYPE) return '.xlsx';
  if (mimeType === CSV_MIME_TYPE || ALTERNATE_CSV_MIME_TYPES.has(mimeType)) return '.csv';
  if (mimeType === JPEG_MIME_TYPE || ALTERNATE_JPEG_MIME_TYPES.has(mimeType)) return '.jpg';
  if (mimeType === PNG_MIME_TYPE) return '.png';
  return '.pdf';
};

