interface TextStep {
  id: number;
  type: "text";
  label: string;
  data: string;
  selectorObj: {
    selector: string;
    tag?: string;
    isShadow?: boolean;
    attribute: string;
  };
}

interface ExtractedListData {
  [key: string]: string;
}

interface Field {
  selector: string;
  attribute: string;
  tag?: string;
  isShadow?: boolean;
}

class ClientListExtractor {
  private evaluateXPath = (
    rootElement: Element | Document,
    xpath: string
  ): Element | null => {
    try {
      const ownerDoc =
        rootElement.nodeType === Node.DOCUMENT_NODE
          ? (rootElement as Document)
          : rootElement.ownerDocument;

      if (!ownerDoc) return null;

      const result = ownerDoc.evaluate(
        xpath,
        rootElement,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );

      return result.singleNodeValue as Element | null;
    } catch (error) {
      console.warn("XPath evaluation failed:", xpath, error);
      return null;
    }
  };

  private evaluateXPathAll = (
    rootElement: Element | Document,
    xpath: string
  ): Element[] => {
    try {
      const ownerDoc =
        rootElement.nodeType === Node.DOCUMENT_NODE
          ? (rootElement as Document)
          : rootElement.ownerDocument;

      if (!ownerDoc) return [];

      const result = ownerDoc.evaluate(
        xpath,
        rootElement,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null
      );

      const elements: Element[] = [];
      for (let i = 0; i < result.snapshotLength; i++) {
        const node = result.snapshotItem(i);
        if (node && node.nodeType === Node.ELEMENT_NODE) {
          elements.push(node as Element);
        }
      }

      return elements;
    } catch (error) {
      console.warn("XPath evaluation failed:", xpath, error);
      return [];
    }
  };

  private queryElement = (
    rootElement: Element | Document,
    selector: string
  ): Element | null => {
    if (!selector.includes(">>") && !selector.includes(":>>")) {
      // Check if it's an XPath selector (starts with // or / or ./)
      if (
        selector.startsWith("//") ||
        selector.startsWith("/") ||
        selector.startsWith("./")
      ) {
        return this.evaluateXPath(rootElement, selector);
      } else {
        return rootElement.querySelector(selector);
      }
    }

    const parts = selector.split(/(?:>>|:>>)/).map((part) => part.trim());
    let currentElement: Element | Document | null = rootElement;

    for (let i = 0; i < parts.length; i++) {
      if (!currentElement) return null;

      if (
        (currentElement as Element).tagName === "IFRAME" ||
        (currentElement as Element).tagName === "FRAME"
      ) {
        try {
          const frameElement = currentElement as
            | HTMLIFrameElement
            | HTMLFrameElement;
          const frameDoc =
            frameElement.contentDocument ||
            frameElement.contentWindow?.document;
          if (!frameDoc) return null;

          // Handle XPath in iframe context
          if (
            parts[i].startsWith("//") ||
            parts[i].startsWith("/") ||
            parts[i].startsWith("./")
          ) {
            currentElement = this.evaluateXPath(frameDoc, parts[i]);
          } else {
            currentElement = frameDoc.querySelector(parts[i]);
          }
          continue;
        } catch (e) {
          console.warn(
            `Cannot access ${(
              currentElement as Element
            ).tagName.toLowerCase()} content:`,
            e
          );
          return null;
        }
      }

      let nextElement: Element | null = null;

      if ("querySelector" in currentElement) {
        // Handle XPath vs CSS selector
        if (
          parts[i].startsWith("//") ||
          parts[i].startsWith("/") ||
          parts[i].startsWith("./")
        ) {
          nextElement = this.evaluateXPath(currentElement, parts[i]);
        } else {
          nextElement = currentElement.querySelector(parts[i]);
        }
      }

      currentElement = nextElement;
    }

    return currentElement as Element | null;
  };

