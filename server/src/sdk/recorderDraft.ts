import { Page } from 'playwright-core';
import { v4 as uuid } from 'uuid';
import RecorderDraft, {
  DraftFieldState,
  DraftListState,
  RecorderDraftState,
} from '../models/RecorderDraft';
import Robot from '../models/Robot';
import { createRemoteBrowserForValidation, destroyRemoteBrowser } from '../browser-management/controller';
import { SelectorValidator } from './selectorValidator';
import { normalizeRobotUrl, persistNativeRobot } from './llmRobot';
import logger from '../logger';

const MAX_DISCOVERY_LISTS = 12;
const MAX_PREVIEW_PAGES = 10;
const DEFAULT_PREVIEW_LIMIT = 100;
const MIN_FIELD_COVERAGE = 0.8;

type ValidationScope = 'current-page' | 'multi-page';
type FieldOperation = 'include' | 'exclude' | 'rename';

export type RecorderDraftErrorCode =
  | 'draft_not_found'
  | 'invalid_request'
  | 'list_not_selected'
  | 'candidate_not_found'
  | 'field_not_found'
  | 'validation_failed'
  | 'robot_name_conflict';

export class RecorderDraftError extends Error {
  public constructor(
    public readonly code: RecorderDraftErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'RecorderDraftError';
  }
}

interface DiscoveredGroup {
  xpath?: string;
  count?: number;
  sampleTexts?: string[];
  semanticParent?: string;
  fingerprint?: { tagName?: string; attributes?: string };
  isNavOrFooter?: boolean;
  ariaRole?: string | null;
}

interface PreviewResult {
  rows: Record<string, string>[];
  diagnostics: Array<Record<string, unknown>>;
  pagesVisited: number;
  truncated: boolean;
}

interface DraftValidationResult {
  valid: boolean;
  scope: ValidationScope;
  diagnostics: Array<Record<string, unknown>>;
  coverage: Record<string, number>;
  pagesVisited: number;
}

const cloneState = (state: RecorderDraftState): RecorderDraftState => JSON.parse(JSON.stringify(state));

const normalizeAttributes = (raw: string | undefined): string[] => (raw || '')
  .split('|')
  .map(value => value.trim())
  .filter(Boolean)
  .slice(0, 20);

const textValue = (element: Element | null, attribute: string): string => {
  if (!element) return '';
  if (attribute !== 'innerText' && attribute !== 'textContent') return element.getAttribute(attribute) || '';
  return ((element as HTMLElement).innerText || element.textContent || '').trim();
};

