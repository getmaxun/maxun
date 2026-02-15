/**
 * Client-Side Pagination Auto-Detection
 * Detects pagination type and selector for list extraction
 * Operates on passed document object (works in DOM mode / iframe)
 */

import type { ClientSelectorGenerator } from './clientSelectorGenerator';

export type PaginationDetectionResult = {
  type: 'scrollDown' | 'scrollUp' | 'clickNext' | 'clickLoadMore' | '';
  selector: string | null;
  confidence: 'high' | 'medium' | 'low';
  debug?: any;
};

const MAX_BUTTON_TEXT_LENGTH = 50;

const nextButtonTextPatterns = [
  /^\s*next\s*$/i,
  /\bnext\s+page\b/i,
  /\bpage\s+suivante\b/i,
  /\bsiguiente\b/i,
  /\bweiter\b/i,
  /\bnächste\b/i,
  /\bvolgende\b/i,
  /\bpróximo\b/i,
  /\bavanti\b/i,
];

const nextButtonArrowPatterns = [
  /^[>\s›→»⟩]+$/,
  /^>>$/,
];

const loadMorePatterns = [
  /^\s*load\s+more\s*$/i,
  /^\s*show\s+more\s*$/i,
  /^\s*view\s+more\s*$/i,
  /^\s*see\s+more\s*$/i,
  /^\s*more\s+results\s*$/i,
  /^\s*plus\s+de\s+résultats\s*$/i,
  /^\s*más\s+resultados\s*$/i,
  /^\s*weitere\s+ergebnisse\s*$/i,
  /^\s*meer\s+laden\s*$/i,
  /^\s*carica\s+altri\s*$/i,
  /^\s*carregar\s+mais\s*$/i,
];

const paginationContainerPatterns = /paginat|page-nav|pager|page-numbers|page-list/i;

class ClientPaginationDetector {
  autoDetectPagination(
    doc: Document,
    listSelector: string,
    selectorGenerator: ClientSelectorGenerator,
    options?: { disableScrollDetection?: boolean }
  ): PaginationDetectionResult {
    try {
      const listElements = this.evaluateSelector(listSelector, doc);

      if (listElements.length === 0) {
        return { type: '', selector: null, confidence: 'low', debug: 'No list elements found' };
      }

      const listContainer = this.getListContainer(listElements);

      const paginationWrapper = this.findPaginationContainer(listContainer, doc);

      if (paginationWrapper) {
        const scopedResult = this.detectFromPaginationWrapper(paginationWrapper, listContainer, doc, selectorGenerator);
        if (scopedResult) {
          return scopedResult;
        }
      }

      const nearbyResult = this.detectFromNearbyElements(listContainer, doc, selectorGenerator);
      if (nearbyResult) {
        return nearbyResult;
      }

      const infiniteScrollScore = options?.disableScrollDetection
        ? 0
        : this.detectInfiniteScrollIndicators(doc, listContainer);

      if (infiniteScrollScore >= 8) {
        const confidence = infiniteScrollScore >= 15 ? 'high' : infiniteScrollScore >= 12 ? 'medium' : 'low';
        return { type: 'scrollDown', selector: null, confidence };
      }

      const fallbackResult = this.detectFromFullDocument(listContainer, doc, selectorGenerator);
      if (fallbackResult) {
        return fallbackResult;
      }

      return {
        type: '',
        selector: null,
        confidence: 'low',
        debug: {
          listElementsCount: listElements.length,
          paginationWrapperFound: !!paginationWrapper,
          infiniteScrollScore,
        }
      };
    } catch (error: any) {
      console.error('Pagination detection error:', error);
      return { type: '', selector: null, confidence: 'low', debug: 'Exception: ' + error.message };
    }
  }

  /**
   * Derive the common parent container from the list elements.
   * If all elements share the same parent, use that parent.
   * Otherwise use the first element's parent as a best guess.
   */
  private getListContainer(listElements: HTMLElement[]): HTMLElement {
    if (listElements.length === 0) return listElements[0];

    const firstParent = listElements[0].parentElement;
    if (!firstParent) return listElements[0];

    const allShareParent = listElements.every(el => el.parentElement === firstParent);
    if (allShareParent) return firstParent;

    let ancestor: HTMLElement | null = firstParent;
    while (ancestor) {
      if (listElements.every(el => ancestor!.contains(el))) {
        return ancestor;
      }
      ancestor = ancestor.parentElement;
    }

    return firstParent;
  }