  private queryElementAll = (
    rootElement: Element | Document,
    selector: string
  ): Element[] => {
    if (!selector.includes(">>") && !selector.includes(":>>")) {
      // Check if it's an XPath selector (starts with // or /)
      if (selector.startsWith("//") || selector.startsWith("/")) {
        return this.evaluateXPathAll(rootElement, selector);
      } else {
        return Array.from(rootElement.querySelectorAll(selector));
      }
    }

    const parts = selector.split(/(?:>>|:>>)/).map((part) => part.trim());
    let currentElements: (Element | Document)[] = [rootElement];

    for (const part of parts) {
      const nextElements: Element[] = [];

      for (const element of currentElements) {
        if (
          (element as Element).tagName === "IFRAME" ||
          (element as Element).tagName === "FRAME"
        ) {
          try {
            const frameElement = element as
              | HTMLIFrameElement
              | HTMLFrameElement;
            const frameDoc =
              frameElement.contentDocument ||
              frameElement.contentWindow?.document;
            if (frameDoc) {
              // Handle XPath in iframe context
              if (part.startsWith("//") || part.startsWith("/")) {
                nextElements.push(...this.evaluateXPathAll(frameDoc, part));
              } else {
                nextElements.push(
                  ...Array.from(frameDoc.querySelectorAll(part))
                );
              }
            }
          } catch (e) {
            console.warn(
              `Cannot access ${(
                element as Element
              ).tagName.toLowerCase()} content:`,
              e
            );
            continue;
          }
        } else {
          if ("querySelectorAll" in element) {
            // Handle XPath vs CSS selector
            if (part.startsWith("//") || part.startsWith("/")) {
              nextElements.push(...this.evaluateXPathAll(element, part));
            } else {
              nextElements.push(...Array.from(element.querySelectorAll(part)));
            }
          }
        }
      }

      currentElements = nextElements;
    }

    return currentElements as Element[];
  };

  private extractValue = (
    element: Element,
    attribute: string
  ): string | null => {
    if (!element) return null;

    const baseURL =
      element.ownerDocument?.location?.href || window.location.origin;

    if (element.shadowRoot) {
      const shadowContent = element.shadowRoot.textContent;
      if (shadowContent?.trim()) {
        return shadowContent.trim();
      }
    }

    if (attribute === "innerText") {
      let textContent =
        (element as HTMLElement).innerText?.trim() ||
        (element as HTMLElement).textContent?.trim();

      if (!textContent) {
        const dataAttributes = [
          "data-600",
          "data-text",
          "data-label",
          "data-value",
          "data-content",
        ];
        for (const attr of dataAttributes) {
          const dataValue = element.getAttribute(attr);
          if (dataValue && dataValue.trim()) {
            textContent = dataValue.trim();
            break;
          }
        }
      }

      return textContent || null;
    } else if (attribute === "innerHTML") {
      return element.innerHTML?.trim() || null;
    } else if (attribute === "href") {
      let anchorElement = element;

      if (element.tagName !== "A") {
        anchorElement =
          element.closest("a") ||
          element.parentElement?.closest("a") ||
          element;
      }

      const hrefValue = anchorElement.getAttribute("href");
      if (!hrefValue || hrefValue.trim() === "") {
        return null;
      }

      try {
        return new URL(hrefValue, baseURL).href;
      } catch (e) {
        console.warn("Error creating URL from", hrefValue, e);
        return hrefValue;
      }
    } else if (attribute === "src") {
      const attrValue = element.getAttribute(attribute);
      const dataAttr = attrValue || element.getAttribute("data-" + attribute);

      if (!dataAttr || dataAttr.trim() === "") {
        const style = window.getComputedStyle(element as HTMLElement);
        const bgImage = style.backgroundImage;
        if (bgImage && bgImage !== "none") {
          const matches = bgImage.match(/url\(['"]?([^'")]+)['"]?\)/);
          return matches ? new URL(matches[1], baseURL).href : null;
        }
        return null;
      }

      try {
        return new URL(dataAttr, baseURL).href;
      } catch (e) {
        console.warn("Error creating URL from", dataAttr, e);
        return dataAttr;
      }
    }
    return element.getAttribute(attribute);
  };

  private convertFields = (fields: any): Record<string, Field> => {
    const convertedFields: Record<string, Field> = {};

    for (const [key, field] of Object.entries(fields)) {
      const typedField = field as TextStep;
      convertedFields[typedField.label] = {
        selector: typedField.selectorObj.selector,
        attribute: typedField.selectorObj.attribute,
        isShadow: typedField.selectorObj.isShadow || false,
      };
    }

    return convertedFields;
  };