/** Extract list rows while keeping selectors inside this server-side operation. */
const extractRows = async (
  page: Page,
  listSelector: string,
  fields: DraftFieldState[],
  limit: number,
): Promise<Record<string, string>[]> => page.evaluate(({ listSelector: listSel, fields: fieldDefs, limit: rowLimit }) => {
  const evaluateSelector = (selector: string, context: Document | Element = document): Element[] => {
    try {
      const isXPath = selector.startsWith('//') || selector.startsWith('(//') || selector.startsWith('/');
      if (isXPath) {
        const result = document.evaluate(selector, context, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        return Array.from({ length: result.snapshotLength }, (_, index) => result.snapshotItem(index) as Element).filter(Boolean);
      }
      return Array.from(context.querySelectorAll(selector));
    } catch {
      return [];
    }
  };

  const readValue = (element: Element | null, attribute: string): string => {
    if (!element) return '';
    if (attribute !== 'innerText' && attribute !== 'textContent') return element.getAttribute(attribute) || '';
    return (((element as HTMLElement).innerText || element.textContent || '') as string).trim();
  };

  const items = evaluateSelector(listSel).slice(0, rowLimit);
  const rows: Record<string, string>[] = [];
  for (let index = 0; index < items.length; index++) {
    const row: Record<string, string> = {};
    for (const field of fieldDefs) {
      const isXPath = field.selector.startsWith('//') || field.selector.startsWith('(//') || field.selector.startsWith('/');
      const matches = isXPath ? evaluateSelector(field.selector) : evaluateSelector(field.selector, items[index]);
      row[field.label] = readValue(matches[index] || matches[0] || null, field.attribute);
    }
    rows.push(row);
  }
  return rows;
}, { listSelector, fields, limit });

const withValidationPage = async <T>(
  userId: string,
  url: string,
  operation: (page: Page, validator: SelectorValidator) => Promise<T>,
): Promise<T> => {
  let browserId: string | null = null;
  const validator = new SelectorValidator();
  try {
    const created = await createRemoteBrowserForValidation(userId);
    browserId = created.browserId;
    await validator.initialize(created.page, url);
    return await operation(created.page, validator);
  } finally {
    await validator.close();
    if (browserId) {
      try {
        await destroyRemoteBrowser(browserId, userId);
      } catch (error: any) {
        logger.warn(`[RecorderDraft] Failed to clean up validation browser: ${error.message}`);
      }
    }
  }
};

const getListState = (state: RecorderDraftState): DraftListState => {
  const list = state.lists.find(candidate => candidate.id === state.selectedListId);
  if (!list) throw new RecorderDraftError('list_not_selected', 'Select a list candidate before continuing');
  return list;
};

const includedFields = (list: DraftListState): DraftFieldState[] => list.fields.filter(field => field.included);

const publicField = (field: DraftFieldState) => ({
  id: field.id,
  sourceLabel: field.sourceLabel,
  label: field.label,
  attribute: field.attribute,
  tag: field.tag,
  isShadow: field.isShadow,
  samples: field.samples,
  included: field.included,
});

const publicList = (list: DraftListState, selected: boolean) => ({
  id: list.id,
  tag: list.tag,
  count: list.count,
  semanticParent: list.semanticParent,
  sampleTexts: list.sampleTexts,
  attributes: list.attributes,
  fields: list.fields.map(publicField),
  pagination: {
    type: list.pagination.type || 'none',
    tested: list.pagination.tested,
  },
  selected,
});

export const serializeRecorderDraft = (draft: RecorderDraft) => {
  const state = draft.state;
  return {
    id: draft.id,
    name: draft.name,
    description: draft.description,
    url: draft.url,
    status: draft.status,
    selectedListId: state.selectedListId || null,
    limit: state.limit ?? null,
    compiledRobotId: draft.compiledRobotId,
    lists: state.lists.map(list => publicList(list, list.id === state.selectedListId)),
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    lastError: draft.lastError,
  };
};

const findDraft = async (id: string, userId: number | string): Promise<RecorderDraft> => {
  const draft = await RecorderDraft.findOne({ where: { id, userId: Number(userId) } });
  if (!draft) throw new RecorderDraftError('draft_not_found', 'Recorder draft not found');
  return draft;
};

const makeFieldSamples = async (page: Page, listSelector: string, fields: DraftFieldState[]): Promise<void> => {
  const samples = await extractRows(page, listSelector, fields, 3);
  for (const field of fields) {
    field.samples = samples.map(row => row[field.label] || '').filter(Boolean).slice(0, 3);
  }
};

export async function createRecorderDraft(options: {
  url: string;
  userId: number | string;
  name?: string;
  description?: string;
}): Promise<RecorderDraft> {
  const url = normalizeRobotUrl(options.url);
  const name = options.name?.trim() || 'Semantic Recorder Draft';

  const state = await withValidationPage(String(options.userId), url, async (page, validator): Promise<RecorderDraftState> => {
    const groups = (await validator.analyzeElementGroups())
      .filter((group: DiscoveredGroup) => group.xpath && (group.count || 0) >= 2 && !group.isNavOrFooter)
      .slice(0, MAX_DISCOVERY_LISTS);
    const lists: DraftListState[] = [];

    for (const group of groups) {
      const detected = await validator.autoDetectListFields(group.xpath!);
      if (!detected.success || !detected.fields || !detected.listSelector) continue;

      const fields: DraftFieldState[] = Object.entries(detected.fields).map(([sourceLabel, value]: [string, any]) => ({
        id: uuid(),
        sourceLabel,
        label: sourceLabel,
        selector: value.selector,
        attribute: value.attribute || 'innerText',
        tag: value.tag || 'UNKNOWN',
        isShadow: Boolean(value.isShadow),
        samples: [],
        included: true,
      }));
      if (fields.length === 0) continue;

      await makeFieldSamples(page, detected.listSelector, fields);
      const pagination = await validator.autoDetectPagination(detected.listSelector);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 100000 }).catch(() => undefined);

      lists.push({
        id: uuid(),
        selector: detected.listSelector,
        tag: group.fingerprint?.tagName || 'unknown',
        count: group.count || 0,
        semanticParent: group.semanticParent || 'unknown',
        sampleTexts: (group.sampleTexts || []).slice(0, 3),
        attributes: normalizeAttributes(group.fingerprint?.attributes),
        fields,
        pagination: {
          type: pagination.success ? pagination.type || 'none' : 'none',
          selector: pagination.selector || '',
          // clickNext detection only confirms that a control exists; preview must
          // successfully advance a page before the draft reports it as tested.
          tested: pagination.success && pagination.type !== 'clickNext',
        },
      });
    }

    if (lists.length === 0) {
      throw new RecorderDraftError('validation_failed', 'No repeated list candidates with extractable fields were found');
    }
    return { lists, limit: null };
  });

  return RecorderDraft.create({
    userId: Number(options.userId),
    url,
    name,
    description: options.description?.trim() || null,
    status: 'discovered',
    state,
  });
}