  /**
   * Find pagination container structurally near the list.
   * Walks up from the list container checking siblings at each level.
   */
  private findPaginationContainer(listContainer: HTMLElement, _doc: Document): HTMLElement | null {
    let scope = listContainer.parentElement;
    const MAX_LEVELS = 4;

    for (let level = 0; level < MAX_LEVELS && scope; level++) {
      const children = Array.from(scope.children) as HTMLElement[];

      for (const child of children) {
        if (child === listContainer || child.contains(listContainer) || listContainer.contains(child)) continue;
        if (!this.isVisible(child)) continue;

        const classAndLabel = `${child.className || ''} ${child.getAttribute('aria-label') || ''} ${child.getAttribute('role') || ''}`;
        if (paginationContainerPatterns.test(classAndLabel)) {
          return child;
        }

        if (child.tagName === 'NAV') {
          if (this.containsPaginationLinks(child)) {
            return child;
          }
        }

        if (this.containsNumericPageLinks(child)) {
          return child;
        }
      }

      scope = scope.parentElement;
    }

    return null;
  }

  /**
   * Check if a container has pagination-like links (numbered or next/prev)
   */
  private containsPaginationLinks(container: HTMLElement): boolean {
    const links = container.querySelectorAll('a, button, [role="button"]');
    let numericCount = 0;
    let hasNextPrev = false;

    for (const link of Array.from(links)) {
      const text = (link.textContent || '').trim();
      if (/^\d+$/.test(text)) numericCount++;
      if (this.matchesAnyPattern(text, nextButtonTextPatterns)) hasNextPrev = true;
      if (this.matchesAnyPattern(text, loadMorePatterns)) hasNextPrev = true;
    }

    return numericCount >= 2 || hasNextPrev;
  }

  /**
   * Check if a container has 2+ sequential numeric links (strong page-number signal)
   */
  private containsNumericPageLinks(container: HTMLElement): boolean {
    const links = container.querySelectorAll('a, button, [role="button"]');
    const numbers: number[] = [];

    for (const link of Array.from(links)) {
      const text = (link.textContent || '').trim();
      if (/^\d+$/.test(text)) {
        numbers.push(parseInt(text, 10));
      }
    }

    if (numbers.length < 2) return false;

    numbers.sort((a, b) => a - b);
    for (let i = 0; i < numbers.length - 1; i++) {
      if (numbers[i + 1] - numbers[i] === 1) return true;
    }
    return false;
  }

  /**
   * Detect pagination from a known pagination wrapper element.
   * Since we've already identified the wrapper structurally, we search only within it.
   */
  private detectFromPaginationWrapper(
    wrapper: HTMLElement,
    _listContainer: HTMLElement,
    doc: Document,
    selectorGenerator: ClientSelectorGenerator
  ): PaginationDetectionResult | null {
    const clickables = this.getClickableElementsIn(wrapper);

    let nextButton: HTMLElement | null = null;
    let nextScore = 0;
    let loadMoreButton: HTMLElement | null = null;
    let loadMoreScore = 0;

    for (const element of clickables) {
      if (!this.isVisible(element)) continue;
      if (element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true') continue;

      const text = (element.textContent || '').trim();
      const ariaLabel = element.getAttribute('aria-label') || '';
      const title = element.getAttribute('title') || '';
      if (text.length > MAX_BUTTON_TEXT_LENGTH) continue;

      const combinedText = `${text} ${ariaLabel} ${title}`;

      if (this.matchesAnyPattern(combinedText, loadMorePatterns)) {
        const score = 20;
        if (score > loadMoreScore) {
          loadMoreScore = score;
          loadMoreButton = element;
        }
      }

      let isNext = false;
      if (this.matchesAnyPattern(combinedText, nextButtonTextPatterns)) {
        isNext = true;
      } else if (text.length <= 3 && this.matchesAnyPattern(text, nextButtonArrowPatterns)) {
        isNext = true;
      }
      if (!isNext && !text.trim() && this.matchesAnyPattern(ariaLabel, nextButtonTextPatterns)) {
        isNext = true;
      }

      if (isNext) {
        const score = 20;
        if (score > nextScore) {
          nextScore = score;
          nextButton = element;
        }
      }
    }

    const hasNumberedPages = this.containsNumericPageLinks(wrapper);

    if (loadMoreButton) {
      const selector = this.generateSelectorsForElement(loadMoreButton, doc, selectorGenerator);
      return { type: 'clickLoadMore', selector, confidence: 'high' };
    }

    if (nextButton) {
      const selector = this.generateSelectorsForElement(nextButton, doc, selectorGenerator);
      const confidence = hasNumberedPages ? 'high' : 'high';
      return { type: 'clickNext', selector, confidence };
    }

    if (hasNumberedPages) {
      const lastLink = this.findLastPageLink(wrapper);
      if (lastLink) {
        const selector = this.generateSelectorsForElement(lastLink, doc, selectorGenerator);
        return { type: 'clickNext', selector, confidence: 'medium' };
      }
    }

    return null;
  }

  /**
   * Find the "next" link in a numbered pagination bar.
   * Look for the link after the current/active page number.
   */
  private findLastPageLink(container: HTMLElement): HTMLElement | null {
    const links = Array.from(container.querySelectorAll('a, button, [role="button"]')) as HTMLElement[];

    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      const isActive = link.getAttribute('aria-current') === 'page' ||
        link.classList.contains('active') ||
        link.classList.contains('current') ||
        link.classList.contains('selected') ||
        (link.closest('[aria-current="page"]') !== null);

      if (isActive && i + 1 < links.length) {
        return links[i + 1];
      }
    }

    return null;
  }