  public extractListData = (
    iframeDocument: Document,
    listSelector: string,
    fields: any,
    limit: number = 5
  ): ExtractedListData[] => {
    try {
      const convertedFields = this.convertFields(fields);

      const containers = this.queryElementAll(iframeDocument, listSelector);

      if (containers.length === 0) {
        console.warn("❌ No containers found for listSelector:", listSelector);
        return [];
      }

      const extractedData: ExtractedListData[] = [];
      const containersToProcess = Math.min(containers.length, limit);

      for (
        let containerIndex = 0;
        containerIndex < containersToProcess;
        containerIndex++
      ) {
        const container = containers[containerIndex];
        const record: ExtractedListData = {};

        for (const [label, { selector, attribute, isShadow }] of Object.entries(
          convertedFields
        )) {
          let element: Element | null = null;

          if (selector.startsWith("//")) {
            const indexedSelector = this.createIndexedXPath(
              selector,
              listSelector,
              containerIndex + 1
            );

            element = this.evaluateXPathSingle(
              iframeDocument,
              indexedSelector,
              isShadow
            );
          } else {
            element = this.queryElement(container, selector);
          }

          if (element) {
            const value = this.extractValue(element, attribute);
            if (value !== null && value !== "") {
              record[label] = value;
            } else {
              console.warn(`    ⚠️ Empty value for "${label}"`);
              record[label] = "";
            }
          } else {
            console.warn(`    ❌ Element not found for "${label}"`);
            record[label] = "";
          }
        }

        if (Object.values(record).some((value) => value !== "")) {
          extractedData.push(record);
        } else {
          console.warn(
            `  ⚠️ Skipping empty record for container ${containerIndex + 1}`
          );
        }
      }

      return extractedData;
    } catch (error) {
      console.error("💥 Error in client-side extractListData:", error);
      return [];
    }
  };

  private createIndexedXPath(
    childSelector: string,
    listSelector: string,
    containerIndex: number
  ): string {
    if (childSelector.includes(listSelector.replace("//", ""))) {
      const listPattern = listSelector.replace("//", "");
      const indexedListSelector = `(${listSelector})[${containerIndex}]`;

      const indexedSelector = childSelector.replace(
        `//${listPattern}`,
        indexedListSelector
      );

      return indexedSelector;
    } else {
      console.warn(`    ⚠️ Pattern doesn't match, using fallback approach`);
      return `(${listSelector})[${containerIndex}]${childSelector.replace(
        "//",
        "/"
      )}`;
    }
  }

