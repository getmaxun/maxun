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

interface TableField {
  selector: string;
  attribute: string;
  tableContext?: string;
  cellIndex?: number;
}

interface NonTableField {
  selector: string;
  attribute: string;
}

interface ContainerFields {
  tableFields: Record<string, TableField>;
  nonTableFields: Record<string, NonTableField>;
}

class ClientListExtractor {
  private queryElement = (
    rootElement: Element | Document,
    selector: string
  ): Element | null => {
    if (!selector.includes(">>") && !selector.includes(":>>")) {
      return rootElement.querySelector(selector);
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
          currentElement = frameDoc.querySelector(parts[i]);
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
        nextElement = currentElement.querySelector(parts[i]);
      }

      if (
        !nextElement &&
        "shadowRoot" in currentElement &&
        (currentElement as Element).shadowRoot
      ) {
        nextElement = (currentElement as Element).shadowRoot!.querySelector(
          parts[i]
        );
      }

      if (!nextElement && "children" in currentElement) {
        const children: any = Array.from(
          (currentElement as Element).children || []
        );
        for (const child of children) {
          if (child.shadowRoot) {
            nextElement = child.shadowRoot.querySelector(parts[i]);
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
      return Array.from(rootElement.querySelectorAll(selector));
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
              nextElements.push(...Array.from(frameDoc.querySelectorAll(part)));
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
            nextElements.push(...Array.from(element.querySelectorAll(part)));
          }

          if ("shadowRoot" in element && (element as Element).shadowRoot) {
            nextElements.push(
              ...Array.from(
                (element as Element).shadowRoot!.querySelectorAll(part)
              )
            );
          }

          if ("children" in element) {
            const children = Array.from((element as Element).children || []);
            for (const child of children) {
              if (child.shadowRoot) {
                nextElements.push(
                  ...Array.from(child.shadowRoot.querySelectorAll(part))
                );
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
      return (element as HTMLElement).innerText?.trim() || null;
    } else if (attribute === "innerHTML") {
      return element.innerHTML?.trim() || null;
    } else if (attribute === "src" || attribute === "href") {
      if (attribute === "href" && element.tagName !== "A") {
        const parentElement = element.parentElement;
        if (parentElement && parentElement.tagName === "A") {
          const parentHref = parentElement.getAttribute("href");
          if (parentHref) {
            try {
              return new URL(parentHref, baseURL).href;
            } catch (e) {
              return parentHref;
            }
          }
        }
      }

      const attrValue = element.getAttribute(attribute);
      const dataAttr = attrValue || element.getAttribute("data-" + attribute);

      if (!dataAttr || dataAttr.trim() === "") {
        if (attribute === "src") {
          const style = window.getComputedStyle(element as HTMLElement);
          const bgImage = style.backgroundImage;
          if (bgImage && bgImage !== "none") {
            const matches = bgImage.match(/url\(['"]?([^'")]+)['"]?\)/);
            return matches ? new URL(matches[1], baseURL).href : null;
          }
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

  private findTableAncestor = (
    element: Element
  ): { type: string; element: Element } | null => {
    let currentElement: Element | null = element;
    const MAX_DEPTH = 5;
    let depth = 0;

    while (currentElement && depth < MAX_DEPTH) {
      if (currentElement.getRootNode() instanceof ShadowRoot) {
        currentElement = (currentElement.getRootNode() as ShadowRoot).host;
        continue;
      }

      if (currentElement.tagName === "TD") {
        return { type: "TD", element: currentElement };
      } else if (currentElement.tagName === "TR") {
        return { type: "TR", element: currentElement };
      }

      if (
        currentElement.tagName === "IFRAME" ||
        currentElement.tagName === "FRAME"
      ) {
        try {
          const frameElement = currentElement as
            | HTMLIFrameElement
            | HTMLFrameElement;
          currentElement = frameElement.contentDocument?.body || null;
        } catch (e) {
          return null;
        }
      } else {
        currentElement = currentElement.parentElement;
      }
      depth++;
    }
    return null;
  };

  private getCellIndex = (td: Element): number => {
    if (td.getRootNode() instanceof ShadowRoot) {
      const shadowRoot = td.getRootNode() as ShadowRoot;
      const allCells = Array.from(shadowRoot.querySelectorAll("td"));
      return allCells.indexOf(td as HTMLTableCellElement);
    }

    let index = 0;
    let sibling = td;
    while ((sibling = sibling.previousElementSibling as Element)) {
      index++;
    }
    return index;
  };

  private hasThElement = (
    row: Element,
    tableFields: Record<string, TableField>
  ): boolean => {
    for (const [_, { selector }] of Object.entries(tableFields)) {
      const element = this.queryElement(row, selector);
      if (element) {
        let current: Element | ShadowRoot | Document | null = element;
        while (current && current !== row) {
          if (current.getRootNode() instanceof ShadowRoot) {
            current = (current.getRootNode() as ShadowRoot).host;
            continue;
          }

          if ((current as Element).tagName === "TH") return true;

          if (
            (current as Element).tagName === "IFRAME" ||
            (current as Element).tagName === "FRAME"
          ) {
            try {
              const frameElement = current as
                | HTMLIFrameElement
                | HTMLFrameElement;
              current = frameElement.contentDocument?.body || null;
            } catch (e) {
              break;
            }
          } else {
            current = (current as Element).parentElement;
          }
        }
      }
    }
    return false;
  };

  private filterRowsBasedOnTag = (
    rows: Element[],
    tableFields: Record<string, TableField>
  ): Element[] => {
    for (const row of rows) {
      if (this.hasThElement(row, tableFields)) {
        return rows;
      }
    }
    return rows.filter((row) => {
      const directTH = row.getElementsByTagName("TH").length === 0;
      const shadowTH = row.shadowRoot
        ? row.shadowRoot.querySelector("th") === null
        : true;
      return directTH && shadowTH;
    });
  };

  private calculateClassSimilarity = (
    classList1: string[],
    classList2: string[]
  ): number => {
    const set1 = new Set(classList1);
    const set2 = new Set(classList2);
    const intersection = new Set([...set1].filter((x) => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    return intersection.size / union.size;
  };

  private findSimilarElements = (
    baseElement: Element,
    document: Document,
    similarityThreshold: number = 0.7
  ): Element[] => {
    const baseClasses = Array.from(baseElement.classList);
    if (baseClasses.length === 0) return [];

    const allElements: Element[] = [];

    allElements.push(
      ...Array.from(document.getElementsByTagName(baseElement.tagName))
    );

    if (baseElement.getRootNode() instanceof ShadowRoot) {
      const shadowHost = (baseElement.getRootNode() as ShadowRoot).host;
      allElements.push(
        ...Array.from(shadowHost.getElementsByTagName(baseElement.tagName))
      );
    }

    const frames = [
      ...Array.from(document.getElementsByTagName("iframe")),
      ...Array.from(document.getElementsByTagName("frame")),
    ];

    for (const frame of frames) {
      try {
        const frameElement = frame as HTMLIFrameElement | HTMLFrameElement;
        const frameDoc =
          frameElement.contentDocument || frameElement.contentWindow?.document;
        if (frameDoc) {
          allElements.push(
            ...Array.from(frameDoc.getElementsByTagName(baseElement.tagName))
          );
        }
      } catch (e) {
        console.warn(
          `Cannot access ${frame.tagName.toLowerCase()} content:`,
          e
        );
      }
    }

    return allElements.filter((element) => {
      if (element === baseElement) return false;
      const similarity = this.calculateClassSimilarity(
        baseClasses,
        Array.from(element.classList)
      );
      return similarity >= similarityThreshold;
    });
  };

  private convertFields = (
    fields: any
  ): Record<string, { selector: string; attribute: string }> => {
    const convertedFields: Record<
      string,
      { selector: string; attribute: string }
    > = {};

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

      // Get all container elements matching the list selector
      let containers = this.queryElementAll(iframeDocument, listSelector);

      if (containers.length === 0) {
        console.warn("No containers found for listSelector:", listSelector);
        return [];
      }

      // Enhanced container discovery: find similar elements if we need more containers
      if (limit > 1 && containers.length === 1) {
        const baseContainer = containers[0];
        const similarContainers = this.findSimilarElements(
          baseContainer,
          iframeDocument,
          0.7
        );

        if (similarContainers.length > 0) {
          const newContainers = similarContainers.filter(
            (container) => !container.matches(listSelector)
          );
          containers = [...containers, ...newContainers];
        }
      }

      // Analyze fields for table vs non-table context
      const containerFields: ContainerFields[] = containers.map(() => ({
        tableFields: {},
        nonTableFields: {},
      }));

      containers.forEach((container, containerIndex) => {
        for (const [label, field] of Object.entries(convertedFields)) {
          const sampleElement = this.queryElement(container, field.selector);

          if (sampleElement) {
            const ancestor = this.findTableAncestor(sampleElement);
            if (ancestor) {
              containerFields[containerIndex].tableFields[label] = {
                ...field,
                tableContext: ancestor.type,
                cellIndex:
                  ancestor.type === "TD"
                    ? this.getCellIndex(ancestor.element)
                    : -1,
              };
            } else {
              containerFields[containerIndex].nonTableFields[label] = field;
            }
          } else {
            containerFields[containerIndex].nonTableFields[label] = field;
          }
        }
      });

      // Extract table data
      const tableData: ExtractedListData[] = [];
      for (
        let containerIndex = 0;
        containerIndex < containers.length;
        containerIndex++
      ) {
        const container = containers[containerIndex];
        const { tableFields } = containerFields[containerIndex];

        if (Object.keys(tableFields).length > 0) {
          const firstField = Object.values(tableFields)[0];
          const firstElement = this.queryElement(
            container,
            firstField.selector
          );
          let tableContext: Element | null = firstElement;

          // Find the table context
          while (
            tableContext &&
            tableContext.tagName !== "TABLE" &&
            tableContext !== container
          ) {
            if (tableContext.getRootNode() instanceof ShadowRoot) {
              tableContext = (tableContext.getRootNode() as ShadowRoot).host;
              continue;
            }

            if (
              tableContext.tagName === "IFRAME" ||
              tableContext.tagName === "FRAME"
            ) {
              try {
                const frameElement = tableContext as
                  | HTMLIFrameElement
                  | HTMLFrameElement;
                tableContext = frameElement.contentDocument?.body || null;
              } catch (e) {
                break;
              }
            } else {
              tableContext = tableContext.parentElement;
            }
          }

          if (tableContext) {
            const rows: Element[] = [];
            rows.push(...Array.from(tableContext.getElementsByTagName("TR")));

            if (
              tableContext.tagName === "IFRAME" ||
              tableContext.tagName === "FRAME"
            ) {
              try {
                const frameElement = tableContext as
                  | HTMLIFrameElement
                  | HTMLFrameElement;
                const frameDoc =
                  frameElement.contentDocument ||
                  frameElement.contentWindow?.document;
                if (frameDoc) {
                  rows.push(...Array.from(frameDoc.getElementsByTagName("TR")));
                }
              } catch (e) {
                console.warn(
                  `Cannot access ${tableContext.tagName.toLowerCase()} rows:`,
                  e
                );
              }
            }

            const processedRows = this.filterRowsBasedOnTag(rows, tableFields);

            for (
              let rowIndex = 0;
              rowIndex < Math.min(processedRows.length, limit);
              rowIndex++
            ) {
              const record: ExtractedListData = {};
              const currentRow = processedRows[rowIndex];

              for (const [
                label,
                { selector, attribute, cellIndex },
              ] of Object.entries(tableFields)) {
                let element: Element | null = null;

                if (cellIndex !== undefined && cellIndex >= 0) {
                  let td: Element | null =
                    currentRow.children[cellIndex] || null;

                  if (!td && currentRow.shadowRoot) {
                    const shadowCells = currentRow.shadowRoot.children;
                    if (shadowCells && shadowCells.length > cellIndex) {
                      td = shadowCells[cellIndex];
                    }
                  }

                  if (td) {
                    element = this.queryElement(td, selector);

                    if (
                      !element &&
                      selector
                        .split(/(?:>>|:>>)/)
                        .pop()
                        ?.includes("td:nth-child")
                    ) {
                      element = td;
                    }

                    if (!element) {
                      const tagOnlySelector = selector.split(".")[0];
                      element = this.queryElement(td, tagOnlySelector);
                    }

                    if (!element) {
                      let currentElement: Element | null = td;
                      while (
                        currentElement &&
                        currentElement.children.length > 0
                      ) {
                        let foundContentChild = false;
                        for (const child of Array.from(
                          currentElement.children
                        )) {
                          if (this.extractValue(child, attribute)) {
                            currentElement = child;
                            foundContentChild = true;
                            break;
                          }
                        }
                        if (!foundContentChild) break;
                      }
                      element = currentElement;
                    }
                  }
                } else {
                  element = this.queryElement(currentRow, selector);
                }

                if (element) {
                  const value = this.extractValue(element, attribute);
                  if (value !== null && value !== "") {
                    record[label] = value;
                  } else {
                    console.warn(
                      `❌ No value for ${label} in row ${rowIndex + 1}`
                    );
                    record[label] = "";
                  }
                } else {
                  console.warn(
                    `❌ Element not found for ${label} with selector:`,
                    selector
                  );
                  record[label] = "";
                }
              }

              if (Object.values(record).some((value) => value !== "")) {
                tableData.push(record);
              }
            }
          }
        }
      }

      // Extract non-table data
      const nonTableData: ExtractedListData[] = [];
      for (
        let containerIndex = 0;
        containerIndex < containers.length;
        containerIndex++
      ) {
        if (nonTableData.length >= limit) break;

        const container = containers[containerIndex];
        const { nonTableFields } = containerFields[containerIndex];

        if (Object.keys(nonTableFields).length > 0) {
          const record: ExtractedListData = {};

          for (const [label, { selector, attribute }] of Object.entries(
            nonTableFields
          )) {
            const relativeSelector = selector.split(/(?:>>|:>>)/).slice(-1)[0];
            const element = this.queryElement(container, relativeSelector);

            if (element) {
              const value = this.extractValue(element, attribute);
              if (value !== null && value !== "") {
                record[label] = value;
              } else {
                console.warn(
                  `❌ No value for ${label} in container ${containerIndex + 1}`
                );
                record[label] = "";
              }
            } else {
              console.warn(
                `❌ Element not found for ${label} with selector:`,
                selector
              );
              record[label] = "";
            }
          }

          if (Object.values(record).some((value) => value !== "")) {
            nonTableData.push(record);
          }
        }
      }

      // Combine and limit results
      const extractedData = [...tableData, ...nonTableData].slice(0, limit);

      return extractedData;
    } catch (error) {
      console.error("Error in client-side extractListData:", error);
      return [];
    }
  };
}

export const clientListExtractor = new ClientListExtractor();
