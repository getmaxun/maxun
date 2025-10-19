/**
 * Helper class for managing persistent highlights of captured elements.
 * Shows dotted highlights for elements that have been captured but not yet confirmed.
 */
class CapturedElementHighlighter {
  private static readonly STYLE_ID = 'maxun-captured-elements-style';

  /**
   * Apply persistent dotted highlights to captured elements in the DOM iframe
   * @param selectors Array of captured element selectors
   */
  public applyHighlights(selectors: Array<{ selector: string }>): void {
    const iframeDoc = this.getIframeDocument();
    if (!iframeDoc) return;

    // Remove existing highlights
    this.clearHighlights();

    // Create CSS rules for each captured selector
    const cssRules: string[] = [];

    selectors.forEach(({ selector }) => {
      const cssSelector = this.getCSSSelector(selector);

      if (cssSelector) {
        cssRules.push(`
          ${cssSelector} {
            outline: 2px dotted #ff00c3 !important;
            outline-offset: 2px !important;
            background-color: rgba(255, 0, 195, 0.08) !important;
            box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.5) !important;
          }
        `);
      }
    });

    // Inject style element
    if (cssRules.length > 0) {
      const styleElement = iframeDoc.createElement('style');
      styleElement.id = CapturedElementHighlighter.STYLE_ID;
      styleElement.textContent = cssRules.join('\n');
      iframeDoc.head.appendChild(styleElement);
    }
  }

  /**
   * Clear all persistent highlights from the DOM iframe
   */
  public clearHighlights(): void {
    const iframeDoc = this.getIframeDocument();
    if (!iframeDoc) return;

    const existingStyle = iframeDoc.getElementById(CapturedElementHighlighter.STYLE_ID);
    if (existingStyle) {
      existingStyle.remove();
    }
  }

  /**
   * Get the iframe document
   */
  private getIframeDocument(): Document | null {
    const iframeElement = document.querySelector('#dom-browser-iframe') as HTMLIFrameElement;
    return iframeElement?.contentDocument || null;
  }

  /**
   * Convert selector to CSS format for highlighting
   */
  private getCSSSelector(selector: string): string {
    // Handle XPath selectors by extracting data-mx-id
    if (selector.startsWith('//') || selector.startsWith('(//')) {
      const mxIdMatch = selector.match(/data-mx-id='([^']+)'/);
      if (mxIdMatch) {
        return `[data-mx-id='${mxIdMatch[1]}']`;
      }
      return '';
    }

    // Already a CSS selector
    return selector;
  }
}

export const capturedElementHighlighter = new CapturedElementHighlighter();
