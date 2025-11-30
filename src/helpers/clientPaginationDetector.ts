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

      const nextButtonPatterns = [
        /next/i,
        /\bnext\s+page\b/i,
        /page\s+suivante/i,
        /siguiente/i,
        /weiter/i,
        />>|›|→|»|⟩/,
        /\bforward\b/i,
        /\bnewer\b/i,
        /\bolder\b/i
      ];

      const loadMorePatterns = [
        /load\s+more/i,
        /show\s+more/i,
        /view\s+more/i,
        /see\s+more/i,
        /more\s+results/i,
        /plus\s+de\s+résultats/i,
        /más\s+resultados/i,
        /weitere\s+ergebnisse/i
      ];

      const prevButtonPatterns = [
        /prev/i,
        /previous/i,
        /<<|‹|←|«/,
        /\bback\b/i
      ];

      const clickableElements = this.getClickableElements(doc);

      let nextButton: HTMLElement | null = null;
      let nextButtonScore = 0;
      const nextButtonCandidates: any[] = [];

      for (const element of clickableElements) {
        if (!this.isVisible(element)) continue;

        const text = (element.textContent || '').trim();
        const ariaLabel = element.getAttribute('aria-label') || '';
        const title = element.getAttribute('title') || '';
        const combinedText = `${text} ${ariaLabel} ${title}`;

        let score = 0;
        const reasons: string[] = [];

        if (this.matchesAnyPattern(combinedText, nextButtonPatterns)) {
          score += 10;
          reasons.push('text match (+10)');
        }

        if (this.isNearList(element, listContainer)) {
          score += 5;
          reasons.push('near list (+5)');
        }

        if (element.tagName === 'BUTTON') {
          score += 2;
          reasons.push('button tag (+2)');
        }

        const className = element.className || '';
        if (/pagination|next|forward/i.test(className)) {
          score += 3;
          reasons.push('pagination class (+3)');
        }

        if (score > 0) {
          nextButtonCandidates.push({
            element: element,
            score: score,
            text: text.substring(0, 50),
            ariaLabel: ariaLabel,
            tag: element.tagName,
            className: className,
            reasons: reasons
          });
        }

        if (score > nextButtonScore) {
          nextButtonScore = score;
          nextButton = element;
        }
      }

      let loadMoreButton: HTMLElement | null = null;
      let loadMoreScore = 0;

      for (const element of clickableElements) {
        if (!this.isVisible(element)) continue;

        const text = (element.textContent || '').trim();
        const ariaLabel = element.getAttribute('aria-label') || '';
        const title = element.getAttribute('title') || '';
        const combinedText = `${text} ${ariaLabel} ${title}`;

        let score = 0;

        if (this.matchesAnyPattern(combinedText, loadMorePatterns)) {
          score += 10;
        }

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

      let prevButton: HTMLElement | null = null;
      let prevButtonScore = 0;

      for (const element of clickableElements) {
        if (!this.isVisible(element)) continue;

        const text = (element.textContent || '').trim();
        const ariaLabel = element.getAttribute('aria-label') || '';
        const title = element.getAttribute('title') || '';
        const combinedText = `${text} ${ariaLabel} ${title}`;

        let score = 0;

        if (this.matchesAnyPattern(combinedText, prevButtonPatterns)) {
          score += 10;
        }

        if (this.isNearList(element, listContainer)) {
          score += 5;
        }

        if (score > prevButtonScore) {
          prevButtonScore = score;
          prevButton = element;
        }
      }

      const infiniteScrollScore = options?.disableScrollDetection
        ? 0
        : this.detectInfiniteScrollIndicators(doc, listElements, listContainer);

      const hasStrongInfiniteScrollSignals = infiniteScrollScore >= 8;
      const hasMediumInfiniteScrollSignals = infiniteScrollScore >= 5 && infiniteScrollScore < 8;

      if (hasStrongInfiniteScrollSignals) {
        const confidence = infiniteScrollScore >= 12 ? 'high' : infiniteScrollScore >= 10 ? 'medium' : 'low';
        return {
          type: 'scrollDown',
          selector: null,
          confidence: confidence
        };
      }

      if (loadMoreButton && loadMoreScore >= 15) {
        const selector = this.generateSelectorsForElement(loadMoreButton, doc, selectorGenerator);
        return {
          type: 'clickLoadMore',
          selector: selector,
          confidence: 'high'
        };
      }

      if (nextButton && nextButtonScore >= 15 && !hasMediumInfiniteScrollSignals) {
        const selector = this.generateSelectorsForElement(nextButton, doc, selectorGenerator);
        return {
          type: 'clickNext',
          selector: selector,
          confidence: 'high'
        };
      }

      if (hasMediumInfiniteScrollSignals) {
        const confidence = infiniteScrollScore >= 7 ? 'medium' : 'low';
        return {
          type: 'scrollDown',
          selector: null,
          confidence: confidence
        };
      }

      if (loadMoreButton && loadMoreScore >= 8) {
        const selector = this.generateSelectorsForElement(loadMoreButton, doc, selectorGenerator);
        const confidence = loadMoreScore >= 10 ? 'medium' : 'low';
        return {
          type: 'clickLoadMore',
          selector: selector,
          confidence: confidence
        };
      }

      if (nextButton && nextButtonScore >= 8) {
        const selector = this.generateSelectorsForElement(nextButton, doc, selectorGenerator);
        const confidence = nextButtonScore >= 10 ? 'medium' : 'low';
        return {
          type: 'clickNext',
          selector: selector,
          confidence: confidence
        };
      }

      if (prevButton && prevButtonScore >= 8) {
        const confidence = prevButtonScore >= 15 ? 'high' : prevButtonScore >= 10 ? 'medium' : 'low';
        return {
          type: 'scrollUp',
          selector: null,
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
            prev: prevButtonScore,
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
   * Check if element is near the list container
   */
  private isNearList(element: HTMLElement, listContainer: HTMLElement): boolean {
    try {
      const listRect = listContainer.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();

      if (elementRect.top >= listRect.bottom && elementRect.top <= listRect.bottom + 500) {
        return true;
      }

      if (elementRect.bottom <= listRect.top && elementRect.bottom >= listRect.top - 500) {
        return true;
      }

      const verticalOverlap = !(elementRect.bottom < listRect.top || elementRect.top > listRect.bottom);
      if (verticalOverlap) {
        const horizontalDistance = Math.min(
          Math.abs(elementRect.left - listRect.right),
          Math.abs(elementRect.right - listRect.left)
        );
        if (horizontalDistance < 200) {
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
      const indicators: string[] = [];

      const initialItemCount = listElements.length;
      const initialHeight = doc.documentElement.scrollHeight;
      const viewportHeight = window.innerHeight;

      if (initialHeight <= viewportHeight) {
        return 0;
      }

      const loadingIndicators = [
        '[class*="loading"]',
        '[class*="spinner"]',
        '[class*="skeleton"]',
        '[aria-busy="true"]',
        '[data-loading="true"]',
        '.loader',
        '.load-more-spinner',
        '[class*="load"]',
        '[id*="loading"]',
        '[id*="spinner"]'
      ];

      for (const selector of loadingIndicators) {
        if (doc.querySelector(selector)) {
          score += 3;
          indicators.push(`Loading indicator: ${selector} (+3)`);
          break;
        }
      }

      const sentinelPatterns = [
        '[class*="sentinel"]',
        '[class*="trigger"]',
        '[data-infinite]',
        '[data-scroll-trigger]',
        '#infinite-scroll-trigger',
        '[class*="infinite"]',
        '[id*="infinite"]'
      ];

      for (const selector of sentinelPatterns) {
        if (doc.querySelector(selector)) {
          score += 4;
          indicators.push(`Sentinel element: ${selector} (+4)`);
          break;
        }
      }

      const scrollToTopPatterns = [
        '[class*="scroll"][class*="top"]',
        '[aria-label*="scroll to top"]',
        '[title*="back to top"]',
        '.back-to-top',
        '#back-to-top',
        '[class*="scrolltop"]',
        '[class*="backtotop"]',
        'button[class*="top"]',
        'a[href="#top"]',
        'a[href="#"]'
      ];

      for (const selector of scrollToTopPatterns) {
        const element = doc.querySelector(selector);
        if (element && this.isVisible(element as HTMLElement)) {
          score += 2;
          indicators.push(`Scroll-to-top button (+2)`);
          break;
        }
      }

      if (initialHeight > viewportHeight * 3) {
        score += 3;
        indicators.push(`Very tall page (${(initialHeight / viewportHeight).toFixed(1)}x viewport) (+3)`);
      } else if (initialHeight > viewportHeight * 2) {
        score += 2;
        indicators.push(`Tall page (${(initialHeight / viewportHeight).toFixed(1)}x viewport) (+2)`);
      }

      if (initialItemCount >= 20) {
        score += 2;
        indicators.push(`Many list items (${initialItemCount}) (+2)`);
      } else if (initialItemCount >= 10) {
        score += 1;
        indicators.push(`Good number of list items (${initialItemCount}) (+1)`);
      }

      const infiniteScrollLibraries = [
        '.infinite-scroll',
        '[data-infinite-scroll]',
        '[data-flickity]',
        '[data-slick]',
        '.masonry',
        '[data-masonry]',
        '[class*="infinite-scroll"]',
        '[class*="lazy-load"]',
        '[data-lazy]'
      ];

      for (const selector of infiniteScrollLibraries) {
        if (doc.querySelector(selector)) {
          score += 4;
          indicators.push(`Infinite scroll library: ${selector} (+4)`);
          break;
        }
      }

      const lastListItem = listElements[listElements.length - 1];
      if (lastListItem) {
        const lastItemRect = lastListItem.getBoundingClientRect();
        const lastItemY = lastItemRect.bottom + window.scrollY;
        const viewportBottom = window.scrollY + viewportHeight;

        if (lastItemY > viewportBottom + viewportHeight) {
          score += 3;
          indicators.push(`List extends far below viewport (+3)`);
        } else if (lastItemY > viewportBottom) {
          score += 2;
          indicators.push(`List extends below viewport (+2)`);
        }
      }

      const hiddenLoadMore = doc.querySelectorAll('[class*="load"], [class*="more"]');
      for (let i = 0; i < hiddenLoadMore.length; i++) {
        const el = hiddenLoadMore[i] as HTMLElement;
        const style = window.getComputedStyle(el);
        if (style.opacity === '0' || style.visibility === 'hidden') {
          score += 2;
          indicators.push(`Hidden load trigger element (+2)`);
          break;
        }
      }

      const paginationControls = doc.querySelectorAll('[class*="pagination"], [class*="pager"]');
      if (paginationControls.length === 0) {
        score += 1;
        indicators.push(`No pagination controls found (+1)`);
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
