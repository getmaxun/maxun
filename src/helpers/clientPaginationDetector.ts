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

class ClientPaginationDetector {
  /**
   * Auto-detect pagination on a page
   * @param doc - The document object to analyze (can be iframe document)
   * @param listSelector - The selector for the list container
   * @param options - Optional detection options
   * @returns Pagination detection result
   */
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

      const listContainer = listElements[0];

      const MAX_BUTTON_TEXT_LENGTH = 50;

      const nextButtonTextPatterns = [
        /^\s*next\s*$/i,
        /\bnext\s+page\b/i,
        /\bpage\s+suivante\b/i,
        /\bsiguiente\b/i,
        /\bweiter\b/i,
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
      ];

      const prevButtonTextPatterns = [
        /^\s*prev(ious)?\s*$/i,
        /\bprevious\s+page\b/i,
        /\bpage\s+précédente\b/i,
      ];

      const prevButtonArrowPatterns = [
        /^[<\s‹←«]+$/,
        /^<<$/,
      ];

      const clickableElements = this.getClickableElements(doc);

      let nextButton: HTMLElement | null = null;
      let nextButtonScore = 0;
      const nextButtonCandidates: any[] = [];

      for (const element of clickableElements) {
        if (!this.isVisible(element)) continue;
        if (this.shouldSkipElement(element, listContainer)) continue;

        const text = (element.textContent || '').trim();
        const ariaLabel = element.getAttribute('aria-label') || '';
        const title = element.getAttribute('title') || '';

        if (text.length > MAX_BUTTON_TEXT_LENGTH) continue;

        let score = 0;
        const reasons: string[] = [];

        const combinedText = `${text} ${ariaLabel} ${title}`;
        if (this.matchesAnyPattern(combinedText, nextButtonTextPatterns)) {
          score += 10;
          reasons.push('text match (+10)');
        } else if (text.length <= 3 && this.matchesAnyPattern(text, nextButtonArrowPatterns)) {
          score += 8;
          reasons.push('arrow match (+8)');
        }

        if (score === 0) continue;

        const nearList = this.isNearList(element, listContainer);
        if (nearList) {
          score += 5;
          reasons.push('near list (+5)');
        }

        if (element.tagName === 'BUTTON') {
          score += 2;
          reasons.push('button tag (+2)');
        }

        const className = element.className || '';
        if (/\bpaginat(ion|e)\b/i.test(className)) {
          score += 3;
          reasons.push('pagination class (+3)');
        }

        nextButtonCandidates.push({
          element: element,
          score: score,
          text: text.substring(0, 50),
          ariaLabel: ariaLabel,
          tag: element.tagName,
          className: className,
          reasons: reasons
        });

        if (score > nextButtonScore) {
          nextButtonScore = score;
          nextButton = element;
        }
      }

      let loadMoreButton: HTMLElement | null = null;
      let loadMoreScore = 0;

      for (const element of clickableElements) {
        if (!this.isVisible(element)) continue;
        if (this.shouldSkipElement(element, listContainer)) continue;

        const text = (element.textContent || '').trim();
        const ariaLabel = element.getAttribute('aria-label') || '';
        const title = element.getAttribute('title') || '';

        if (text.length > MAX_BUTTON_TEXT_LENGTH) continue;

        let score = 0;

        const combinedText = `${text} ${ariaLabel} ${title}`;
        if (this.matchesAnyPattern(combinedText, loadMorePatterns)) {
          score += 10;
        }

        if (score === 0) continue;

        if (this.isNearList(element, listContainer)) {
          score += 5;
        }

        if (element.tagName === 'BUTTON') {
          score += 2;
        }

        if (score > loadMoreScore) {
          loadMoreScore = score;
          loadMoreButton = element;
        }
      }

      const infiniteScrollScore = options?.disableScrollDetection
        ? 0
        : this.detectInfiniteScrollIndicators(doc, listElements, listContainer);

      const hasStrongInfiniteScrollSignals = infiniteScrollScore >= 12;
      const hasMediumInfiniteScrollSignals = infiniteScrollScore >= 8 && infiniteScrollScore < 12;

      if (hasStrongInfiniteScrollSignals) {
        const confidence = infiniteScrollScore >= 15 ? 'high' : 'medium';
        return {
          type: 'scrollDown',
          selector: null,
          confidence: confidence
        };
      }

      if (loadMoreButton && loadMoreScore >= 18) {
        const selector = this.generateSelectorsForElement(loadMoreButton, doc, selectorGenerator);
        return {
          type: 'clickLoadMore',
          selector: selector,
          confidence: 'high'
        };
      }

      if (nextButton && nextButtonScore >= 18 && !hasMediumInfiniteScrollSignals) {
        const selector = this.generateSelectorsForElement(nextButton, doc, selectorGenerator);
        return {
          type: 'clickNext',
          selector: selector,
          confidence: 'high'
        };
      }

      if (hasMediumInfiniteScrollSignals) {
        return {
          type: 'scrollDown',
          selector: null,
          confidence: 'low'
        };
      }

      if (loadMoreButton && loadMoreScore >= 13) {
        const selector = this.generateSelectorsForElement(loadMoreButton, doc, selectorGenerator);
        const confidence = loadMoreScore >= 15 ? 'medium' : 'low';
        return {
          type: 'clickLoadMore',
          selector: selector,
          confidence: confidence
        };
      }

      if (nextButton && nextButtonScore >= 13) {
        const selector = this.generateSelectorsForElement(nextButton, doc, selectorGenerator);
        const confidence = nextButtonScore >= 15 ? 'medium' : 'low';
        return {
          type: 'clickNext',
          selector: selector,
          confidence: confidence
        };
      }

