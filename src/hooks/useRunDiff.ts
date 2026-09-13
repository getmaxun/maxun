import { useEffect, useMemo, useState } from 'react';
import { diffLines, Change } from 'diff';
import { getRunDiff, RunDiffResponse } from '../api/storage';

export type TextDiffFormat = 'text' | 'markdown' | 'html';

export const TEXT_DIFF_FORMATS: TextDiffFormat[] = ['text', 'markdown', 'html'];

export const DIFF_FORMAT_LABELS: Record<string, string> = {
  text: 'Text Content',
  markdown: 'Markdown',
  html: 'HTML',
  'screenshot-visible': 'Visible Screenshot',
  'screenshot-fullpage': 'Full-page Screenshot',
};

export type CapturedListRow = Record<string, any>;
export type CapturedListDiffRow = {
  key: string;
  previous?: CapturedListRow;
  current?: CapturedListRow;
  status: 'added' | 'removed' | 'modified' | 'unchanged';
};

const stableRowValue = (value: any): any => Array.isArray(value)
  ? value.map(stableRowValue)
  : value && typeof value === 'object'
    ? Object.keys(value).sort().reduce((result, key) => ({ ...result, [key]: stableRowValue(value[key]) }), {})
    : value;
const rowSignature = (row: CapturedListRow) => JSON.stringify(stableRowValue(row));
export const valuesEqual = (left: any, right: any) => JSON.stringify(stableRowValue(left)) === JSON.stringify(stableRowValue(right));

const matchCapturedListRows = (previous: CapturedListRow[], current: CapturedListRow[]): CapturedListDiffRow[] => {
  const unmatchedPrevious = new Set(previous.map((_, index) => index));
  const unmatchedCurrent = new Set(current.map((_, index) => index));
  const matches: Array<{ previousIndex?: number; currentIndex?: number }> = [];

  current.forEach((row, currentIndex) => {
    const signature = rowSignature(row);
    const previousIndex = Array.from(unmatchedPrevious).find((index) => rowSignature(previous[index]) === signature);
    if (previousIndex === undefined) return;
    matches.push({ previousIndex, currentIndex });
    unmatchedPrevious.delete(previousIndex);
    unmatchedCurrent.delete(currentIndex);
  });

  const columns = Array.from(new Set([...previous, ...current].flatMap((row) => Object.keys(row || {}))));
  const identityColumn = columns.find((column) => {
    if (!/(^id$|url|href|sku|email|name|title)/i.test(column)) return false;
    const previousValues = previous.map((row) => row?.[column]).filter((value) => value != null && value !== '').map(String);
    const currentValues = current.map((row) => row?.[column]).filter((value) => value != null && value !== '').map(String);
    return new Set(previousValues).size === previousValues.length
      && new Set(currentValues).size === currentValues.length
      && previousValues.some((value) => currentValues.includes(value));
  });

  if (identityColumn) {
    Array.from(unmatchedCurrent).forEach((currentIndex) => {
      const identity = current[currentIndex]?.[identityColumn];
      if (identity == null || identity === '') return;
      const previousIndex = Array.from(unmatchedPrevious).find(
        (index) => String(previous[index]?.[identityColumn]) === String(identity),
      );
      if (previousIndex === undefined) return;
      matches.push({ previousIndex, currentIndex });
      unmatchedPrevious.delete(previousIndex);
      unmatchedCurrent.delete(currentIndex);
    });
  }

  while (unmatchedPrevious.size && unmatchedCurrent.size) {
    const previousIndex = unmatchedPrevious.values().next().value as number;
    const currentIndex = unmatchedCurrent.values().next().value as number;
    matches.push({ previousIndex, currentIndex });
    unmatchedPrevious.delete(previousIndex);
    unmatchedCurrent.delete(currentIndex);
  }
  unmatchedPrevious.forEach((previousIndex) => matches.push({ previousIndex }));
  unmatchedCurrent.forEach((currentIndex) => matches.push({ currentIndex }));

  return matches
    .sort((left, right) => (left.currentIndex ?? Number.MAX_SAFE_INTEGER) - (right.currentIndex ?? Number.MAX_SAFE_INTEGER))
    .map(({ previousIndex, currentIndex }, index) => {
      const previousRow = previousIndex === undefined ? undefined : previous[previousIndex];
      const currentRow = currentIndex === undefined ? undefined : current[currentIndex];
      const status = !previousRow ? 'added' : !currentRow ? 'removed' : valuesEqual(previousRow, currentRow) ? 'unchanged' : 'modified';
      return { key: `${previousIndex ?? 'new'}-${currentIndex ?? 'removed'}-${index}`, previous: previousRow, current: currentRow, status };
    });
};