  /**
   * Detect pagination from clickable elements near the list container.
   * No aggressive nav filtering. Uses proximity + text matching.
   */
  private detectFromNearbyElements(
    listContainer: HTMLElement,
    doc: Document,
    selectorGenerator: ClientSelectorGenerator
  ): PaginationDetectionResult | null {
    const clickableElements = this.getClickableElements(doc);

    let nextButton: HTMLElement | null = null;
    let nextButtonScore = 0;
    let loadMoreButton: HTMLElement | null = null;
    let loadMoreScore = 0;

    for (const element of clickableElements) {
      if (!this.isVisible(element)) continue;
      if (listContainer.contains(element)) continue;
      if (element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true') continue;

      const text = (element.textContent || '').trim();
      const ariaLabel = element.getAttribute('aria-label') || '';
      const title = element.getAttribute('title') || '';
      if (text.length > MAX_BUTTON_TEXT_LENGTH) continue;

      const combinedText = `${text} ${ariaLabel} ${title}`;
      const nearList = this.isNearList(element, listContainer);

      if (!nearList) continue;

      if (this.matchesAnyPattern(combinedText, loadMorePatterns)) {
        let score = 10 + 5;
        if (element.tagName === 'BUTTON') score += 2;
        const className = element.className || '';
        if (paginationContainerPatterns.test(className)) score += 3;

        if (score > loadMoreScore) {
          loadMoreScore = score;
          loadMoreButton = element;
        }
      }

      let isNext = false;
      if (this.matchesAnyPattern(combinedText, nextButtonTextPatterns)) {
        isNext = true;
      } else if (text.length <= 3 && this.matchesAnyPattern(text, nextButtonArrowPatterns)) {
        isNext = true;
      }
      if (!isNext && !text.trim() && this.matchesAnyPattern(ariaLabel, nextButtonTextPatterns)) {
        isNext = true;
      }

      if (isNext) {
        let score = 10 + 5;
        if (element.tagName === 'BUTTON') score += 2;
        const className = element.className || '';
        if (paginationContainerPatterns.test(className)) score += 3;
        const paginationAncestor = element.closest('[class*="paginat"], [class*="pager"], [aria-label*="paginat" i]');
        if (paginationAncestor) score += 5;

        if (score > nextButtonScore) {
          nextButtonScore = score;
          nextButton = element;
        }
      }
    }

    if (loadMoreButton && loadMoreScore >= 15) {
      const selector = this.generateSelectorsForElement(loadMoreButton, doc, selectorGenerator);
      const confidence = loadMoreScore >= 18 ? 'high' : 'medium';
      return { type: 'clickLoadMore', selector, confidence };
    }

    if (nextButton && nextButtonScore >= 15) {
      const selector = this.generateSelectorsForElement(nextButton, doc, selectorGenerator);
      const confidence = nextButtonScore >= 18 ? 'high' : 'medium';
      return { type: 'clickNext', selector, confidence };
    }

    return null;
  }

  /**
   * Full-document fallback with relaxed filters.
   * No nav skipping. Scores elements across the whole page but requires both
   * text match AND proximity for a positive result.
   */
  private detectFromFullDocument(
    listContainer: HTMLElement,
    doc: Document,
    selectorGenerator: ClientSelectorGenerator
  ): PaginationDetectionResult | null {
    const clickableElements = this.getClickableElements(doc);

    let nextButton: HTMLElement | null = null;
    let nextButtonScore = 0;
    let loadMoreButton: HTMLElement | null = null;
    let loadMoreScore = 0;

    for (const element of clickableElements) {
      if (!this.isVisible(element)) continue;
      if (listContainer.contains(element)) continue;
      if (element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true') continue;

      const text = (element.textContent || '').trim();
      const ariaLabel = element.getAttribute('aria-label') || '';
      const title = element.getAttribute('title') || '';
      if (text.length > MAX_BUTTON_TEXT_LENGTH) continue;

      const combinedText = `${text} ${ariaLabel} ${title}`;
      const nearList = this.isNearList(element, listContainer);

      if (this.matchesAnyPattern(combinedText, loadMorePatterns)) {
        let score = 10;
        if (nearList) score += 5;
        if (element.tagName === 'BUTTON') score += 2;

        if (score > loadMoreScore) {
          loadMoreScore = score;
          loadMoreButton = element;
        }
      }

      let isNext = false;
      if (this.matchesAnyPattern(combinedText, nextButtonTextPatterns)) {
        isNext = true;
      } else if (text.length <= 3 && this.matchesAnyPattern(text, nextButtonArrowPatterns)) {
        isNext = true;
      }
      if (!isNext && !text.trim() && this.matchesAnyPattern(ariaLabel, nextButtonTextPatterns)) {
        isNext = true;
      }

      if (isNext) {
        let score = 10;
        if (nearList) score += 5;
        if (element.tagName === 'BUTTON') score += 2;

        if (score > nextButtonScore) {
          nextButtonScore = score;
          nextButton = element;
        }
      }
    }

    if (loadMoreButton && loadMoreScore >= 10) {
      const selector = this.generateSelectorsForElement(loadMoreButton, doc, selectorGenerator);
      const confidence = loadMoreScore >= 15 ? 'medium' : 'low';
      return { type: 'clickLoadMore', selector, confidence };
    }

    if (nextButton && nextButtonScore >= 10) {
      const selector = this.generateSelectorsForElement(nextButton, doc, selectorGenerator);
      const confidence = nextButtonScore >= 15 ? 'medium' : 'low';
      return { type: 'clickNext', selector, confidence };
    }

    return null;
  }

  // ---------- Utility methods ----------

  private evaluateSelector(selector: string, doc: Document): HTMLElement[] {
    try {
      const isXPath = selector.startsWith('//') || selector.startsWith('(//');

      if (isXPath) {
        const result = doc.evaluate(
          selector, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
        );
        const elements: HTMLElement[] = [];
        for (let i = 0; i < result.snapshotLength; i++) {
          const node = result.snapshotItem(i);
          if (node && node.nodeType === Node.ELEMENT_NODE) {
            elements.push(node as HTMLElement);
          }
        }
        return elements;
      } else {
        return Array.from(doc.querySelectorAll(selector));
      }
    } catch (err) {
      console.error('Selector evaluation failed:', selector, err);
      return [];
    }
  }

  private getClickableElements(doc: Document): HTMLElement[] {
    const clickables: HTMLElement[] = [];
    const selectors = ['button', 'a', '[role="button"]', '[onclick]', '.btn', '.button'];
    for (const sel of selectors) {
      clickables.push(...Array.from(doc.querySelectorAll(sel)) as HTMLElement[]);
    }
    return Array.from(new Set(clickables));
  }

  private getClickableElementsIn(container: HTMLElement): HTMLElement[] {
    const clickables: HTMLElement[] = [];
    const selectors = ['button', 'a', '[role="button"]', '[onclick]', '.btn', '.button'];
    for (const sel of selectors) {
      clickables.push(...Array.from(container.querySelectorAll(sel)) as HTMLElement[]);
    }
    if (container.tagName === 'BUTTON' || container.tagName === 'A' || container.getAttribute('role') === 'button') {
      clickables.push(container);
    }
    return Array.from(new Set(clickables));
  }

  private isVisible(element: HTMLElement): boolean {
    try {
      const style = window.getComputedStyle(element);
      return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0' &&
        element.offsetWidth > 0 &&
        element.offsetHeight > 0;
    } catch {
      return false;
    }
  }

  private matchesAnyPattern(text: string, patterns: RegExp[]): boolean {
    return patterns.some(pattern => pattern.test(text));
  }

  private isNearList(element: HTMLElement, listContainer: HTMLElement): boolean {
    try {
      const listRect = listContainer.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();

      if (elementRect.top >= listRect.bottom && elementRect.top <= listRect.bottom + 300) {
        return true;
      }

      if (elementRect.bottom <= listRect.top && elementRect.bottom >= listRect.top - 200) {
        return true;
      }

      const verticalOverlap = !(elementRect.bottom < listRect.top || elementRect.top > listRect.bottom);
      if (verticalOverlap) {
        const horizontalDistance = Math.min(
          Math.abs(elementRect.left - listRect.right),
          Math.abs(elementRect.right - listRect.left)
        );
        if (horizontalDistance < 150) {
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  private detectInfiniteScrollIndicators(doc: Document, _listContainer: HTMLElement): number {
    try {
      let score = 0;

      const initialHeight = doc.documentElement.scrollHeight;
      const viewportHeight = window.innerHeight;

      if (initialHeight <= viewportHeight) return 0;

      const sentinelPatterns = [
        '[data-infinite]',
        '[data-scroll-trigger]',
        '#infinite-scroll-trigger',
        '[class*="infinite-scroll"]',
        '[id*="infinite-scroll"]',
      ];

      for (const sel of sentinelPatterns) {
        if (doc.querySelector(sel)) { score += 6; break; }
      }

      const infiniteScrollLibraries = [
        '.infinite-scroll',
        '[data-infinite-scroll]',
        '[class*="infinite-scroll"]',
      ];

      for (const sel of infiniteScrollLibraries) {
        if (doc.querySelector(sel)) { score += 6; break; }
      }

      const scrollToTopPatterns = [
        '[aria-label*="scroll to top" i]',
        '[title*="back to top" i]',
        '.back-to-top',
        '#back-to-top',
        '[class*="scrolltop"]',
        '[class*="backtotop"]',
      ];

      for (const sel of scrollToTopPatterns) {
        try {
          const element = doc.querySelector(sel);
          if (element && this.isVisible(element as HTMLElement)) { score += 2; break; }
        } catch { continue; }
      }

      if (initialHeight > viewportHeight * 5) score += 2;

      return score;
    } catch {
      return 0;
    }
  }

  private generateSelectorsForElement(
    element: HTMLElement,
    doc: Document,
    selectorGenerator: ClientSelectorGenerator
  ): string | null {
    try {
      const primary = selectorGenerator.generateSelectorsFromElement(element, doc);

      if (!primary) {
        console.warn('Could not generate selectors for element');
        return null;
      }

      const selectorChain = [
        primary && 'iframeSelector' in primary && primary.iframeSelector?.full
          ? primary.iframeSelector.full : null,
        primary && 'shadowSelector' in primary && primary.shadowSelector?.full
          ? primary.shadowSelector.full : null,
        primary && 'testIdSelector' in primary ? primary.testIdSelector : null,
        primary && 'id' in primary ? primary.id : null,
        primary && 'hrefSelector' in primary ? primary.hrefSelector : null,
        primary && 'relSelector' in primary ? primary.relSelector : null,
        primary && 'accessibilitySelector' in primary ? primary.accessibilitySelector : null,
        primary && 'attrSelector' in primary ? primary.attrSelector : null,
        primary && 'generalSelector' in primary ? primary.generalSelector : null,
      ]
        .filter(s => s !== null && s !== undefined && s !== '')
        .join(',');

      return selectorChain || null;
    } catch (error) {
      console.error('Error generating selectors:', error);
      return null;
    }
  }
}

export const clientPaginationDetector = new ClientPaginationDetector();
