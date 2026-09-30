/** Quotes one CSV field, doubling embedded quotes (RFC 4180). Keeps 0 and false. */
export function escapeCsvField(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function convertToCSV(
  data: any[],
  columns: string[],
  isSchemaData: boolean = false,
  isTabular: boolean = false,
): string {
  if (isSchemaData && !isTabular && data.length === 1) {
    const header = 'Label,Value';
    const rows = columns.map(column =>
      `${escapeCsvField(column)},${escapeCsvField(data[0][column])}`
    );
    return [header, ...rows].join('\n');
  }

  const header = columns.map(escapeCsvField).join(',');
  const rows = data.map(row =>
    columns.map(col => escapeCsvField(row[col])).join(',')
  );
  return [header, ...rows].join('\n');
}