export async function selectRecorderDraftList(id: string, userId: number | string, listCandidateId: string, limit?: number | null): Promise<RecorderDraft> {
  const draft = await findDraft(id, userId);
  const state = cloneState(draft.state);
  if (!state.lists.some(list => list.id === listCandidateId)) {
    throw new RecorderDraftError('candidate_not_found', 'List candidate not found');
  }
  if (limit !== undefined && limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 10000)) {
    throw new RecorderDraftError('invalid_request', 'limit must be an integer between 1 and 10000');
  }
  state.selectedListId = listCandidateId;
  if (limit !== undefined) state.limit = limit;
  await draft.update({ state, status: 'discovered', updatedAt: new Date() });
  return draft;
}

export async function updateRecorderDraftField(
  id: string,
  userId: number | string,
  operation: { fieldId: string; action: FieldOperation; name?: string },
): Promise<RecorderDraft> {
  const draft = await findDraft(id, userId);
  const state = cloneState(draft.state);
  const list = getListState(state);
  const field = list.fields.find(candidate => candidate.id === operation.fieldId);
  if (!field) throw new RecorderDraftError('field_not_found', 'Field candidate not found');

  if (operation.action === 'include') field.included = true;
  else if (operation.action === 'exclude') field.included = false;
  else {
    const label = operation.name?.trim();
    if (!label || label.length > 100) throw new RecorderDraftError('invalid_request', 'A field rename must be 1-100 characters');
    if (list.fields.some(candidate => candidate.id !== field.id && candidate.label.toLowerCase() === label.toLowerCase())) {
      throw new RecorderDraftError('invalid_request', `A field named "${label}" already exists`);
    }
    field.label = label;
  }

  if (includedFields(list).length === 0) {
    throw new RecorderDraftError('invalid_request', 'At least one field must remain included');
  }
  await draft.update({ state, status: 'discovered', updatedAt: new Date() });
  return draft;
}

export async function updateRecorderDraftOptions(
  id: string,
  userId: number | string,
  options: { limit?: number | null },
): Promise<RecorderDraft> {
  const draft = await findDraft(id, userId);
  if (options.limit !== undefined && options.limit !== null && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 10000)) {
    throw new RecorderDraftError('invalid_request', 'limit must be an integer between 1 and 10000');
  }
  const state = cloneState(draft.state);
  state.limit = options.limit ?? null;
  await draft.update({ state, updatedAt: new Date() });
  return draft;
}