  // Helper method for single XPath evaluation
  private evaluateXPathSingle = (
    document: Document,
    xpath: string,
    isShadow: boolean = false
  ): Element | null => {
    try {
      const result = document.evaluate(
        xpath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      ).singleNodeValue as Element | null;

      if (!isShadow) {
        if (result === null) {
          return null;
        }
        return result;
      }

      let cleanPath = xpath;
      let isIndexed = false;

      const indexedMatch = xpath.match(/^\((.*?)\)\[(\d+)\](.*)$/);
      if (indexedMatch) {
        cleanPath = indexedMatch[1] + indexedMatch[3];
        isIndexed = true;
      }

      const pathParts = cleanPath
        .replace(/^\/\//, "")
        .split("/")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

      let currentContexts: (Document | Element | ShadowRoot)[] = [document];

      for (let i = 0; i < pathParts.length; i++) {
        const part = pathParts[i];
        const nextContexts: (Element | ShadowRoot)[] = [];

        for (const ctx of currentContexts) {
          const positionalMatch = part.match(/^([^[]+)\[(\d+)\]$/);
          let partWithoutPosition = part;
          let requestedPosition: number | null = null;

          if (positionalMatch) {
            partWithoutPosition = positionalMatch[1];
            requestedPosition = parseInt(positionalMatch[2]);
          }

          const matched = this.queryInsideContext(ctx, partWithoutPosition);

          let elementsToAdd = matched;
          if (requestedPosition !== null) {
            const index = requestedPosition - 1; // XPath is 1-based, arrays are 0-based
            if (index >= 0 && index < matched.length) {
              elementsToAdd = [matched[index]];
            } else {
              console.warn(
                `  ⚠️ Position ${requestedPosition} out of range (${matched.length} elements found)`
              );
              elementsToAdd = [];
            }
          }

          elementsToAdd.forEach((el) => {
            nextContexts.push(el);
            if (el.shadowRoot) {
              nextContexts.push(el.shadowRoot);
            }
          });
        }

        if (nextContexts.length === 0) {
          return null;
        }

        currentContexts = nextContexts;
      }

      if (currentContexts.length > 0) {
        if (isIndexed && indexedMatch) {
          const requestedIndex = parseInt(indexedMatch[2]) - 1; // XPath is 1-based, array is 0-based
          if (requestedIndex >= 0 && requestedIndex < currentContexts.length) {
            return currentContexts[requestedIndex] as Element;
          } else {
            console.warn(
              `⚠️ Requested index ${requestedIndex + 1} out of range (${
                currentContexts.length
              } elements found)`
            );
            return null;
          }
        }

        return currentContexts[0] as Element;
      }

      return null;
    } catch (err) {
      console.error("💥 Critical XPath failure:", xpath, err);
      return null;
    }
  };

  private queryInsideContext = (
    context: Document | Element | ShadowRoot,
    part: string
  ): Element[] => {
    try {
      const { tagName, conditions } = this.parseXPathPart(part);

      const candidateElements = Array.from(context.querySelectorAll(tagName));
      if (candidateElements.length === 0) {
        return [];
      }

      const matchingElements = candidateElements.filter((el) => {
        const matches = this.elementMatchesConditions(el, conditions);
        return matches;
      });

      return matchingElements;
    } catch (err) {
      console.error("Error in queryInsideContext:", err);
      return [];
    }
  };

  private parseXPathPart = (
    part: string
  ): { tagName: string; conditions: string[] } => {
    const tagMatch = part.match(/^([a-zA-Z0-9-]+)/);
    const tagName = tagMatch ? tagMatch[1] : "*";

    const conditionMatches = part.match(/\[([^\]]+)\]/g);
    const conditions = conditionMatches
      ? conditionMatches.map((c) => c.slice(1, -1))
      : [];

    return { tagName, conditions };
  };

  // Check if element matches all given conditions
  private elementMatchesConditions = (
    element: Element,
    conditions: string[]
  ): boolean => {
    for (const condition of conditions) {
      if (!this.elementMatchesCondition(element, condition)) {
        return false;
      }
    }
    return true;
  };

  private elementMatchesCondition = (
    element: Element,
    condition: string
  ): boolean => {
    condition = condition.trim();

    if (/^\d+$/.test(condition)) {
      return true;
    }

    // Handle @attribute="value"
    const attrMatch = condition.match(/^@([^=]+)=["']([^"']+)["']$/);
    if (attrMatch) {
      const [, attr, value] = attrMatch;
      const elementValue = element.getAttribute(attr);
      const matches = elementValue === value;
      return matches;
    }

    // Handle contains(@class, 'value')
    const classContainsMatch = condition.match(
      /^contains\(@class,\s*["']([^"']+)["']\)$/
    );
    if (classContainsMatch) {
      const className = classContainsMatch[1];
      const matches = element.classList.contains(className);
      return matches;
    }

    // Handle contains(@attribute, 'value')
    const attrContainsMatch = condition.match(
      /^contains\(@([^,]+),\s*["']([^"']+)["']\)$/
    );
    if (attrContainsMatch) {
      const [, attr, value] = attrContainsMatch;
      const elementValue = element.getAttribute(attr) || "";
      const matches = elementValue.includes(value);
      return matches;
    }

    // Handle text()="value"
    const textMatch = condition.match(/^text\(\)=["']([^"']+)["']$/);
    if (textMatch) {
      const expectedText = textMatch[1];
      const elementText = element.textContent?.trim() || "";
      const matches = elementText === expectedText;
      return matches;
    }

    // Handle contains(text(), 'value')
    const textContainsMatch = condition.match(
      /^contains\(text\(\),\s*["']([^"']+)["']\)$/
    );
    if (textContainsMatch) {
      const expectedText = textContainsMatch[1];
      const elementText = element.textContent?.trim() || "";
      const matches = elementText.includes(expectedText);
      return matches;
    }

    // Handle count(*)=0 (element has no children)
    if (condition === "count(*)=0") {
      const matches = element.children.length === 0;
      return matches;
    }

    // Handle other count conditions
    const countMatch = condition.match(/^count\(\*\)=(\d+)$/);
    if (countMatch) {
      const expectedCount = parseInt(countMatch[1]);
      const matches = element.children.length === expectedCount;
      return matches;
    }

    return true;
  };
}

export const clientListExtractor = new ClientListExtractor();