      return {
        type: '',
        selector: null,
        confidence: 'low',
        debug: {
          clickableElementsCount: clickableElements.length,
          nextCandidatesCount: nextButtonCandidates.length,
          topNextCandidates: nextButtonCandidates.slice(0, 3).map(c => ({
            score: c.score,
            text: c.text,
            tag: c.tag,
            reasons: c.reasons
          })),
          finalScores: {
            loadMore: loadMoreScore,
            next: nextButtonScore,
            infiniteScroll: infiniteScrollScore
          }
        }
      };
    } catch (error: any) {
      console.error('Error:', error);
      return {
        type: '',
        selector: null,
        confidence: 'low',
        debug: 'Exception: ' + error.message
      };
    }
  }

  /**
   * Evaluate selector (supports both CSS and XPath)
   */
  private evaluateSelector(selector: string, doc: Document): HTMLElement[] {
    try {
      const isXPath = selector.startsWith('//') || selector.startsWith('(//');

      if (isXPath) {
        const result = doc.evaluate(
          selector,
          doc,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null
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

  /**
   * Get all clickable elements in document
   */
  private getClickableElements(doc: Document): HTMLElement[] {
    const clickables: HTMLElement[] = [];
    const selectors = ['button', 'a', '[role="button"]', '[onclick]', '.btn', '.button'];

    for (const selector of selectors) {
      const elements = doc.querySelectorAll(selector);
      clickables.push(...Array.from(elements) as HTMLElement[]);
    }

    return Array.from(new Set(clickables));
  }

  /**
   * Check if element is visible
   */
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

  /**
   * Check if text matches any pattern
   */
  private matchesAnyPattern(text: string, patterns: RegExp[]): boolean {
    return patterns.some(pattern => pattern.test(text));
  }

  /**
   * Check if element should be skipped (inside list, disabled, etc.)
   */
  private shouldSkipElement(element: HTMLElement, listContainer: HTMLElement): boolean {
    if (listContainer.contains(element)) {
      return true;
    }

    if (element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true') {
      return true;
    }

    const nav = element.closest('nav');
    if (nav && !(/\bpaginat(ion|e)\b/i.test(nav.className || '') || /pagination/i.test(nav.getAttribute('aria-label') || ''))) {
      return true;
    }

    return false;
  }

  /**
   * Check if element is near the list container
   */
  private isNearList(element: HTMLElement, listContainer: HTMLElement): boolean {
    try {
      const listRect = listContainer.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();

      if (elementRect.top >= listRect.bottom && elementRect.top <= listRect.bottom + 200) {
        return true;
      }

      if (elementRect.bottom <= listRect.top && elementRect.bottom >= listRect.top - 150) {
        return true;
      }

      const verticalOverlap = !(elementRect.bottom < listRect.top || elementRect.top > listRect.bottom);
      if (verticalOverlap) {
        const horizontalDistance = Math.min(
          Math.abs(elementRect.left - listRect.right),
          Math.abs(elementRect.right - listRect.left)
        );
        if (horizontalDistance < 100) {
          return true;
        }
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Detect infinite scroll indicators
   */
  private detectInfiniteScrollIndicators(doc: Document, listElements: HTMLElement[], listContainer: HTMLElement): number {
    try {
      let score = 0;

      const initialHeight = doc.documentElement.scrollHeight;
      const viewportHeight = window.innerHeight;

      if (initialHeight <= viewportHeight) {
        return 0;
      }

      const sentinelPatterns = [
        '[data-infinite]',
        '[data-scroll-trigger]',
        '#infinite-scroll-trigger',
        '[class*="infinite-scroll"]',
        '[id*="infinite-scroll"]',
      ];

      for (const selector of sentinelPatterns) {
        if (doc.querySelector(selector)) {
          score += 6;
          break;
        }
      }

      const infiniteScrollLibraries = [
        '.infinite-scroll',
        '[data-infinite-scroll]',
        '[class*="infinite-scroll"]',
      ];

      for (const selector of infiniteScrollLibraries) {
        if (doc.querySelector(selector)) {
          score += 6;
          break;
        }
      }

      const scrollToTopPatterns = [
        '[aria-label*="scroll to top" i]',
        '[title*="back to top" i]',
        '.back-to-top',
        '#back-to-top',
        '[class*="scrolltop"]',
        '[class*="backtotop"]',
      ];

      for (const selector of scrollToTopPatterns) {
        try {
          const element = doc.querySelector(selector);
          if (element && this.isVisible(element as HTMLElement)) {
            score += 2;
            break;
          }
        } catch {
          continue;
        }
      }

      if (initialHeight > viewportHeight * 5) {
        score += 2;
      }

      return score;
    } catch (error) {
      console.error('Infinite scroll detection error:', error);
      return 0;
    }
  }
  /**
   * Generate selectors for element using ClientSelectorGenerator approach
   * Returns the primary selector chain
   */
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
          ? primary.iframeSelector.full
          : null,
        primary && 'shadowSelector' in primary && primary.shadowSelector?.full
          ? primary.shadowSelector.full
          : null,
        primary && 'testIdSelector' in primary ? primary.testIdSelector : null,
        primary && 'id' in primary ? primary.id : null,
        primary && 'hrefSelector' in primary ? primary.hrefSelector : null,
        primary && 'relSelector' in primary ? primary.relSelector : null,
        primary && 'accessibilitySelector' in primary ? primary.accessibilitySelector : null,
        primary && 'attrSelector' in primary ? primary.attrSelector : null,
        primary && 'generalSelector' in primary ? primary.generalSelector : null,
      ]
        .filter(selector => selector !== null && selector !== undefined && selector !== '')
        .join(',');

      return selectorChain || null;
    } catch (error) {
      console.error('Error generating selectors:', error);
      return null;
    }
  }
}

export const clientPaginationDetector = new ClientPaginationDetector();