const clickPagination = async (page: Page, list: DraftListState): Promise<boolean> => {
  if (!list.pagination.type || list.pagination.type === 'none') return false;
  if (list.pagination.type === 'scrollDown' || list.pagination.type === 'scrollUp') {
    await page.evaluate((direction) => window.scrollTo(0, direction === 'scrollUp' ? 0 : document.documentElement.scrollHeight), list.pagination.type);
    await page.waitForTimeout(750);
    return true;
  }
  if (!list.pagination.selector) return false;
  try {
    await page.locator(list.pagination.selector).first().click({ timeout: 3000 });
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(500);
    return true;
  } catch {
    return false;
  }
};

export async function previewRecorderDraft(
  id: string,
  userId: number | string,
  options: { followPagination?: boolean; limit?: number | null } = {},
): Promise<PreviewResult> {
  const draft = await findDraft(id, userId);
  const list = getListState(draft.state);
  const fields = includedFields(list);
  const limit = options.limit ?? draft.state.limit ?? DEFAULT_PREVIEW_LIMIT;

  return withValidationPage(String(userId), draft.url, async page => {
    const rows: Record<string, string>[] = [];
    const diagnostics: Array<Record<string, unknown>> = [];
    const seenStates = new Set<string>();
    let pagesVisited = 0;
    let truncated = false;
    const followPagination = options.followPagination ?? true;

    for (let pageIndex = 0; pageIndex < MAX_PREVIEW_PAGES && rows.length < limit; pageIndex++) {
      pagesVisited++;
      const pageRows = await extractRows(page, list.selector, fields, Math.min(limit - rows.length, 100));
      const signature = JSON.stringify({ url: page.url(), first: pageRows[0], count: pageRows.length });
      if (seenStates.has(signature)) {
        diagnostics.push({ code: 'pagination_loop', severity: 'warning', message: 'Pagination returned a page already seen' });
        break;
      }
      seenStates.add(signature);
      rows.push(...pageRows);
      if (!followPagination || rows.length >= limit || list.pagination.type === 'none') break;
      if (!(await clickPagination(page, list))) {
        diagnostics.push({ code: 'pagination_not_actionable', severity: 'error', message: 'Detected pagination could not be activated' });
        break;
      }
    }

    if (rows.length > limit) {
      rows.length = limit;
      truncated = true;
    }
    if (pagesVisited >= 2 && list.pagination.type !== 'none' && !list.pagination.tested) {
      const state = cloneState(draft.state);
      const selectedList = state.lists.find(candidate => candidate.id === state.selectedListId);
      if (selectedList) {
        selectedList.pagination.tested = true;
        await draft.update({ state, updatedAt: new Date() });
      }
    }
    if (pagesVisited >= MAX_PREVIEW_PAGES && rows.length < limit) {
      diagnostics.push({ code: 'pagination_page_cap', severity: 'warning', message: `Preview stopped after ${MAX_PREVIEW_PAGES} pages` });
    }
    return { rows, diagnostics, pagesVisited, truncated };
  });
}

export async function validateRecorderDraft(
  id: string,
  userId: number | string,
  scope: ValidationScope = 'current-page',
): Promise<DraftValidationResult> {
  const draft = await findDraft(id, userId);
  const list = getListState(draft.state);
  const fields = includedFields(list);
  if (fields.length === 0) throw new RecorderDraftError('invalid_request', 'At least one field must be included');

  return withValidationPage(String(userId), draft.url, async (page, validator) => {
    const diagnostics: Array<Record<string, unknown>> = [];
    const fieldMap = Object.fromEntries(fields.map(field => [field.label, {
      selector: field.selector,
      attribute: field.attribute,
    }]));
    const selectorResult = await validator.validateListFields({ itemSelector: list.selector, fields: fieldMap });
    if (!selectorResult.valid) {
      diagnostics.push({
        code: 'selector_invalid',
        severity: 'error',
        message: 'One or more server-owned selectors no longer match the page',
        failedFields: selectorResult.errors?.length || 0,
      });
    }

    const labelCoverage = await validator.validateFieldFillRates(fieldMap, list.selector);
    const coverage = Object.fromEntries(fields.map(field => [field.id, labelCoverage[field.label] ?? 0]));
    for (const field of fields) {
      const rate = coverage[field.id] ?? 0;
      if (rate < MIN_FIELD_COVERAGE) {
        diagnostics.push({ code: 'field_low_coverage', severity: rate === 0 ? 'error' : 'warning', fieldId: field.id, field: field.label, coverage: rate, message: `${field.label} is populated on only ${Math.round(rate * 100)}% of sampled rows` });
      }
    }

    if (!list.pagination.tested) {
      diagnostics.push({ code: 'pagination_not_tested', severity: 'warning', message: 'Pagination detection has not been successfully tested' });
    }

    let pagesVisited = 1;
    if (scope === 'multi-page') {
      const preview = await previewRecorderDraft(id, userId, { followPagination: true, limit: Math.min(draft.state.limit || DEFAULT_PREVIEW_LIMIT, 100) });
      pagesVisited = preview.pagesVisited;
      diagnostics.push(...preview.diagnostics);
      if (list.pagination.type !== 'none' && pagesVisited < 2) {
        diagnostics.push({ code: 'pagination_not_observed', severity: 'error', message: 'Multi-page validation did not observe a second page' });
      }
    }

    const hasErrors = diagnostics.some(diagnostic => diagnostic.severity === 'error');
    return { valid: !hasErrors, scope, diagnostics, coverage, pagesVisited };
  });
}

