/**
 * Keeps AI Extract on the page the user entered.
 *
 * AI Extract reads one page. Nothing in the pipeline asks the model where to
 * go, and this guard makes sure no interaction can take the browser
 * elsewhere either:
 *
 *   - The start URL is loaded once. A redirect is followed only when it stays
 *     on the same site (http → https, www, a trailing slash, a locale path);
 *     a redirect to another site is refused with an explanation instead of
 *     extracting from a page the user did not ask for.
 *   - Once armed, every top-level navigation request to a different document
 *     is aborted before it leaves the browser (link clicks, form posts,
 *     location changes, meta refreshes). Hash changes and iframes are allowed.
 *   - window.open is disabled, and any other new tab the page opens is closed.
 *   - Client-side route changes (history.pushState) and server redirects
 *     cannot be intercepted as requests; `ensureInScope()` catches them after
 *     each interaction and reloads the allowed page.
 *
 * `<link rel="canonical">` is never followed: the page the user entered is
 * the page that is read and saved in the robot.
 */
import { Page, Request, Route } from 'playwright-core';
import logger from '../../logger';

export class OutOfScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutOfScopeError';
  }
}

/** Same document: same origin, path and query. The fragment is ignored. */
export function documentKey(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    return `${url.protocol}//${url.host}${path}${url.search}`.toLowerCase();
  } catch {
    return null;
  }
}

/** Hostname without a leading "www.", for telling a same-site redirect from a cross-site one. */
function siteOf(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function isSameSite(a: string, b: string): boolean {
  const siteA = siteOf(a);
  return !!siteA && siteA === siteOf(b);
}

export interface PageScopeOptions {
  navigationTimeoutMs?: number;
}

export class PageScopeGuard {
  readonly startUrl: string;
  /** The URL the start URL resolved to after redirects. */
  resolvedUrl: string;
  /** Navigations that were stopped, for logs and the robot's metadata. */
  readonly blocked: string[] = [];

  private readonly page: Page;
  private readonly allowed = new Set<string>();
  private readonly timeoutMs: number;
  private armed = false;
  private routeHandler: ((route: Route, request: Request) => Promise<void>) | null = null;
  private popupHandler: ((popup: Page) => void) | null = null;

  constructor(page: Page, startUrl: string, options: PageScopeOptions = {}) {
    this.page = page;
    this.startUrl = startUrl;
    this.resolvedUrl = startUrl;
    this.timeoutMs = options.navigationTimeoutMs ?? 100_000;
    this.allow(startUrl);
  }

  private allow(url: string): void {
    const key = documentKey(url);
    if (key) this.allowed.add(key);
  }

  isAllowed(url: string): boolean {
    if (url === 'about:blank') return false;
    const key = documentKey(url);
    return !!key && this.allowed.has(key);
  }

  /**
   * Loads the start URL and arms the guard. Throws OutOfScopeError when the
   * page redirects to another site.
   */
  async open(): Promise<string> {
    try {
      await this.page.goto(this.startUrl, { waitUntil: 'networkidle', timeout: this.timeoutMs });
    } catch (error: any) {
      // Pages that keep connections open never reach network idle.
      if (this.page.url() === 'about:blank' || !/timeout/i.test(error?.message || '')) {
        await this.page.goto(this.startUrl, { waitUntil: 'domcontentloaded', timeout: this.timeoutMs });
      }
    }

    const landed = this.page.url();
    if (!this.isAllowed(landed)) {
      if (!isSameSite(this.startUrl, landed)) {
        throw new OutOfScopeError(
          `${this.startUrl} redirected to ${landed}, which is on a different site. ` +
          'AI Extract only reads the page you entered; if that is the page you want, enter its URL directly.'
        );
      }
      logger.info(`[AiExtract] ${this.startUrl} redirected to ${landed} on the same site; extracting from that page`);
      this.allow(landed);
    }
    this.resolvedUrl = landed;
    await this.arm();
    return landed;
  }

  /** Starts blocking navigation away from the allowed page. */
  async arm(): Promise<void> {
    if (this.armed) return;
    this.armed = true;

    this.routeHandler = async (route, request) => {
      if (
        this.armed &&
        request.isNavigationRequest() &&
        request.frame() === this.page.mainFrame() &&
        !this.isAllowed(request.url())
      ) {
        this.recordBlocked(request.url());
        await route.abort('aborted').catch(() => undefined);
        return;
      }
      // Let other handlers (e.g. the ad blocker) see the request.
      await route.fallback().catch(() => undefined);
    };
    await this.page.route('**/*', this.routeHandler);

    // window.open would load the other page in a new tab before a popup
    // handler could close it, so the page cannot open windows at all.
    const disableWindowOpen = () => {
      window.open = () => null;
    };
    await this.page.addInitScript(disableWindowOpen);
    await this.page.evaluate(disableWindowOpen).catch(() => undefined);

    // Backstop for anything else that opens a tab (e.g. a target="_blank" link).
    this.popupHandler = (popup: Page) => {
      this.recordBlocked(popup.url() || 'popup');
      popup.close().catch(() => undefined);
    };
    this.page.on('popup', this.popupHandler);
  }

  private recordBlocked(url: string): void {
    if (this.blocked.length < 50) this.blocked.push(url);
    logger.info(`[AiExtract] Blocked navigation away from the extraction page: ${url}`);
  }

  /**
   * True when the page is still the allowed document. Otherwise (a client-side
   * route change or a redirect the request filter could not see) reloads the
   * allowed page and returns false so the caller can skip what caused it.
   */
  async ensureInScope(): Promise<boolean> {
    const current = this.page.url();
    if (this.isAllowed(current)) return true;
    this.recordBlocked(current);
    logger.warn(`[AiExtract] Page left the extraction scope (${current}); returning to ${this.resolvedUrl}`);
    await this.page.goto(this.resolvedUrl, { waitUntil: 'domcontentloaded', timeout: this.timeoutMs });
    await this.page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    if (!this.isAllowed(this.page.url())) {
      throw new OutOfScopeError(`Could not return to ${this.resolvedUrl} after the page navigated to ${current}`);
    }
    return false;
  }

  async dispose(): Promise<void> {
    this.armed = false;
    if (this.routeHandler) {
      await this.page.unroute('**/*', this.routeHandler).catch(() => undefined);
      this.routeHandler = null;
    }
    if (this.popupHandler) {
      this.page.off('popup', this.popupHandler);
      this.popupHandler = null;
    }
  }
}
