interface TextStep {
  id: number;
  type: "text";
  label: string;
  data: string;
  selectorObj: {
    selector: string;
    tag?: string;
    shadow?: boolean;
    attribute: string;
  };
}

interface ExtractedListData {
  [key: string]: string;
}

interface Field {
  selector: string;
  attribute: string;
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

      if (
        !nextElement &&
        "shadowRoot" in currentElement &&
        (currentElement as Element).shadowRoot
      ) {
        if (
          parts[i].startsWith("//") ||
          parts[i].startsWith("/") ||
          parts[i].startsWith("./")
        ) {
          nextElement = this.evaluateXPath(
            (currentElement as Element).shadowRoot as unknown as Document,
            parts[i]
          );
        } else {
          nextElement = (currentElement as Element).shadowRoot!.querySelector(
            parts[i]
          );
        }
      }

      if (!nextElement && "children" in currentElement) {
        const children: any = Array.from(
          (currentElement as Element).children || []
        );
        for (const child of children) {
          if (child.shadowRoot) {
            if (
              parts[i].startsWith("//") ||
              parts[i].startsWith("/") ||
              parts[i].startsWith("./")
            ) {
              nextElement = this.evaluateXPath(
                child.shadowRoot as unknown as Document,
                parts[i]
              );
            } else {
              nextElement = child.shadowRoot.querySelector(parts[i]);
            }
            if (nextElement) break;
          }
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

          if ("shadowRoot" in element && (element as Element).shadowRoot) {
            if (part.startsWith("//") || part.startsWith("/")) {
              nextElements.push(
                ...this.evaluateXPathAll(
                  (element as Element).shadowRoot as unknown as Document,
                  part
                )
              );
            } else {
              nextElements.push(
                ...Array.from(
                  (element as Element).shadowRoot!.querySelectorAll(part)
                )
              );
            }
          }

          if ("children" in element) {
            const children = Array.from((element as Element).children || []);
            for (const child of children) {
              if (child.shadowRoot) {
                if (part.startsWith("//") || part.startsWith("/")) {
                  nextElements.push(
                    ...this.evaluateXPathAll(
                      child.shadowRoot as unknown as Document,
                      part
                    )
                  );
                } else {
                  nextElements.push(
                    ...Array.from(child.shadowRoot.querySelectorAll(part))
                  );
                }
              }
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
      // First try standard innerText/textContent
      let textContent =
        (element as HTMLElement).innerText?.trim() ||
        (element as HTMLElement).textContent?.trim();

      // If empty, check for common data attributes that might contain the text
      if (!textContent) {
        // Check for data-* attributes that commonly contain text values
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
      // For href, we need to find the anchor tag if the current element isn't one
      let anchorElement = element;

      // If current element is not an anchor, look for parent anchor
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
      // Convert fields to the format expected by the extraction logic
      const convertedFields = this.convertFields(fields);

      // Step 1: Get all container elements matching the list selector
      const containers = this.queryElementAll(iframeDocument, listSelector);

      if (containers.length === 0) {
        console.warn("❌ No containers found for listSelector:", listSelector);
        return [];
      }

      // Step 2: Extract data from each container up to the limit
      const extractedData: ExtractedListData[] = [];
      const containersToProcess = Math.min(containers.length, limit);

      for (
        let containerIndex = 0;
        containerIndex < containersToProcess;
        containerIndex++
      ) {
        const container = containers[containerIndex];
        const record: ExtractedListData = {};

        // Step 3: For each field, extract data from the current container
        for (const [label, { selector, attribute }] of Object.entries(
          convertedFields
        )) {
          let element: Element | null = null;

          // CORRECT APPROACH: Create indexed absolute XPath
          if (selector.startsWith("//")) {
            // Convert the absolute selector to target the specific container instance
            const indexedSelector = this.createIndexedXPath(
              selector,
              listSelector,
              containerIndex + 1
            );

            element = this.evaluateXPathSingle(iframeDocument, indexedSelector);
          } else {
            // Fallback for non-XPath selectors
            element = this.queryElement(container, selector);
          }

          // Step 4: Extract the value from the found element
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

        // Step 5: Add record if it has any non-empty values
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

  // Create indexed XPath for specific container instance
  private createIndexedXPath(
    childSelector: string,
    listSelector: string,
    containerIndex: number
  ): string {
    // Check if the child selector contains the list selector pattern
    if (childSelector.includes(listSelector.replace("//", ""))) {
      // Replace the list selector part with indexed version
      const listPattern = listSelector.replace("//", "");
      const indexedListSelector = `(${listSelector})[${containerIndex}]`;

      const indexedSelector = childSelector.replace(
        `//${listPattern}`,
        indexedListSelector
      );

      return indexedSelector;
    } else {
      // If pattern doesn't match, create a more generic indexed selector
      // This is a fallback approach
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
    xpath: string
  ): Element | null => {
    try {
      const result = document.evaluate(
        xpath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );

      const element = result.singleNodeValue as Element | null;

      if (!element) {
        console.warn(`❌ XPath found no element for: ${xpath}`);
      }

      return element;
    } catch (error) {
      console.error("❌ XPath evaluation failed:", xpath, error);
      return null;
    }
  };
}

export const clientListExtractor = new ClientListExtractor();
