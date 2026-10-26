/**
 * Reveals content on the extraction page before it is read: dismisses
 * overlays that cover it, scrolls through it so lazy-loaded items render,
 * and opens collapsed sections. These are fixed, deterministic steps; the
 * model never decides what to click.
 *
 * Every click goes through the PageScopeGuard: a control that tries to load
 * another page is stopped, and the page is checked after each click.
 * Links to other documents are never clicked.
 */
import { Page } from 'playwright-core';
import logger from '../../logger';
import { PageScopeGuard } from './pageScope';

export interface RevealReport {
  /** Overlays closed (cookie banners, modals). */
  dismissed: number;
  /** Collapsed sections opened (<details>, aria-expanded controls). */
  expanded: number;
  /** Scroll steps taken. */
  scrollSteps: number;
  /** True when scrolling made the page longer, i.e. content loads as you scroll. */
  grewOnScroll: boolean;
  /** Clicks undone because they changed the page's URL. */
  revertedClicks: number;
}

export interface RevealOptions {
  maxScrollSteps?: number;
  maxClicks?: number;
  settleMs?: number;
}

const MARK = 'data-mx-reveal';

/**
 * Marks clickable controls of one kind and returns their marks. Runs in the
 * page; only buttons and button-like elements qualify, never links that load
 * another document.
 */
function markControls({ kind, attr }: { kind: 'overlay' | 'expander'; attr: string }): string[] {
  const collapse = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();
  const here = window.location.href.split('#')[0];

  const leavesPage = (el: Element): boolean => {
    const link = el.closest('a[href]') as HTMLAnchorElement | null;
    if (!link) return false;
    const raw = link.getAttribute('href') || '';
    if (raw.startsWith('#') || /^javascript:/i.test(raw)) return false;
    return link.href.split('#')[0] !== here;
  };

  const visible = (el: Element): boolean => {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const isButtonLike = (el: Element): boolean =>
    el.tagName === 'BUTTON' || el.tagName === 'SUMMARY' || el.getAttribute('role') === 'button' ||
    (el.tagName === 'INPUT' && /^(button)$/i.test((el as HTMLInputElement).type));

  let candidates: Element[] = [];
  if (kind === 'overlay') {
    const DISMISS = /^(accept|accept all|accept all cookies|accept cookies|allow all|allow cookies|agree|i agree|i accept|got it|ok|okay|close|dismiss|no thanks|no, thanks|not now|maybe later|reject all|decline|×|✕|✖|x)$/i;
    const OVERLAY_HINT = /(cookie|consent|gdpr|modal|popup|pop-up|overlay|newsletter|dialog|banner)/i;
    const inOverlay = (el: Element): boolean => {
      for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
        if (n.getAttribute('role') === 'dialog' || n.getAttribute('role') === 'alertdialog' || n.getAttribute('aria-modal') === 'true') return true;
        if (OVERLAY_HINT.test(`${n.id} ${typeof n.className === 'string' ? n.className : ''}`)) return true;
        const position = window.getComputedStyle(n).position;
        if (position === 'fixed' || position === 'sticky') return true;
      }
      return false;
    };
    candidates = Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], a[href^="#"], a:not([href])'))
      .filter((el) => {
        const label = collapse((el as HTMLElement).innerText || el.getAttribute('aria-label') || (el as HTMLInputElement).value);
        return DISMISS.test(label) && inOverlay(el);
      });
  } else {
    const inChrome = (el: Element) => !!el.closest('nav, header, footer, [role="navigation"], [role="banner"], [role="menubar"], [role="menu"]');
    candidates = Array.from(document.querySelectorAll('[aria-expanded="false"]'))
      .filter((el) => isButtonLike(el) && !inChrome(el));
  }

  const marks: string[] = [];
  candidates.forEach((el, i) => {
    if (!visible(el) || leavesPage(el)) return;
    const id = `${kind}-${i}`;
    el.setAttribute(attr, id);
    marks.push(id);
  });
  return marks;
}

async function clickMarked(page: Page, guard: PageScopeGuard, marks: string[], settleMs: number): Promise<{ clicked: number; reverted: number }> {
  let clicked = 0;
  let reverted = 0;
  for (const id of marks) {
    const locator = page.locator(`[${MARK}="${id}"]`).first();
    if ((await locator.count().catch(() => 0)) === 0) continue;
    try {
      await locator.click({ timeout: 2000, noWaitAfter: true });
    } catch {
      continue;
    }
    await page.waitForTimeout(settleMs);
    if (await guard.ensureInScope()) {
      clicked++;
    } else {
      // The page was reloaded; the remaining marks are gone with it.
      reverted++;
      break;
    }
  }
  return { clicked, reverted };
}

async function scrollThrough(page: Page, maxSteps: number, settleMs: number): Promise<{ steps: number; grew: boolean }> {
  const startHeight: number = await page.evaluate(() => document.documentElement.scrollHeight);
  let steps = 0;
  let stableAtBottom = 0;
  while (steps < maxSteps && stableAtBottom < 2) {
    const before: number = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    steps++;
    await page.waitForTimeout(settleMs);
    const { height, atBottom } = await page.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      atBottom: window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2,
    }));
    stableAtBottom = atBottom && height === before ? stableAtBottom + 1 : 0;
  }
  const endHeight: number = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.evaluate(() => window.scrollTo(0, 0));
  return { steps, grew: endHeight > startHeight + 50 };
}

export async function revealPageContent(page: Page, guard: PageScopeGuard, options: RevealOptions = {}): Promise<RevealReport> {
  const maxScrollSteps = options.maxScrollSteps ?? 12;
  const maxClicks = options.maxClicks ?? 25;
  const settleMs = options.settleMs ?? 300;
  const report: RevealReport = { dismissed: 0, expanded: 0, scrollSteps: 0, grewOnScroll: false, revertedClicks: 0 };

  try {
    const overlays = (await page.evaluate(markControls, { kind: 'overlay' as const, attr: MARK }).catch(() => [] as string[])).slice(0, 5);
    const dismissed = await clickMarked(page, guard, overlays, settleMs);
    report.dismissed = dismissed.clicked;
    report.revertedClicks += dismissed.reverted;

    const scrolled = await scrollThrough(page, maxScrollSteps, settleMs);
    report.scrollSteps = scrolled.steps;
    report.grewOnScroll = scrolled.grew;

    // <details> opens without a click, so it can never trigger navigation.
    report.expanded += await page.evaluate(() => {
      const closed = Array.from(document.querySelectorAll('details:not([open])'));
      closed.forEach((d) => d.setAttribute('open', ''));
      return closed.length;
    });

    const expanders = (await page.evaluate(markControls, { kind: 'expander' as const, attr: MARK }).catch(() => [] as string[])).slice(0, maxClicks);
    const expanded = await clickMarked(page, guard, expanders, Math.min(settleMs, 200));
    report.expanded += expanded.clicked;
    report.revertedClicks += expanded.reverted;
  } finally {
    await page.evaluate((attr) => {
      document.querySelectorAll(`[${attr}]`).forEach((el) => el.removeAttribute(attr));
    }, MARK).catch(() => undefined);
  }

  logger.info(
    `[AiExtract] Revealed content: ${report.dismissed} overlay(s) closed, ${report.expanded} section(s) expanded, ` +
    `${report.scrollSteps} scroll step(s)${report.grewOnScroll ? ' (page grew)' : ''}` +
    `${report.revertedClicks ? `, ${report.revertedClicks} click(s) undone for leaving the page` : ''}`
  );
  return report;
}