export const displayCapturedValue = (value: any) => value == null
  ? '—'
  : typeof value === 'object' ? JSON.stringify(value) : String(value);

export function useRunDiff(runId: string | undefined) {
  const [diffData, setDiffData] = useState<RunDiffResponse | null>(null);
  const [isDiffLoading, setIsDiffLoading] = useState(false);
  const [selectedDiffFormat, setSelectedDiffFormat] = useState('text');
  const [selectedCapturedGroup, setSelectedCapturedGroup] = useState('');
  const [selectedCapturedList, setSelectedCapturedList] = useState('');

  useEffect(() => {
    if (!runId) return;
    let isCancelled = false;
    setIsDiffLoading(true);

    getRunDiff(runId).then((data) => {
      if (isCancelled) return;
      setDiffData(data);

      const availableFormats = data ? [
        ...TEXT_DIFF_FORMATS.filter((format) => data.formats?.[format]),
        ...(data.capturedText ? ['captured-text'] : []),
        ...(data.capturedLists ? ['captured-list'] : []),
        ...Object.keys(data.screenshots || {}).map((name) => `screenshot:${name}`),
      ] : [];
      const firstChangedFormat = availableFormats.find((format) => {
        const changedKey = format.startsWith('screenshot:') ? format.slice('screenshot:'.length) : format;
        return data?.changedFormats?.includes(format) || data?.changedFormats?.includes(changedKey);
      });
      const initialFormat = firstChangedFormat || availableFormats[0];
      if (initialFormat) setSelectedDiffFormat(initialFormat);

      if (data?.capturedText) {
        try {
          const currentGroups = JSON.parse(data.capturedText.current || '{}');
          const previousGroups = JSON.parse(data.capturedText.previous || '{}');
          setSelectedCapturedGroup(Object.keys(currentGroups)[0] || Object.keys(previousGroups)[0] || '');
        } catch {
          setSelectedCapturedGroup('');
        }
      }
      if (data?.capturedLists) {
        setSelectedCapturedList(
          Object.keys(data.capturedLists.current || {})[0]
          || Object.keys(data.capturedLists.previous || {})[0]
          || '',
        );
      }
    }).finally(() => {
      if (!isCancelled) setIsDiffLoading(false);
    });

    return () => { isCancelled = true; };
  }, [runId]);

  const diffParts = useMemo<Change[]>(() => {
    if (!diffData || selectedDiffFormat.startsWith('screenshot:')) return [];
    const selectedOutput = selectedDiffFormat === 'captured-text'
      ? diffData.capturedText
      : diffData.formats?.[selectedDiffFormat as TextDiffFormat];
    const previous = selectedOutput?.previous ?? (selectedDiffFormat === 'text' ? diffData.previousText : '');
    const current = selectedOutput?.current ?? (selectedDiffFormat === 'text' ? diffData.currentText : '');
    return diffLines(previous, current, { ignoreWhitespace: true });
  }, [diffData, selectedDiffFormat]);

  const hasDiff = diffParts.some((part) => part.added || part.removed);
  const selectedScreenshotName = selectedDiffFormat.startsWith('screenshot:')
    ? selectedDiffFormat.slice('screenshot:'.length)
    : undefined;
  const selectedScreenshot = selectedScreenshotName ? diffData?.screenshots?.[selectedScreenshotName] : undefined;

  const getDiffImageSrc = (entry: string | { data?: string } | null | undefined) => {
    const value = typeof entry === 'object' && entry !== null ? entry.data : entry;
    if (!value) return '';
    if (value.startsWith('http') || value.startsWith('data:')) return value;
    return `data:image/png;base64,${value}`;
  };

  const diffOptions = useMemo(() => {
    if (!diffData) return [];
    return [
      ...TEXT_DIFF_FORMATS.filter((format) => diffData.formats?.[format]).map((format) => ({ key: format, label: DIFF_FORMAT_LABELS[format] })),
      ...(diffData.capturedText ? [{ key: 'captured-text', label: 'Captured Text' }] : []),
      ...(diffData.capturedLists ? [{ key: 'captured-list', label: 'Captured Lists' }] : []),
      ...Object.keys(diffData.screenshots || {}).map((name) => ({
        key: `screenshot:${name}`,
        label: DIFF_FORMAT_LABELS[name] || name,
      })),
    ];
  }, [diffData]);

  const capturedGroups = useMemo(() => {
    if (!diffData?.capturedText) return {} as Record<string, { previous: any[]; current: any[] }>;
    try {
      const previous = JSON.parse(diffData.capturedText.previous || '{}');
      const current = JSON.parse(diffData.capturedText.current || '{}');
      return Array.from(new Set([...Object.keys(previous), ...Object.keys(current)])).reduce((groups, name) => {
        groups[name] = {
          previous: Array.isArray(previous[name]) ? previous[name] : previous[name] == null ? [] : [previous[name]],
          current: Array.isArray(current[name]) ? current[name] : current[name] == null ? [] : [current[name]],
        };
        return groups;
      }, {} as Record<string, { previous: any[]; current: any[] }>);
    } catch {
      return {} as Record<string, { previous: any[]; current: any[] }>;
    }
  }, [diffData]);

  const capturedTableRows = useMemo(() => {
    const group = capturedGroups[selectedCapturedGroup];
    if (!group) return [];
    const rowCount = Math.max(group.previous.length, group.current.length);
    const rows: Array<{ key: string; label: string; previous: any; current: any; changed: boolean }> = [];
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const previousRow = group.previous[rowIndex] || {};
      const currentRow = group.current[rowIndex] || {};
      Array.from(new Set([...Object.keys(previousRow), ...Object.keys(currentRow)])).forEach((label) => {
        const previous = previousRow[label];
        const current = currentRow[label];
        rows.push({
          key: `${rowIndex}-${label}`,
          label: rowCount > 1 ? `${label} (row ${rowIndex + 1})` : label,
          previous,
          current,
          changed: JSON.stringify(previous) !== JSON.stringify(current),
        });
      });
    }
    return rows;
  }, [capturedGroups, selectedCapturedGroup]);

  const capturedListGroups = useMemo(() => {
    const previous = diffData?.capturedLists?.previous || {};
    const current = diffData?.capturedLists?.current || {};
    return Array.from(new Set([...Object.keys(previous), ...Object.keys(current)])).reduce((groups, name) => {
      groups[name] = {
        previous: Array.isArray(previous[name]) ? previous[name] : [],
        current: Array.isArray(current[name]) ? current[name] : [],
      };
      return groups;
    }, {} as Record<string, { previous: CapturedListRow[]; current: CapturedListRow[] }>);
  }, [diffData]);

  const capturedListRows = useMemo(() => {
    const group = capturedListGroups[selectedCapturedList];
    return group ? matchCapturedListRows(group.previous, group.current) : [];
  }, [capturedListGroups, selectedCapturedList]);

  const capturedListColumns = useMemo(() => {
    const group = capturedListGroups[selectedCapturedList];
    if (!group) return [];
    return Array.from(new Set([...group.previous, ...group.current].flatMap((row) => Object.keys(row || {}))));
  }, [capturedListGroups, selectedCapturedList]);

  return {
    diffData,
    isDiffLoading,
    selectedDiffFormat,
    setSelectedDiffFormat,
    selectedCapturedGroup,
    setSelectedCapturedGroup,
    selectedCapturedList,
    setSelectedCapturedList,
    diffParts,
    hasDiff,
    selectedScreenshot,
    diffOptions,
    capturedGroups,
    capturedTableRows,
    capturedListGroups,
    capturedListRows,
    capturedListColumns,
    getDiffImageSrc,
  };
}