const compileWorkflow = (draft: RecorderDraft): any[] => {
  const list = getListState(draft.state);
  const fields = includedFields(list);
  if (fields.length === 0) throw new RecorderDraftError('invalid_request', 'At least one field must be included');
  return [{
    where: { url: draft.url },
    what: [
      { action: 'goto', args: [draft.url] },
      { action: 'waitForLoadState', args: ['networkidle'] },
      {
        action: 'scrapeList',
        actionId: `draft-${draft.id}-list-${list.id}`,
        name: list.fields.find(field => field.included)?.label || 'List',
        args: [{
          fields: Object.fromEntries(fields.map(field => [field.label, {
            selector: field.selector,
            attribute: field.attribute,
            tag: field.tag,
            isShadow: field.isShadow,
          }])),
          listSelector: list.selector,
          pagination: {
            type: list.pagination.type || 'none',
            selector: list.pagination.selector || '',
          },
          limit: draft.state.limit ?? DEFAULT_PREVIEW_LIMIT,
        }],
      },
      { action: 'waitForLoadState', args: ['networkidle'] },
    ],
  }];
};

export async function compileRecorderDraft(
  id: string,
  userId: number | string,
  options: { robotName?: string } = {},
): Promise<{ draft: RecorderDraft; robot: Robot; workflow: any[]; existing: boolean }> {
  const draft = await findDraft(id, userId);
  const validation = await validateRecorderDraft(id, userId, 'current-page');
  if (!validation.valid) throw new RecorderDraftError('validation_failed', 'Draft validation failed', validation.diagnostics);
  const workflow = compileWorkflow(draft);
  const robotName = options.robotName?.trim() || draft.name;
  let robot: Robot;
  let existing = false;

  if (draft.compiledRobotId) {
    const existingRobot = await Robot.findOne({ where: { userId: Number(userId), 'recording_meta.id': draft.compiledRobotId } });
    if (existingRobot) {
      await existingRobot.update({
        recording: { workflow },
        recording_meta: {
          ...existingRobot.recording_meta,
          name: robotName,
          pairs: workflow.length,
          updatedAt: new Date().toISOString(),
        },
      });
      robot = existingRobot;
      existing = true;
    } else {
      draft.compiledRobotId = null;
      await draft.save();
      const persisted = await persistNativeRobot({ url: draft.url, userId, robotName, description: `Recorder Draft ${draft.id}`, workflow });
      robot = persisted.robot;
      existing = persisted.existing;
    }
  } else {
    const persisted = await persistNativeRobot({ url: draft.url, userId, robotName, description: `Recorder Draft ${draft.id}`, workflow });
    robot = persisted.robot;
    existing = persisted.existing;
  }

  draft.compiledRobotId = robot.recording_meta.id;
  draft.status = 'compiled';
  draft.lastError = null;
  await draft.save();
  return { draft, robot, workflow, existing };
}
