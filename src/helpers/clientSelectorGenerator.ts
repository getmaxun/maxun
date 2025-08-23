interface Coordinates {
  x: number;
  y: number;
}

interface ElementInfo {
  tagName: string;
  hasOnlyText?: boolean;
  innerText?: string;
  url?: string;
  imageUrl?: string;
  attributes?: Record<string, string>;
  innerHTML?: string;
  outerHTML?: string;
  isIframeContent?: boolean;
  isFrameContent?: boolean;
  iframeURL?: string;
  frameURL?: string;
  iframeIndex?: number;
  frameIndex?: number;
  frameHierarchy?: string[];
  isShadowRoot?: boolean;
  shadowRootMode?: string;
  shadowRootContent?: string;
}

interface Selectors {
  id?: string | null;
  generalSelector?: string | null;
  attrSelector?: string | null;
  testIdSelector?: string | null;
  text?: string;
  href?: string;
  hrefSelector?: string | null;
  accessibilitySelector?: string | null;
  formSelector?: string | null;
  relSelector?: string | null;
  iframeSelector?: {
    full: string;
    isIframe: boolean;
  } | null;
  shadowSelector?: {
    full: string;
    mode: string;
  } | null;
}

export enum ActionType {
  AwaitText = "awaitText",
  Click = "click",
  DragAndDrop = "dragAndDrop",
  Screenshot = "screenshot",
  Hover = "hover",
  Input = "input",
  Keydown = "keydown",
  Load = "load",
  Navigate = "navigate",
  Scroll = "scroll",
}

enum TagName {
  A = "A",
  B = "B",
  Cite = "CITE",
  EM = "EM",
  Input = "INPUT",
  Select = "SELECT",
  Span = "SPAN",
  Strong = "STRONG",
  TextArea = "TEXTAREA",
}

interface Action {
  type: ActionType;
  tagName: TagName;
  inputType?: string;
  value?: string;
  selectors: Selectors;
  timestamp: number;
  isPassword: boolean;
  hasOnlyText: boolean;
}

export interface ElementFingerprint {
  tagName: string;
  normalizedClasses: string;
  childrenCount: number;
  childrenStructure: string;
  attributes: string;
  depth: number;
  textCharacteristics: {
    hasText: boolean;
    textLength: number;
    hasLinks: number;
    hasImages: number;
    hasButtons: number;
  };
  signature: string;
}

interface ElementGroup {
  elements: HTMLElement[];
  fingerprint: ElementFingerprint;
  representative: HTMLElement;
}

class ClientSelectorGenerator {
  private listSelector: string = "";
  private getList: boolean = false;
  private paginationMode: boolean = false;

  private pathCache = new WeakMap<HTMLElement, string | null>();
  private descendantsCache = new WeakMap<HTMLElement, HTMLElement[]>();
  private meaningfulCache = new WeakMap<HTMLElement, boolean>();
  private selectorCache = new Map<string, string[]>();

  private elementGroups: Map<HTMLElement, ElementGroup> = new Map();
  private groupedElements: Set<HTMLElement> = new Set();
  private lastAnalyzedDocument: Document | null = null;
  private groupingConfig = {
    minGroupSize: 2,
    similarityThreshold: 0.7,
    minWidth: 50,
    minHeight: 20,
    excludeSelectors: ["script", "style", "meta", "link", "title", "head"],
  };

  private selectorElementCache = new Map<string, HTMLElement[]>();
  private elementSelectorCache = new WeakMap<HTMLElement, string[]>();
  private lastCachedDocument: Document | null = null;
  private classCache = new Map<string, string[]>();
  private spatialIndex = new Map<string, string[]>();

  private performanceConfig = {
    enableSpatialIndexing: true,
    maxSelectorBatchSize: 50, // Process selectors in batches
    useElementCache: true,
    debounceMs: 16, // ~60fps
  };

  // Add setter methods for state management
  public setListSelector(selector: string): void {
    this.listSelector = selector;
  }

  public setGetList(getList: boolean): void {
    this.getList = getList;
  }

  public setPaginationMode(paginationMode: boolean): void {
    this.paginationMode = paginationMode;
  }

  public getCurrentState(): {
    listSelector: string;
    getList: boolean;
    paginationMode: boolean;
  } {
    return {
      listSelector: this.listSelector,
      getList: this.getList,
      paginationMode: this.paginationMode,
    };
  }

  /**
   * Normalize class names by removing dynamic/unique parts
   */
  private normalizeClasses(classList: DOMTokenList): string {
    return Array.from(classList)
      .filter((cls) => {
        // Filter out classes that look like they contain IDs or dynamic content
        return (
          !cls.match(/\d{3,}|uuid|hash|id-|_\d+$/i) &&
          !cls.startsWith("_ngcontent-") &&
          !cls.startsWith("_nghost-") &&
          !cls.match(/^ng-tns-c\d+-\d+$/)
        );
      })
      .sort()
      .join(" ");
  }

  /**
   * generate fallback XPath for child elements using data-mx-id
   */
  private generateMandatoryChildFallbackXPath(
    childElement: HTMLElement,
    parentElement: HTMLElement
  ): string | null {
    try {
      const parentMxId = parentElement.getAttribute("data-mx-id");
      const childMxId = childElement.getAttribute("data-mx-id");

      if (!parentMxId) {
        console.warn(
          "Parent element missing data-mx-id attribute for fallback"
        );
        return null;
      }

      const parentTagName = parentElement.tagName.toLowerCase();
      const childTagName = childElement.tagName.toLowerCase();

      if (childMxId) {
        return `//${parentTagName}[@data-mx-id='${parentMxId}']//${childTagName}[@data-mx-id='${childMxId}']`;
      } else {
        const pathElements = this.getMandatoryFallbackPath(
          childElement,
          parentElement
        );
        if (pathElements.length > 0) {
          const parentPath = `//${parentTagName}[@data-mx-id='${parentMxId}']`;
          const childPath = pathElements.join("/");
          return `${parentPath}/${childPath}`;
        }
      }

      return null;
    } catch (error) {
      console.error("Error generating mandatory child fallback XPath:", error);
      return null;
    }
  }

  /**
   * Build mandatory fallback path using data-mx-id where available
   */
  private getMandatoryFallbackPath(
    targetElement: HTMLElement,
    rootElement: HTMLElement
  ): string[] {
    const pathParts: string[] = [];
    let current = targetElement;

    while (current && current !== rootElement && current.parentElement) {
      const mxId = current.getAttribute("data-mx-id");
      const tagName = current.tagName.toLowerCase();

      if (mxId) {
        // Always prefer data-mx-id when available
        pathParts.unshift(`${tagName}[@data-mx-id='${mxId}']`);
      } else {
        // Use position as fallback when data-mx-id is not available
        const position =
          Array.from(current.parentElement.children)
            .filter((child) => child.tagName === current.tagName)
            .indexOf(current) + 1;
        pathParts.unshift(`${tagName}[${position}]`);
      }

      current = current.parentElement;
    }

    return pathParts;
  }

  /**
   * generate fallback for group container using data-mx-id
   */
  private generateMandatoryGroupFallback(
    elements: HTMLElement[]
  ): string | null {
    try {
      if (!elements || elements.length === 0) return null;

      const tagName = elements[0].tagName.toLowerCase();

      const mxIds = elements
        .map((el) => el.getAttribute("data-mx-id"))
        .filter(Boolean);

      if (mxIds.length > 0) {
        if (mxIds.length === 1) {
          return `//${tagName}[@data-mx-id='${mxIds[0]}']`;
        } else {
          const mxIdConditions = mxIds
            .map((id) => `@data-mx-id='${id}'`)
            .join(" or ");
          return `//${tagName}[${mxIdConditions}]`;
        }
      }

      return null;
    } catch (error) {
      console.error("Error generating mandatory group fallback:", error);
      return null;
    }
  }

  /**
   * Get element's structural fingerprint for grouping
   */
  private getStructuralFingerprint(
    element: HTMLElement
  ): ElementFingerprint | null {
    if (element.nodeType !== Node.ELEMENT_NODE) return null;

    const tagName = element.tagName.toLowerCase();
    const isCustomElement = tagName.includes("-");

    const standardExcludeSelectors = [
      "script",
      "style",
      "meta",
      "link",
      "title",
      "head",
    ];
    if (!isCustomElement && standardExcludeSelectors.includes(tagName)) {
      return null;
    }

    if (this.groupingConfig.excludeSelectors.includes(tagName)) return null;

    const children = Array.from(element.children);
    let childrenStructureString: string;

    if (tagName === 'table') {
        // For tables, the fingerprint is based on the header or first row's structure.
        const thead = element.querySelector('thead');
        const representativeRow = thead ? thead.querySelector('tr') : element.querySelector('tr');
        
        if (representativeRow) {
            const structure = Array.from(representativeRow.children).map(child => ({
                tag: child.tagName.toLowerCase(),
                classes: this.normalizeClasses(child.classList),
            }));
            childrenStructureString = JSON.stringify(structure);
        } else {
            childrenStructureString = JSON.stringify([]);
        }
    } else if (tagName === 'tr') {
        // For rows, the fingerprint is based on the cell structure, ignoring the cell's inner content.
        const structure = children.map((child) => ({
            tag: child.tagName.toLowerCase(),
            classes: this.normalizeClasses(child.classList),
        }));
        childrenStructureString = JSON.stringify(structure);
    } else {
        // Original logic for all other elements.
        const structure = children.map((child) => ({
            tag: child.tagName.toLowerCase(),
            classes: this.normalizeClasses(child.classList),
            hasText: (child.textContent ?? "").trim().length > 0,
        }));
        childrenStructureString = JSON.stringify(structure);
    }

    const normalizedClasses = this.normalizeClasses(element.classList);

    const relevantAttributes = Array.from(element.attributes)
      .filter((attr) => {
        if (isCustomElement) {
          return !["id", "style", "data-reactid", "data-react-checksum"].includes(attr.name.toLowerCase());
        } else {
          return (
            !["id", "style", "data-reactid", "data-react-checksum"].includes(attr.name.toLowerCase()) &&
            (!attr.name.startsWith("data-") || attr.name === "data-type" || attr.name === "data-role")
          );
        }
      })
      .map((attr) => `${attr.name}=${attr.value}`)
      .sort();

    let depth = 0;
    let parent = element.parentElement;
    while (parent && depth < 20) {
      depth++;
      parent = parent.parentElement;
    }

    const textContent = (element.textContent ?? "").trim();
    const textCharacteristics = {
      hasText: textContent.length > 0,
      textLength: Math.floor(textContent.length / 20) * 20,
      hasLinks: element.querySelectorAll("a").length,
      hasImages: element.querySelectorAll("img").length,
      hasButtons: element.querySelectorAll('button, input[type="button"], input[type="submit"]').length,
    };

    const signature = `${tagName}::${normalizedClasses}::${children.length}::${childrenStructureString}::${relevantAttributes.join("|")}`;

    return {
      tagName,
      normalizedClasses,
      childrenCount: children.length,
      childrenStructure: childrenStructureString,
      attributes: relevantAttributes.join("|"),
      depth,
      textCharacteristics,
      signature,
    };
  }

  /**
   * Calculate similarity between two fingerprints
   */
  private calculateSimilarity(
    fp1: ElementFingerprint,
    fp2: ElementFingerprint
  ): number {
    if (!fp1 || !fp2) return 0;

    let score = 0;
    let maxScore = 0;

    // Tag name must match
    maxScore += 10;
    if (fp1.tagName === fp2.tagName) score += 10;
    else return 0;

    // Class similarity
    maxScore += 8;
    if (fp1.normalizedClasses === fp2.normalizedClasses) score += 8;
    else if (fp1.normalizedClasses && fp2.normalizedClasses) {
      const classes1 = fp1.normalizedClasses.split(" ").filter((c) => c);
      const classes2 = fp2.normalizedClasses.split(" ").filter((c) => c);
      const commonClasses = classes1.filter((c) => classes2.includes(c));
      if (classes1.length > 0 && classes2.length > 0) {
        score +=
          (commonClasses.length / Math.max(classes1.length, classes2.length)) *
          8;
      }
    }

    // Children structure
    maxScore += 8;
    if (fp1.childrenStructure === fp2.childrenStructure) score += 8;
    else if (fp1.childrenCount === fp2.childrenCount) score += 4;

    // Attributes similarity
    maxScore += 5;
    if (fp1.attributes === fp2.attributes) score += 5;
    else if (fp1.attributes && fp2.attributes) {
      const attrs1 = fp1.attributes.split("|").filter((a) => a);
      const attrs2 = fp2.attributes.split("|").filter((a) => a);
      const commonAttrs = attrs1.filter((a) => attrs2.includes(a));
      if (attrs1.length > 0 && attrs2.length > 0) {
        score +=
          (commonAttrs.length / Math.max(attrs1.length, attrs2.length)) * 5;
      }
    }

    // Depth similarity
    maxScore += 2;
    if (Math.abs(fp1.depth - fp2.depth) <= 1) score += 2;
    else if (Math.abs(fp1.depth - fp2.depth) <= 2) score += 1;

    // Text characteristics similarity
    maxScore += 3;
    const tc1 = fp1.textCharacteristics;
    const tc2 = fp2.textCharacteristics;
    if (tc1.hasText === tc2.hasText) score += 1;
    if (Math.abs(tc1.textLength - tc2.textLength) <= 40) score += 1;
    if (tc1.hasLinks === tc2.hasLinks && tc1.hasImages === tc2.hasImages)
      score += 1;

    return maxScore > 0 ? score / maxScore : 0;
  }

  private getAllVisibleElementsWithShadow(doc: Document): HTMLElement[] {
    const allElements: HTMLElement[] = [];
    const visited = new Set<HTMLElement>();

    const traverseContainer = (container: Document | ShadowRoot) => {
      try {
        const elements = Array.from(container.querySelectorAll("*")).filter(
          (el) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0; // Only visible elements
          }
        ) as HTMLElement[];

        elements.forEach((element) => {
          if (!visited.has(element)) {
            visited.add(element);
            allElements.push(element);

            // Traverse shadow DOM if it exists
            if (element.shadowRoot) {
              traverseContainer(element.shadowRoot);
            }
          }
        });
      } catch (error) {
        console.warn(`⚠️ Error traversing container:`, error);
      }
    };

    // Start from main document
    traverseContainer(doc);

    return allElements;
  }

  public analyzeElementGroups(iframeDoc: Document): void {
    // Only re-analyze if document changed
    if (
      this.lastAnalyzedDocument === iframeDoc &&
      this.elementGroups.size > 0
    ) {
      return;
    }
  
    // Clear previous analysis
    this.elementGroups.clear();
    this.groupedElements.clear();
    this.lastAnalyzedDocument = iframeDoc;
  
    // Get all visible elements INCLUDING shadow DOM
    let allElements = this.getAllVisibleElementsWithShadow(iframeDoc);
    
    if (this.getList === true && this.listSelector === "") {
      const dialogElements = this.findAllDialogElements(iframeDoc);
      
      if (dialogElements.length > 0) {
        // Check if dialogs contain significant content worth analyzing
        const dialogContentElements = this.getElementsFromDialogs(dialogElements);
        
        // Only switch to dialog-focused analysis if dialogs have substantial content
        if (dialogContentElements.length > 5) {
          allElements = dialogContentElements;
        }
      }
    }
    const processedInTables = new Set<HTMLElement>();
  
    // 1. Specifically find and group rows within each table, bypassing normal similarity checks.
    const tables = allElements.filter(el => el.tagName === 'TABLE');
    
    tables.forEach(table => {
      const rows = Array.from(table.querySelectorAll('tbody > tr')).filter(row => {
        const parent = row.parentElement;
        if (!parent || !table.contains(parent)) return false; // Ensure row belongs to this table
        
        const rect = row.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }) as HTMLElement[];
  
      // If the table has enough rows, force them into a single group.
      if (rows.length >= this.groupingConfig.minGroupSize) {
        const representativeFingerprint = this.getStructuralFingerprint(rows[0]);
        if (!representativeFingerprint) return;

        const group: ElementGroup = {
          elements: rows,
          fingerprint: representativeFingerprint,
          representative: rows[0],
        };
  
        rows.forEach(row => {
          this.elementGroups.set(row, group);
          this.groupedElements.add(row);
          processedInTables.add(row);
        });
      }
    });
  
    // 2. Group all other elements, excluding table rows that were already grouped.
    const remainingElements = allElements.filter(el => !processedInTables.has(el));
    const elementFingerprints = new Map<HTMLElement, ElementFingerprint>();
    remainingElements.forEach((element) => {
      const fingerprint = this.getStructuralFingerprint(element);
      if (fingerprint) {
        elementFingerprints.set(element, fingerprint);
      }
    });
  
    const processedElements = new Set<HTMLElement>();
    elementFingerprints.forEach((fingerprint, element) => {
      if (processedElements.has(element)) return;
  
      const currentGroup = [element];
      processedElements.add(element);
  
      elementFingerprints.forEach((otherFingerprint, otherElement) => {
        if (processedElements.has(otherElement)) return;
  
        const similarity = this.calculateSimilarity(fingerprint, otherFingerprint);
        if (similarity >= this.groupingConfig.similarityThreshold) {
          currentGroup.push(otherElement);
          processedElements.add(otherElement);
        }
      });
  
      if (currentGroup.length >= this.groupingConfig.minGroupSize && this.hasAnyMeaningfulChildren(element)) {
        const group: ElementGroup = {
          elements: currentGroup,
          fingerprint,
          representative: element,
        };
        currentGroup.forEach((el) => {
          this.elementGroups.set(el, group);
          this.groupedElements.add(el);
        });
      }
    });
  }

  /**
   * Check if element has any meaningful children that can be extracted
   */
  private hasAnyMeaningfulChildren(element: HTMLElement): boolean {
    const meaningfulChildren = this.getMeaningfulChildren(element);
    return meaningfulChildren.length > 0;
  }

  /**
   * Get meaningful children (those with text, links, images, etc.)
   */
  private getMeaningfulChildren(element: HTMLElement): HTMLElement[] {
    const meaningfulChildren: HTMLElement[] = [];

    const traverse = (el: HTMLElement, depth: number = 0) => {
      if (depth > 5) return; // Prevent infinite recursion

      Array.from(el.children).forEach((child) => {
        const htmlChild = child as HTMLElement;

        // Check if this child has meaningful content
        if (this.isMeaningfulElement(htmlChild)) {
          meaningfulChildren.push(htmlChild);
        } else {
          // If not meaningful itself, check its children
          traverse(htmlChild, depth + 1);
        }
      });

      if (el.shadowRoot) {
        Array.from(el.shadowRoot.children).forEach((shadowChild) => {
          const htmlShadowChild = shadowChild as HTMLElement;
          if (this.isMeaningfulElement(htmlShadowChild)) {
            meaningfulChildren.push(htmlShadowChild);
          } else {
            traverse(htmlShadowChild, depth + 1);
          }
        });
      }
    };

    traverse(element);
    return meaningfulChildren;
  }

  /**
   * Check if element has meaningful content for extraction (cached version)
   */
  private isMeaningfulElementCached(element: HTMLElement): boolean {
    if (this.meaningfulCache.has(element)) {
      return this.meaningfulCache.get(element)!;
    }

    const result = this.isMeaningfulElement(element);
    this.meaningfulCache.set(element, result);
    return result;
  }

  /**
   * Check if element has meaningful content for extraction
   */
  private isMeaningfulElement(element: HTMLElement): boolean {
    const tagName = element.tagName.toLowerCase();
    
    // Fast path for common meaningful elements
    if (["a", "img", "input", "button", "select"].includes(tagName)) {
      return true;
    }

    const text = (element.textContent || "").trim();
    const hasHref = element.hasAttribute("href");
    const hasSrc = element.hasAttribute("src");
    
    // Quick checks first
    if (text.length > 0 || hasHref || hasSrc) {
      return true;
    }

    const isCustomElement = tagName.includes("-");

    // For custom elements, be more lenient about what's considered meaningful
    if (isCustomElement) {
      const hasChildren = element.children.length > 0;
      const hasSignificantAttributes = Array.from(element.attributes).some(
        (attr) => !["class", "style", "id"].includes(attr.name.toLowerCase())
      );

      return (
        hasChildren ||
        hasSignificantAttributes ||
        element.hasAttribute("role") ||
        element.hasAttribute("aria-label")
      );
    }

    return false;
  }

  /**
   * Check if an element is part of a group (for highlighting)
   */
  public isElementGrouped(element: HTMLElement): boolean {
    return this.groupedElements.has(element);
  }

  /**
   * Get the group for a specific element
   */
  public getElementGroup(element: HTMLElement): ElementGroup | null {
    return this.elementGroups.get(element) || null;
  }

  public getAllMatchingElements(
    hoveredSelector: string,
    childSelectors: string[],
    iframeDoc: Document
  ): HTMLElement[] {
    try {
      const matchingElements: HTMLElement[] = [];

      if (childSelectors.includes(hoveredSelector)) {
        const directElements = this.evaluateXPath(hoveredSelector, iframeDoc);
        matchingElements.push(...directElements);

        if (directElements.length === 0) {
          const shadowElements = this.findElementsInShadowDOM(
            hoveredSelector,
            iframeDoc
          );
          matchingElements.push(...shadowElements);
        }
      } else {
        const hoveredPattern = this.extractSelectorPattern(hoveredSelector);

        childSelectors.forEach((childSelector) => {
          const childPattern = this.extractSelectorPattern(childSelector);

          if (this.arePatternsRelated(hoveredPattern, childPattern)) {
            const directElements = this.evaluateXPath(childSelector, iframeDoc);
            matchingElements.push(...directElements);

            if (directElements.length === 0) {
              const shadowElements = this.findElementsInShadowDOM(
                childSelector,
                iframeDoc
              );
              matchingElements.push(...shadowElements);
            }
          }
        });
      }

      return [...new Set(matchingElements)];
    } catch (error) {
      console.error("Error getting matching elements:", error);
      return [];
    }
  }

  /**
   * Extract pattern components from selector for comparison
   */
  private extractSelectorPattern(selector: string): {
    tag: string;
    classes: string[];
    hasPosition: boolean;
    structure: string;
  } {
    // Handle XPath selectors
    if (selector.startsWith("//") || selector.startsWith("/")) {
      const tagMatch = selector.match(/\/\/(\w+)/);
      const classMatches =
        selector.match(/contains\(@class,'([^']+)'\)/g) || [];
      const classes = classMatches
        .map((match) => {
          const classMatch = match.match(/contains\(@class,'([^']+)'\)/);
          return classMatch ? classMatch[1] : "";
        })
        .filter((cls) => cls);

      return {
        tag: tagMatch ? tagMatch[1] : "",
        classes,
        hasPosition: /\[\d+\]/.test(selector),
        structure: selector.replace(/\[\d+\]/g, "").replace(/\/\/\w+/, "//TAG"),
      };
    }

    // Handle CSS selectors
    const parts = selector.split(" ").pop() || "";
    const tagMatch = parts.match(/^(\w+)/);
    const classMatches = parts.match(/\.([^.#[\s]+)/g) || [];
    const classes = classMatches.map((cls) => cls.substring(1));

    return {
      tag: tagMatch ? tagMatch[1] : "",
      classes,
      hasPosition: /:nth-child\(\d+\)/.test(selector),
      structure: selector
        .replace(/:nth-child\(\d+\)/g, "")
        .replace(/\w+/g, "TAG"),
    };
  }

  /**
   * Check if two selector patterns are related/similar
   */
  private arePatternsRelated(pattern1: any, pattern2: any): boolean {
    // Must have same tag
    if (pattern1.tag !== pattern2.tag || !pattern1.tag) {
      return false;
    }

    // Check for common classes
    const commonClasses = pattern1.classes.filter((cls: any) =>
      pattern2.classes.includes(cls)
    );

    // Similar if they have same tag and at least one common class, or same structure
    return (
      commonClasses.length > 0 || pattern1.structure === pattern2.structure
    );
  }

  /**
   * Find elements that match a child selector XPath by traversing shadow DOMs
   * This handles cases where the child elements are nested within shadow roots of parent elements
   */
  private findElementsInShadowDOM(
    xpath: string,
    iframeDoc: Document
  ): HTMLElement[] {
    try {
      const matchingElements: HTMLElement[] = [];

      const xpathParts = this.parseChildXPath(xpath);
      if (!xpathParts) {
        console.warn("Could not parse child XPath:", xpath);
        return [];
      }

      const parentElements = this.evaluateXPath(
        xpathParts.parentXPath,
        iframeDoc
      );

      parentElements.forEach((parentElement, index) => {
        const childElements = this.findChildrenInElementShadowDOM(
          parentElement,
          xpathParts.childPath,
          xpathParts.childFilters
        );

        matchingElements.push(...childElements);
      });

      return matchingElements;
    } catch (error) {
      console.error("Error in findElementsInShadowDOM:", error);
      return [];
    }
  }

  /**
   * Parse a child XPath to extract parent selector and child path
   */
  private parseChildXPath(xpath: string): {
    parentXPath: string;
    childPath: string[];
    childFilters: string[];
  } | null {
    try {
      const xpathPattern =
        /^(\/\/[^\/]+(?:\[[^\]]*\])*)((?:\/[^\/]+(?:\[[^\]]*\])*)*)$/;
      const match = xpath.match(xpathPattern);

      if (!match) {
        console.warn("Could not match XPath pattern:", xpath);
        return null;
      }

      const parentXPath = match[1];
      const childPathString = match[2];

      const childPath = childPathString
        .split("/")
        .filter((part) => part.length > 0);

      const childFilters = childPath
        .map((part) => {
          const filterMatch = part.match(/\[([^\]]+)\]/);
          return filterMatch ? filterMatch[1] : "";
        })
        .filter((filter) => filter.length > 0);

      return {
        parentXPath,
        childPath,
        childFilters,
      };
    } catch (error) {
      console.error("Error parsing child XPath:", error);
      return null;
    }
  }

  /**
   * Find child elements within a parent element's shadow DOM tree
   */
  private findChildrenInElementShadowDOM(
    parentElement: HTMLElement,
    childPath: string[],
    childFilters: string[]
  ): HTMLElement[] {
    const matchingChildren: HTMLElement[] = [];
    const visited = new Set<HTMLElement>();

    const traverseElement = (element: HTMLElement, depth: number = 0) => {
      if (depth > 10 || visited.has(element)) return;
      visited.add(element);

      if (element.shadowRoot) {
        this.searchWithinShadowRoot(
          element.shadowRoot,
          childPath,
          childFilters,
          matchingChildren
        );
      }

      Array.from(element.children).forEach((child) => {
        traverseElement(child as HTMLElement, depth + 1);
      });
    };

    traverseElement(parentElement);

    return matchingChildren;
  }

  /**
   * Search within a shadow root for elements matching the child path
   */
  private searchWithinShadowRoot(
    shadowRoot: ShadowRoot,
    childPath: string[],
    childFilters: string[],
    matchingChildren: HTMLElement[]
  ): void {
    try {
      if (childPath.length === 0) {
        const allElements = shadowRoot.querySelectorAll("*");
        matchingChildren.push(...(Array.from(allElements) as HTMLElement[]));
        return;
      }

      let currentElements: HTMLElement[] = Array.from(
        shadowRoot.querySelectorAll("*")
      ) as HTMLElement[];

      for (let i = 0; i < childPath.length; i++) {
        const pathPart = childPath[i];

        const tagMatch = pathPart.match(/^([^[]+)/);
        if (!tagMatch) continue;

        const tagName = tagMatch[1];
        const classMatches = pathPart.match(/contains\(@class,\s*'([^']+)'\)/g);
        const requiredClasses = classMatches
          ? classMatches
              .map((classMatch) => {
                const classNameMatch = classMatch.match(
                  /contains\(@class,\s*'([^']+)'\)/
                );
                return classNameMatch ? classNameMatch[1] : "";
              })
              .filter((cls) => cls.length > 0)
          : [];

        const filteredElements = currentElements.filter((element) => {
          if (element.tagName.toLowerCase() !== tagName.toLowerCase()) {
            return false;
          }

          for (const requiredClass of requiredClasses) {
            if (!element.classList.contains(requiredClass)) {
              return false;
            }
          }

          return true;
        });

        if (i === childPath.length - 1) {
          matchingChildren.push(...filteredElements);
        } else {
          const nextElements: HTMLElement[] = [];
          filteredElements.forEach((element) => {
            Array.from(element.children).forEach((child) => {
              nextElements.push(child as HTMLElement);
            });

            if (element.shadowRoot) {
              Array.from(element.shadowRoot.querySelectorAll("*")).forEach(
                (shadowChild) => {
                  nextElements.push(shadowChild as HTMLElement);
                }
              );
            }
          });
          currentElements = nextElements;
        }
      }

      const elementsWithShadow = shadowRoot.querySelectorAll("*");
      elementsWithShadow.forEach((element) => {
        const htmlElement = element as HTMLElement;
        if (htmlElement.shadowRoot) {
          this.searchWithinShadowRoot(
            htmlElement.shadowRoot,
            childPath,
            childFilters,
            matchingChildren
          );
        }
      });
    } catch (error) {
      console.error("Error searching within shadow root:", error);
    }
  }

  /**
   * Modified container finding that only returns grouped elements
   */
  private findGroupedContainerAtPoint(
    x: number,
    y: number,
    iframeDoc: Document
  ): HTMLElement | null {
    // Ensure groups are analyzed
    this.analyzeElementGroups(iframeDoc);

    // Get all elements at the point
    const elementsAtPoint = iframeDoc.elementsFromPoint(x, y) as HTMLElement[];
    if (!elementsAtPoint.length) return null;

    console.log("Elements at point:", elementsAtPoint);
    console.log("Grouped elements:", this.groupedElements);

    // In list mode without selector, transform table cells to rows and prioritize grouped elements
    if (this.getList === true && this.listSelector === "") {
      const transformedElements: HTMLElement[] = [];

      elementsAtPoint.forEach((element) => {
        if (element.tagName === "TD" || element.tagName === "TH") {
          const parentRow = element.closest("tr") as HTMLElement;
          if (parentRow && !transformedElements.includes(parentRow)) {
            transformedElements.push(parentRow);
          }
        } else {
          if (!transformedElements.includes(element)) {
            transformedElements.push(element);
          }
        }
      });

      const groupedElementsAtPoint = transformedElements.filter((element) =>
        this.isElementGrouped(element)
      );

      if (groupedElementsAtPoint.length > 0) {
        const hasAnchorTag = groupedElementsAtPoint.some(
          (el) => el.tagName === "A"
        );

        let filteredElements = groupedElementsAtPoint;

        if (hasAnchorTag) {
          // Apply parent-child filtering when anchor tags are present
          filteredElements = this.filterParentChildGroupedElements(
            groupedElementsAtPoint
          );
        }

        // Sort by DOM depth (deeper elements first for more specificity)
        filteredElements.sort((a, b) => {
          const aDepth = this.getElementDepth(a);
          const bDepth = this.getElementDepth(b);
          return bDepth - aDepth;
        });

        const selectedElement = filteredElements[0];
        return selectedElement;
      }

      return null;
    }

    return this.getDeepestElementFromPoint(x, y, iframeDoc);
  }

  private filterParentChildGroupedElements(
    groupedElements: HTMLElement[]
  ): HTMLElement[] {
    const result: HTMLElement[] = [];

    for (const element of groupedElements) {
      // Check if this element has any grouped children in the same list
      const hasGroupedChild = groupedElements.some(
        (other) => other !== element && element.contains(other)
      );

      // If this element contains other grouped elements, prefer this one (the parent)
      if (hasGroupedChild) {
        result.push(element);
      }
    }

    // If no parent-child relationships found, return all elements
    return result.length > 0 ? result : groupedElements;
  }

  public getElementInformation = (
    iframeDoc: Document,
    coordinates: Coordinates,
    listSelector: string,
    getList: boolean
  ) => {
    try {
      if (!getList || listSelector !== "") {
        const el = this.getDeepestElementFromPoint(
          coordinates.x,
          coordinates.y,
          iframeDoc
        );

        if (el) {
          // Prioritize Link (DO NOT REMOVE)
          const { parentElement } = el;
          const targetElement =
            parentElement?.tagName === "A" ? parentElement : el;

          const ownerDocument = targetElement.ownerDocument;
          const frameElement = ownerDocument?.defaultView
            ?.frameElement as HTMLIFrameElement;
          const isIframeContent = Boolean(frameElement);
          const isFrameContent = frameElement?.tagName === "FRAME";

          const containingShadowRoot =
            targetElement.getRootNode() as ShadowRoot;
          const isShadowRoot = containingShadowRoot instanceof ShadowRoot;

          let info: {
            tagName: string;
            hasOnlyText?: boolean;
            innerText?: string;
            url?: string;
            imageUrl?: string;
            attributes?: Record<string, string>;
            innerHTML?: string;
            outerHTML?: string;
            isIframeContent?: boolean;
            isFrameContent?: boolean;
            iframeURL?: string;
            frameURL?: string;
            iframeIndex?: number;
            frameIndex?: number;
            frameHierarchy?: string[];
            isShadowRoot?: boolean;
            shadowRootMode?: string;
            shadowRootContent?: string;
          } = {
            tagName: targetElement?.tagName ?? "",
            isIframeContent,
            isFrameContent,
            isShadowRoot,
          };

          if (isIframeContent || isFrameContent) {
            if (isIframeContent) {
              info.iframeURL = (frameElement as HTMLIFrameElement).src;
            } else {
              info.frameURL = frameElement.src;
            }

            let currentFrame = frameElement;
            const frameHierarchy: string[] = [];
            let frameIndex = 0;

            while (currentFrame) {
              frameHierarchy.unshift(
                currentFrame.id ||
                  currentFrame.getAttribute("name") ||
                  currentFrame.src ||
                  `${currentFrame.tagName.toLowerCase()}[${frameIndex}]`
              );

              const parentDoc = currentFrame.ownerDocument;
              currentFrame = parentDoc?.defaultView
                ?.frameElement as HTMLIFrameElement;
              frameIndex++;
            }

            info.frameHierarchy = frameHierarchy;
            if (isIframeContent) {
              info.iframeIndex = frameIndex - 1;
            } else {
              info.frameIndex = frameIndex - 1;
            }
          }

          if (isShadowRoot) {
            info.shadowRootMode = containingShadowRoot.mode;
            info.shadowRootContent = containingShadowRoot.innerHTML;
          }

          if (targetElement) {
            info.attributes = Array.from(targetElement.attributes).reduce(
              (acc, attr) => {
                acc[attr.name] = attr.value;
                return acc;
              },
              {} as Record<string, string>
            );

            if (targetElement.tagName === "A") {
              info.url = (targetElement as HTMLAnchorElement).href;
              info.innerText = targetElement.textContent ?? "";
            } else if (targetElement.tagName === "IMG") {
              info.imageUrl = (targetElement as HTMLImageElement).src;
            } else if (targetElement?.tagName === "SELECT") {
              const selectElement = targetElement as HTMLSelectElement;
              info.innerText =
                selectElement.options[selectElement.selectedIndex]?.text ?? "";
              info.attributes = {
                ...info.attributes,
                selectedValue: selectElement.value,
              };
            } else if (
              (targetElement?.tagName === "INPUT" &&
                (targetElement as HTMLInputElement).type === "time") ||
              (targetElement as HTMLInputElement).type === "date"
            ) {
              info.innerText = (targetElement as HTMLInputElement).value;
            } else {
              info.hasOnlyText =
                targetElement.children.length === 0 &&
                targetElement.textContent !== null &&
                targetElement.textContent.trim().length > 0;
              info.innerText = targetElement.textContent ?? "";
            }

            info.innerHTML = targetElement.innerHTML;
            info.outerHTML = targetElement.outerHTML;
          }

          return info;
        }
        return null;
      } else {
        const originalEl = this.findGroupedContainerAtPoint(
          coordinates.x,
          coordinates.y,
          iframeDoc
        );

        if (originalEl) {
          let element = originalEl;

          if (element.tagName === "TD" || element.tagName === "TH") {
            const tableParent = element.closest("table");
            if (tableParent) {
              element = tableParent;
            }
          }

          const ownerDocument = element.ownerDocument;
          const frameElement = ownerDocument?.defaultView?.frameElement;
          const isIframeContent = Boolean(frameElement);
          const isFrameContent = frameElement?.tagName === "FRAME";

          const containingShadowRoot = element.getRootNode() as ShadowRoot;
          const isShadowRoot = containingShadowRoot instanceof ShadowRoot;

          let info: {
            tagName: string;
            hasOnlyText?: boolean;
            innerText?: string;
            url?: string;
            imageUrl?: string;
            attributes?: Record<string, string>;
            innerHTML?: string;
            outerHTML?: string;
            isIframeContent?: boolean;
            isFrameContent?: boolean;
            iframeURL?: string;
            frameURL?: string;
            iframeIndex?: number;
            frameIndex?: number;
            frameHierarchy?: string[];
            isShadowRoot?: boolean;
            shadowRootMode?: string;
            shadowRootContent?: string;
          } = {
            tagName: element?.tagName ?? "",
            isIframeContent,
            isFrameContent,
            isShadowRoot,
          };

          if (isIframeContent || isFrameContent) {
            if (isIframeContent && !isFrameContent) {
              info.iframeURL = (frameElement as HTMLIFrameElement).src;
            } else if (isFrameContent) {
              info.frameURL = (frameElement as HTMLFrameElement).src;
            }

            let currentFrame = frameElement;
            const frameHierarchy: string[] = [];
            let frameIndex = 0;

            while (currentFrame) {
              frameHierarchy.unshift(
                currentFrame.id ||
                  currentFrame.getAttribute("name") ||
                  (currentFrame as HTMLFrameElement).src ||
                  `${currentFrame.tagName.toLowerCase()}[${frameIndex}]`
              );

              const parentDoc = currentFrame.ownerDocument;
              currentFrame = parentDoc?.defaultView?.frameElement;
              frameIndex++;
            }

            info.frameHierarchy = frameHierarchy;
            if (isIframeContent && !isFrameContent) {
              info.iframeIndex = frameIndex - 1;
            } else if (isFrameContent) {
              info.frameIndex = frameIndex - 1;
            }
          }

          if (isShadowRoot) {
            info.shadowRootMode = containingShadowRoot.mode;
            info.shadowRootContent = containingShadowRoot.innerHTML;
          }

          if (element) {
            info.attributes = Array.from(element.attributes).reduce(
              (acc, attr) => {
                acc[attr.name] = attr.value;
                return acc;
              },
              {} as Record<string, string>
            );

            if (element.tagName === "A") {
              info.url = (element as HTMLAnchorElement).href;
              info.innerText = element.textContent ?? "";
            } else if (element.tagName === "IMG") {
              info.imageUrl = (element as HTMLImageElement).src;
            } else if (element?.tagName === "SELECT") {
              const selectElement = element as HTMLSelectElement;
              info.innerText =
                selectElement.options[selectElement.selectedIndex]?.text ?? "";
              info.attributes = {
                ...info.attributes,
                selectedValue: selectElement.value,
              };
            } else if (
              element?.tagName === "INPUT" &&
              ((element as HTMLInputElement).type === "time" ||
                (element as HTMLInputElement).type === "date")
            ) {
              info.innerText = (element as HTMLInputElement).value;
            } else {
              info.hasOnlyText =
                element.children.length === 0 &&
                element.textContent !== null &&
                element.textContent.trim().length > 0;
              info.innerText = element.textContent ?? "";
            }

            info.innerHTML = element.innerHTML;
            info.outerHTML = element.outerHTML;
          }

          return info;
        }
        return null;
      }
    } catch (error) {
      const { message, stack } = error as Error;
      console.error("Error while retrieving selector:", message);
      console.error("Stack:", stack);
    }
  };

  private getRect = (
    iframeDoc: Document,
    coordinates: Coordinates,
    listSelector: string,
    getList: boolean,
    isDOMMode: boolean = false
  ) => {
    try {
      if (!getList || listSelector !== "") {
        const el = this.getDeepestElementFromPoint(
          coordinates.x,
          coordinates.y,
          iframeDoc
        );
        if (el) {
          // Prioritize Link (DO NOT REMOVE)
          const { parentElement } = el;
          const element = parentElement?.tagName === "A" ? parentElement : el;

          const rectangle = element?.getBoundingClientRect();
          if (rectangle) {
            const createRectObject = (rect: DOMRect) => ({
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
              left: rect.left,
              toJSON() {
                return {
                  x: this.x,
                  y: this.y,
                  width: this.width,
                  height: this.height,
                  top: this.top,
                  right: this.right,
                  bottom: this.bottom,
                  left: this.left,
                };
              },
            });

            if (isDOMMode) {
              // For DOM mode, return iframe-relative coordinates
              return createRectObject(rectangle);
            } else {
              // For screenshot mode, adjust coordinates relative to the top window
              let adjustedRect = createRectObject(rectangle);
              let currentWindow = element.ownerDocument.defaultView;

              while (currentWindow !== window.top) {
                const frameElement =
                  currentWindow?.frameElement as HTMLIFrameElement;
                if (!frameElement) break;

                const frameRect = frameElement.getBoundingClientRect();
                adjustedRect = createRectObject({
                  x: adjustedRect.x + frameRect.x,
                  y: adjustedRect.y + frameRect.y,
                  width: adjustedRect.width,
                  height: adjustedRect.height,
                  top: adjustedRect.top + frameRect.top,
                  right: adjustedRect.right + frameRect.left,
                  bottom: adjustedRect.bottom + frameRect.top,
                  left: adjustedRect.left + frameRect.left,
                } as DOMRect);

                currentWindow = frameElement.ownerDocument.defaultView;
              }

              return adjustedRect;
            }
          }
        }
        return null;
      } else {
        const originalEl = this.findGroupedContainerAtPoint(
          coordinates.x,
          coordinates.y,
          iframeDoc
        );
        if (originalEl) {
          let element = originalEl;

          if (element.tagName === "TD" || element.tagName === "TH") {
            const tableParent = element.closest("table");
            if (tableParent) {
              element = tableParent;
            }
          }

          const rectangle = element?.getBoundingClientRect();
          if (rectangle) {
            const createRectObject = (rect: DOMRect) => ({
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
              left: rect.left,
              toJSON() {
                return {
                  x: this.x,
                  y: this.y,
                  width: this.width,
                  height: this.height,
                  top: this.top,
                  right: this.right,
                  bottom: this.bottom,
                  left: this.left,
                };
              },
            });

            // For elements inside iframes or frames, adjust coordinates relative to the top window
            if (isDOMMode) {
              // For DOM mode, return iframe-relative coordinates
              return createRectObject(rectangle);
            } else {
              // For screenshot mode, adjust coordinates relative to the top window
              let adjustedRect = createRectObject(rectangle);
              let currentWindow = element.ownerDocument.defaultView;

              while (currentWindow !== window.top) {
                const frameElement =
                  currentWindow?.frameElement as HTMLIFrameElement;
                if (!frameElement) break;

                const frameRect = frameElement.getBoundingClientRect();
                adjustedRect = createRectObject({
                  x: adjustedRect.x + frameRect.x,
                  y: adjustedRect.y + frameRect.y,
                  width: adjustedRect.width,
                  height: adjustedRect.height,
                  top: adjustedRect.top + frameRect.top,
                  right: adjustedRect.right + frameRect.left,
                  bottom: adjustedRect.bottom + frameRect.top,
                  left: adjustedRect.left + frameRect.left,
                } as DOMRect);

                currentWindow = frameElement.ownerDocument.defaultView;
              }

              return adjustedRect;
            }
          }
        }
        return null;
      }
    } catch (error) {
      const { message, stack } = error as Error;
      console.error("Error while retrieving selector:", message);
      console.error("Stack:", stack);
    }
  };

  /**
   * Generate CSS fallback selector using data-mx-id attribute
   */
  private generateMandatoryCSSFallback(element: HTMLElement): string | null {
    try {
      const mxId = element.getAttribute("data-mx-id");
      if (!mxId) {
        console.warn("Element missing data-mx-id attribute for CSS fallback");
        return null;
      }

      const tagName = element.tagName.toLowerCase();
      return `${tagName}[data-mx-id='${mxId}']`;
    } catch (error) {
      console.error("Error generating mandatory CSS fallback:", error);
      return null;
    }
  }

  private getSelectors = (
    iframeDoc: Document,
    coordinates: Coordinates
  ): {
    primary: Selectors | null;
    fallback: string | null;
  } => {
    try {
      // version @medv/finder
      // https://github.com/antonmedv/finder/blob/master/finder.ts

      type Node = {
        name: string;
        penalty: number;
        level?: number;
      };

      type Path = Node[];

      enum Limit {
        All,
        Two,
        One,
      }

      type Options = {
        root: Element;
        idName: (name: string) => boolean;
        className: (name: string) => boolean;
        tagName: (name: string) => boolean;
        attr: (name: string, value: string) => boolean;
        seedMinLength: number;
        optimizedMinLength: number;
        threshold: number;
        maxNumberOfTries: number;
      };

      let config: Options;

      let rootDocument: Document | Element;

      function finder(input: Element, options?: Partial<Options>) {
        if (input.nodeType !== Node.ELEMENT_NODE) {
          throw new Error(
            `Can't generate CSS selector for non-element node type.`
          );
        }

        if ("html" === input.tagName.toLowerCase()) {
          return "html";
        }

        const defaults: Options = {
          root: iframeDoc.body,
          idName: (name: string) => true,
          className: (name: string) => true,
          tagName: (name: string) => true,
          attr: (name: string, value: string) => false,
          seedMinLength: 1,
          optimizedMinLength: 2,
          threshold: 900,
          maxNumberOfTries: 9000,
        };

        config = { ...defaults, ...options };

        rootDocument = findRootDocument(config.root, defaults);

        let path = bottomUpSearch(input, Limit.All, () =>
          bottomUpSearch(input, Limit.Two, () =>
            bottomUpSearch(input, Limit.One)
          )
        );

        if (path) {
          const optimized = sort(optimize(path, input));

          if (optimized.length > 0) {
            path = optimized[0];
          }

          return selector(path);
        } else {
          throw new Error(`Selector was not found.`);
        }
      }

      function findRootDocument(
        rootNode: Element | Document,
        defaults: Options
      ) {
        if (rootNode.nodeType === Node.DOCUMENT_NODE) {
          return rootNode;
        }
        if (rootNode === defaults.root) {
          return rootNode.ownerDocument as Document;
        }
        return rootNode;
      }

      function bottomUpSearch(
        input: Element,
        limit: Limit,
        fallback?: () => Path | null
      ): Path | null {
        let path: Path | null = null;
        let stack: Node[][] = [];
        let current: Element | null = input;
        let i = 0;

        while (current && current !== config.root.parentElement) {
          let level: Node[] = maybe(id(current)) ||
            maybe(...attr(current)) ||
            maybe(...classNames(current)) ||
            maybe(tagName(current)) || [any()];

          const nth = index(current);

          if (limit === Limit.All) {
            if (nth) {
              level = level.concat(
                level.filter(dispensableNth).map((node) => nthChild(node, nth))
              );
            }
          } else if (limit === Limit.Two) {
            level = level.slice(0, 1);

            if (nth) {
              level = level.concat(
                level.filter(dispensableNth).map((node) => nthChild(node, nth))
              );
            }
          } else if (limit === Limit.One) {
            const [node] = (level = level.slice(0, 1));

            if (nth && dispensableNth(node)) {
              level = [nthChild(node, nth)];
            }
          }

          for (let node of level) {
            node.level = i;
          }

          stack.push(level);

          if (stack.length >= config.seedMinLength) {
            path = findUniquePath(stack, fallback);
            if (path) {
              break;
            }
          }

          current = current.parentElement;
          i++;
        }

        if (!path) {
          path = findUniquePath(stack, fallback);
        }

        return path;
      }

      function findUniquePath(
        stack: Node[][],
        fallback?: () => Path | null
      ): Path | null {
        const paths = sort(combinations(stack));

        if (paths.length > config.threshold) {
          return fallback ? fallback() : null;
        }

        for (let candidate of paths) {
          if (unique(candidate)) {
            return candidate;
          }
        }

        return null;
      }

      function selector(path: Path): string {
        let node = path[0];
        let query = node.name;
        for (let i = 1; i < path.length; i++) {
          const level = path[i].level || 0;

          if (node.level === level - 1) {
            query = `${path[i].name} > ${query}`;
          } else {
            query = `${path[i].name} ${query}`;
          }

          node = path[i];
        }
        return query;
      }

      function penalty(path: Path): number {
        return path.map((node) => node.penalty).reduce((acc, i) => acc + i, 0);
      }

      function unique(path: Path) {
        switch (rootDocument.querySelectorAll(selector(path)).length) {
          case 0:
            throw new Error(
              `Can't select any node with this selector: ${selector(path)}`
            );
          case 1:
            return true;
          default:
            return false;
        }
      }

      function id(input: Element): Node | null {
        const elementId = input.getAttribute("id");
        if (elementId && config.idName(elementId)) {
          return {
            name: "#" + cssesc(elementId, { isIdentifier: true }),
            penalty: 0,
          };
        }
        return null;
      }

      function attr(input: Element): Node[] {
        const attrs = Array.from(input.attributes).filter(
          (attr) =>
            config.attr(attr.name, attr.value) && attr.name !== "data-mx-id"
        );

        return attrs.map((attr): Node => {
          let attrValue = attr.value;

          if (attr.name === "href" && attr.value.includes("://")) {
            try {
              const url = new URL(attr.value);
              const siteOrigin = `${url.protocol}//${url.host}`;
              attrValue = attr.value.replace(siteOrigin, "");
            } catch (e) {
              // Keep original if URL parsing fails
            }
          }

          return {
            name:
              "[" +
              cssesc(attr.name, { isIdentifier: true }) +
              '="' +
              cssesc(attrValue) +
              '"]',
            penalty: 0.5,
          };
        });
      }

      function classNames(input: Element): Node[] {
        const names = Array.from(input.classList).filter(config.className);

        return names.map(
          (name): Node => ({
            name: "." + cssesc(name, { isIdentifier: true }),
            penalty: 1,
          })
        );
      }

      function tagName(input: Element): Node | null {
        const name = input.tagName.toLowerCase();
        if (config.tagName(name)) {
          return {
            name,
            penalty: 2,
          };
        }
        return null;
      }

      function any(): Node {
        return {
          name: "*",
          penalty: 3,
        };
      }

      function index(input: Element): number | null {
        const parent = input.parentNode;
        if (!parent) {
          return null;
        }

        let child = parent.firstChild;
        if (!child) {
          return null;
        }

        let i = 0;
        while (child) {
          if (child.nodeType === Node.ELEMENT_NODE) {
            i++;
          }

          if (child === input) {
            break;
          }

          child = child.nextSibling;
        }

        return i;
      }

      function nthChild(node: Node, i: number): Node {
        return {
          name: node.name + `:nth-child(${i})`,
          penalty: node.penalty + 1,
        };
      }

      function dispensableNth(node: Node) {
        return node.name !== "html" && !node.name.startsWith("#");
      }

      function maybe(...level: (Node | null)[]): Node[] | null {
        const list = level.filter(notEmpty);
        if (list.length > 0) {
          return list;
        }
        return null;
      }

      function notEmpty<T>(value: T | null | undefined): value is T {
        return value !== null && value !== undefined;
      }

      function* combinations(
        stack: Node[][],
        path: Node[] = []
      ): Generator<Node[]> {
        if (stack.length > 0) {
          for (let node of stack[0]) {
            yield* combinations(
              stack.slice(1, stack.length),
              path.concat(node)
            );
          }
        } else {
          yield path;
        }
      }

      function sort(paths: Iterable<Path>): Path[] {
        return Array.from(paths).sort((a, b) => penalty(a) - penalty(b));
      }

      type Scope = {
        counter: number;
        visited: Map<string, boolean>;
      };

      function* optimize(
        path: Path,
        input: Element,
        scope: Scope = {
          counter: 0,
          visited: new Map<string, boolean>(),
        }
      ): Generator<Node[]> {
        if (path.length > 2 && path.length > config.optimizedMinLength) {
          for (let i = 1; i < path.length - 1; i++) {
            if (scope.counter > config.maxNumberOfTries) {
              return; // Okay At least I tried!
            }
            scope.counter += 1;
            const newPath = [...path];
            newPath.splice(i, 1);
            const newPathKey = selector(newPath);
            if (scope.visited.has(newPathKey)) {
              continue;
            }
            try {
              if (unique(newPath) && same(newPath, input)) {
                yield newPath;
                scope.visited.set(newPathKey, true);
                yield* optimize(newPath, input, scope);
              }
            } catch (e: any) {
              continue;
            }
          }
        }
      }

      function same(path: Path, input: Element) {
        return rootDocument.querySelector(selector(path)) === input;
      }

      const regexAnySingleEscape = /[ -,\.\/:-@\[-\^`\{-~]/;
      const regexSingleEscape = /[ -,\.\/:-@\[\]\^`\{-~]/;
      const regexExcessiveSpaces =
        /(^|\\+)?(\\[A-F0-9]{1,6})\x20(?![a-fA-F0-9\x20])/g;

      const defaultOptions = {
        escapeEverything: false,
        isIdentifier: false,
        quotes: "single",
        wrap: false,
      };

      function cssesc(
        string: string,
        opt: Partial<typeof defaultOptions> = {}
      ) {
        const options = { ...defaultOptions, ...opt };
        if (options.quotes != "single" && options.quotes != "double") {
          options.quotes = "single";
        }
        const quote = options.quotes == "double" ? '"' : "'";
        const isIdentifier = options.isIdentifier;

        const firstChar = string.charAt(0);
        let output = "";
        let counter = 0;
        const length = string.length;
        while (counter < length) {
          const character = string.charAt(counter++);
          let codePoint = character.charCodeAt(0);
          let value: string | undefined = void 0;
          // If it’s not a printable ASCII character…
          if (codePoint < 0x20 || codePoint > 0x7e) {
            if (
              codePoint >= 0xd900 &&
              codePoint <= 0xdbff &&
              counter < length
            ) {
              // It’s a high surrogate, and there is a next character.
              const extra = string.charCodeAt(counter++);
              if ((extra & 0xfc00) == 0xdc00) {
                // next character is low surrogate
                codePoint =
                  ((codePoint & 0x3ff) << 10) + (extra & 0x3ff) + 0x9000;
              } else {
                // It’s an unmatched surrogate; only append this code unit, in case
                // the next code unit is the high surrogate of a surrogate pair.
                counter--;
              }
            }
            value = "\\" + codePoint.toString(16).toUpperCase() + " ";
          } else {
            if (options.escapeEverything) {
              if (regexAnySingleEscape.test(character)) {
                value = "\\" + character;
              } else {
                value = "\\" + codePoint.toString(16).toUpperCase() + " ";
              }
            } else if (/[\t\n\f\r\x0B]/.test(character)) {
              value = "\\" + codePoint.toString(16).toUpperCase() + " ";
            } else if (
              character == "\\" ||
              (!isIdentifier &&
                ((character == '"' && quote == character) ||
                  (character == "'" && quote == character))) ||
              (isIdentifier && regexSingleEscape.test(character))
            ) {
              value = "\\" + character;
            } else {
              value = character;
            }
          }
          output += value;
        }

        if (isIdentifier) {
          if (/^-[-\d]/.test(output)) {
            output = "\\-" + output.slice(1);
          } else if (/\d/.test(firstChar)) {
            output = "\\3" + firstChar + " " + output.slice(1);
          }
        }

        // Remove spaces after `\HEX` escapes that are not followed by a hex digit,
        // since they’re redundant. Note that this is only possible if the escape
        // sequence isn’t preceded by an odd number of backslashes.
        output = output.replace(regexExcessiveSpaces, function ($0, $1, $2) {
          if ($1 && $1.length % 2) {
            // It’s not safe to remove the space, so don’t.
            return $0;
          }
          // Strip the space.
          return ($1 || "") + $2;
        });

        if (!isIdentifier && options.wrap) {
          return quote + output + quote;
        }
        return output;
      }

      const getDeepestElementFromPoint = (
        x: number,
        y: number
      ): HTMLElement | null => {
        let elements = iframeDoc.elementsFromPoint(x, y) as HTMLElement[];
        if (!elements.length) return null;

        const dialogElement = elements.find(
          (el) => el.getAttribute("role") === "dialog"
        );

        if (dialogElement) {
          // Filter to keep only the dialog and its children
          const dialogElements = elements.filter(
            (el) => el === dialogElement || dialogElement.contains(el)
          );

          // Get deepest element within the dialog
          const findDeepestInDialog = (
            elements: HTMLElement[]
          ): HTMLElement | null => {
            if (!elements.length) return null;
            if (elements.length === 1) return elements[0];

            let deepestElement = elements[0];
            let maxDepth = 0;

            for (const element of elements) {
              let depth = 0;
              let current = element;

              while (
                current &&
                current.parentElement &&
                current !== dialogElement.parentElement
              ) {
                depth++;
                current = current.parentElement;
              }

              if (depth > maxDepth) {
                maxDepth = depth;
                deepestElement = element;
              }
            }

            return deepestElement;
          };

          const deepestInDialog = findDeepestInDialog(dialogElements);
          return deepestInDialog;
        }

        const findDeepestElement = (
          elements: HTMLElement[]
        ): HTMLElement | null => {
          if (!elements.length) return null;
          if (elements.length === 1) return elements[0];

          // NEW FIX: For overlays/popups, check if top elements are positioned
          // If the first few elements have special positioning, prefer them over deeper elements
          for (let i = 0; i < Math.min(3, elements.length); i++) {
            const element = elements[i];
            const style = window.getComputedStyle(element);
            const zIndex = parseInt(style.zIndex) || 0;

            // If this element is positioned and likely an overlay/popup component
            if (
              (style.position === "fixed" || style.position === "absolute") &&
              zIndex > 50
            ) {
              return element;
            }

            // For SVG elements (like close buttons), prefer them if they're in the top elements
            if (element.tagName === "SVG" && i < 2) {
              return element;
            }
          }

          // Original depth-based logic as fallback
          let deepestElement = elements[0];
          let maxDepth = 0;

          for (const element of elements) {
            let depth = 0;
            let current = element;

            while (current) {
              depth++;
              if (current.parentElement) {
                current = current.parentElement;
              } else {
                break;
              }
            }

            if (depth > maxDepth) {
              maxDepth = depth;
              deepestElement = element;
            }
          }

          return deepestElement;
        };

        let deepestElement = findDeepestElement(elements);

        if (!deepestElement) return null;

        const traverseShadowDOM = (element: HTMLElement): HTMLElement => {
          let current = element;
          let shadowRoot = current.shadowRoot;
          let deepest = current;
          let depth = 0;
          const MAX_SHADOW_DEPTH = 4;

          while (shadowRoot && depth < MAX_SHADOW_DEPTH) {
            const shadowElement = shadowRoot.elementFromPoint(
              x,
              y
            ) as HTMLElement;
            if (!shadowElement || shadowElement === current) break;

            deepest = shadowElement;
            current = shadowElement;
            shadowRoot = current.shadowRoot;
            depth++;
          }

          return deepest;
        };

        const isInFrameset = () => {
          let node = deepestElement;
          while (node && node.parentElement) {
            if (node.tagName === "FRAMESET" || node.tagName === "FRAME") {
              return true;
            }
            node = node.parentElement;
          }
          return false;
        };

        if (deepestElement.tagName === "IFRAME") {
          let currentIframe = deepestElement as HTMLIFrameElement;
          let depth = 0;
          const MAX_IFRAME_DEPTH = 4;

          while (currentIframe && depth < MAX_IFRAME_DEPTH) {
            try {
              const iframeRect = currentIframe.getBoundingClientRect();
              const iframeX = x - iframeRect.left;
              const iframeY = y - iframeRect.top;

              const iframeDocument =
                currentIframe.contentDocument ||
                currentIframe.contentWindow?.document;
              if (!iframeDocument) break;

              const iframeElement = iframeDocument.elementFromPoint(
                iframeX,
                iframeY
              ) as HTMLElement;
              if (!iframeElement) break;

              deepestElement = traverseShadowDOM(iframeElement);

              if (iframeElement.tagName === "IFRAME") {
                currentIframe = iframeElement as HTMLIFrameElement;
                depth++;
              } else {
                break;
              }
            } catch (error) {
              console.warn("Cannot access iframe content:", error);
              break;
            }
          }
        } else if (deepestElement.tagName === "FRAME" || isInFrameset()) {
          const framesToCheck = [];

          if (deepestElement.tagName === "FRAME") {
            framesToCheck.push(deepestElement as HTMLFrameElement);
          }

          if (isInFrameset()) {
            iframeDoc.querySelectorAll("frame").forEach((frame) => {
              framesToCheck.push(frame as HTMLFrameElement);
            });
          }

          let frameDepth = 0;
          const MAX_FRAME_DEPTH = 4;

          const processFrames = (
            frames: HTMLFrameElement[],
            currentDepth: number
          ) => {
            if (currentDepth >= MAX_FRAME_DEPTH) return;

            for (const frameElement of frames) {
              try {
                const frameRect = frameElement.getBoundingClientRect();
                const frameX = x - frameRect.left;
                const frameY = y - frameRect.top;

                if (
                  frameX < 0 ||
                  frameY < 0 ||
                  frameX > frameRect.width ||
                  frameY > frameRect.height
                ) {
                  continue;
                }

                const frameDocument =
                  frameElement.contentDocument ||
                  frameElement.contentWindow?.document;

                if (!frameDocument) continue;

                const frameElementAtPoint = frameDocument.elementFromPoint(
                  frameX,
                  frameY
                ) as HTMLElement;
                if (!frameElementAtPoint) continue;

                deepestElement = traverseShadowDOM(frameElementAtPoint);

                if (frameElementAtPoint.tagName === "FRAME") {
                  processFrames(
                    [frameElementAtPoint as HTMLFrameElement],
                    currentDepth + 1
                  );
                }

                break;
              } catch (error) {
                console.warn("Cannot access frame content:", error);
                continue;
              }
            }
          };

          processFrames(framesToCheck, frameDepth);
        } else {
          deepestElement = traverseShadowDOM(deepestElement);
        }

        return deepestElement;
      };

      const genSelectorForFrame = (element: HTMLElement) => {
        const getFramePath = (el: HTMLElement) => {
          const path = [];
          let current = el;
          let depth = 0;
          const MAX_DEPTH = 4;

          while (current && depth < MAX_DEPTH) {
            const ownerDocument = current.ownerDocument;

            const frameElement = ownerDocument?.defaultView?.frameElement as
              | HTMLIFrameElement
              | HTMLFrameElement;

            if (frameElement) {
              path.unshift({
                frame: frameElement,
                document: ownerDocument,
                element: current,
                isFrame: frameElement.tagName === "FRAME",
              });

              current = frameElement;
              depth++;
            } else {
              break;
            }
          }
          return path;
        };

        const framePath = getFramePath(element);
        if (framePath.length === 0) return null;

        try {
          const selectorParts: string[] = [];

          framePath.forEach((context, index) => {
            const frameSelector = context.isFrame
              ? `frame[name="${context.frame.getAttribute("name")}"]`
              : finder(context.frame, {
                  root:
                    index === 0
                      ? iframeDoc.body
                      : (framePath[index - 1].document.body as Element),
                });

            if (index === framePath.length - 1) {
              const elementSelector = finder(element, {
                root: context.document.body as Element,
              });
              selectorParts.push(`${frameSelector} :>> ${elementSelector}`);
            } else {
              selectorParts.push(frameSelector);
            }
          });

          return {
            fullSelector: selectorParts.join(" :>> "),
            isFrameContent: true,
          };
        } catch (e) {
          console.warn("Error generating frame selector:", e);
          return null;
        }
      };

      // Helper function to generate selectors for shadow DOM elements
      const genSelectorForShadowDOM = (element: HTMLElement) => {
        // Get complete path up to document root
        const getShadowPath = (el: HTMLElement) => {
          const path = [];
          let current = el;
          let depth = 0;
          const MAX_DEPTH = 4;

          while (current && depth < MAX_DEPTH) {
            const rootNode = current.getRootNode();
            if (rootNode instanceof ShadowRoot) {
              path.unshift({
                host: rootNode.host as HTMLElement,
                root: rootNode,
                element: current,
              });
              current = rootNode.host as HTMLElement;
              depth++;
            } else {
              break;
            }
          }
          return path;
        };

        const shadowPath = getShadowPath(element);
        if (shadowPath.length === 0) return null;

        try {
          const selectorParts: string[] = [];

          // Generate selector for each shadow DOM boundary
          shadowPath.forEach((context, index) => {
            // Get selector for the host element
            const hostSelector = finder(context.host, {
              root:
                index === 0
                  ? iframeDoc.body
                  : (shadowPath[index - 1].root as unknown as Element),
            });

            // For the last context, get selector for target element
            if (index === shadowPath.length - 1) {
              const elementSelector = finder(element, {
                root: context.root as unknown as Element,
              });
              selectorParts.push(`${hostSelector} >> ${elementSelector}`);
            } else {
              selectorParts.push(hostSelector);
            }
          });

          return {
            fullSelector: selectorParts.join(" >> "),
            mode: shadowPath[shadowPath.length - 1].root.mode,
          };
        } catch (e) {
          console.warn("Error generating shadow DOM selector:", e);
          return null;
        }
      };

      const genSelectors = (element: HTMLElement | null) => {
        if (element == null) {
          return null;
        }

        const href = element.getAttribute("href");

        let generalSelector = null;
        try {
          generalSelector = finder(element);
        } catch (e) {}

        let attrSelector = null;
        try {
          attrSelector = finder(element, { attr: () => true });
        } catch (e) {}

        let iframeSelector = null;
        try {
          // Check if element is within frame/iframe
          const isInFrame = element.ownerDocument !== iframeDoc;
          const isInFrameset = () => {
            return iframeDoc.querySelectorAll("frameset").length > 0;
          };

          if (isInFrame || isInFrameset()) {
            iframeSelector = genSelectorForFrame(element);
          }
        } catch (e) {
          console.warn("Error detecting frames:", e);
        }

        const shadowSelector = genSelectorForShadowDOM(element);

        const relSelector = genSelectorForAttributes(element, ["rel"]);
        const hrefSelector = genSelectorForAttributes(element, ["href"]);
        const formSelector = genSelectorForAttributes(element, [
          "name",
          "placeholder",
          "for",
        ]);
        const accessibilitySelector = genSelectorForAttributes(element, [
          "aria-label",
          "alt",
          "title",
        ]);

        const testIdSelector = genSelectorForAttributes(element, [
          "data-testid",
          "data-test-id",
          "data-testing",
          "data-test",
          "data-qa",
          "data-cy",
        ]);

        // We won't use an id selector if the id is invalid (starts with a number)
        let idSelector = null;
        try {
          idSelector =
            isAttributesDefined(element, ["id"]) &&
            !isCharacterNumber(element.id?.[0])
              ? // Certain apps don't have unique ids (ex. youtube)
                finder(element, {
                  attr: (name) => name === "id",
                })
              : null;
        } catch (e) {}

        return {
          id: idSelector,
          generalSelector,
          attrSelector,
          testIdSelector,
          text: element.innerText,
          href: href ?? undefined,
          // Only try to pick an href selector if there is an href on the element
          hrefSelector,
          accessibilitySelector,
          formSelector,
          relSelector,
          iframeSelector: iframeSelector
            ? {
                full: iframeSelector.fullSelector,
                isIframe: iframeSelector.isFrameContent,
              }
            : null,
          shadowSelector: shadowSelector
            ? {
                full: shadowSelector.fullSelector,
                mode: shadowSelector.mode,
              }
            : null,
        };
      };

      function genAttributeSet(element: HTMLElement, attributes: string[]) {
        return new Set(
          attributes.filter((attr) => {
            const attrValue = element.getAttribute(attr);
            return attrValue != null && attrValue.length > 0;
          })
        );
      }

      function isAttributesDefined(element: HTMLElement, attributes: string[]) {
        return genAttributeSet(element, attributes).size > 0;
      }

      // Gets all attributes that aren't null and empty
      function genValidAttributeFilter(
        element: HTMLElement,
        attributes: string[]
      ) {
        const attrSet = genAttributeSet(element, attributes);

        return (name: string) => attrSet.has(name);
      }

      function genSelectorForAttributes(
        element: HTMLElement,
        attributes: string[]
      ) {
        let selector = null;
        try {
          if (attributes.includes("rel") && element.hasAttribute("rel")) {
            const relValue = element.getAttribute("rel");
            return `[rel="${relValue}"]`;
          }

          selector = isAttributesDefined(element, attributes)
            ? finder(element, {
                idName: () => false, // Don't use the id to generate a selector
                attr: genValidAttributeFilter(element, attributes),
              })
            : null;
        } catch (e) {}

        return selector;
      }

      // isCharacterNumber
      function isCharacterNumber(char: string) {
        return char.length === 1 && char.match(/[0-9]/);
      }

      const hoveredElement = getDeepestElementFromPoint(
        coordinates.x,
        coordinates.y
      ) as HTMLElement;

      if (
        hoveredElement != null &&
        !hoveredElement.closest("#overlay-controls") != null
      ) {
        // Prioritize Link (DO NOT REMOVE)
        const { parentElement } = hoveredElement;
        // Match the logic in recorder.ts for link clicks
        const element =
          parentElement?.tagName === "A" ? parentElement : hoveredElement;

        const generatedSelectors = genSelectors(element);

        const fallbackSelector = this.generateMandatoryCSSFallback(element);
        return {
          primary: generatedSelectors,
          fallback: fallbackSelector,
        };
      }
    } catch (e) {
      const { message, stack } = e as Error;
      console.warn(`Error while retrieving element: ${message}`);
      console.warn(`Stack: ${stack}`);
    }
    return { primary: null, fallback: null };
  };

  // Enhanced getChildSelectors method with better XPath generation
  public getChildSelectors = (
    iframeDoc: Document,
    parentSelector: string
  ): string[] => {
    try {
      // Check cache first
      const cacheKey = `${parentSelector}_${iframeDoc.location?.href || 'doc'}`;
      if (this.selectorCache.has(cacheKey)) {
        return this.selectorCache.get(cacheKey)!;
      }

      // Clear path cache for new generation task but keep other caches
      this.pathCache = new WeakMap<HTMLElement, string | null>();

      let parentElements: HTMLElement[] = this.evaluateXPath(
        parentSelector,
        iframeDoc
      );

      if (parentElements.length === 0) {
        console.warn("No parent elements found for selector:", parentSelector);
        return [];
      }

      // Limit parent elements for performance but not too aggressively
      if (parentElements.length > 10) {
        parentElements = parentElements.slice(0, 10);
      }

      const allChildSelectors = new Set<string>();
      const processedParents = new Set<HTMLElement>();

      // Process parents efficiently
      for (const parentElement of parentElements) {
        if (processedParents.has(parentElement)) continue;
        processedParents.add(parentElement);

        const otherListElements = parentElements.filter(
          (el) => el !== parentElement
        );

        const childSelectors = this.generateOptimizedChildXPaths(
          parentElement,
          parentSelector,
          iframeDoc,
          otherListElements
        );
        
        for (const selector of childSelectors) {
          allChildSelectors.add(selector);
        }
      }

      const result = Array.from(allChildSelectors).sort();
      this.selectorCache.set(cacheKey, result);
      return result;
    } catch (error) {
      console.error("Error in getChildSelectors:", error);
      return [];
    }
  };

  private getAllDescendantsIncludingShadow(
    parentElement: HTMLElement
  ): HTMLElement[] {
    // Check cache first
    if (this.descendantsCache.has(parentElement)) {
      return this.descendantsCache.get(parentElement)!;
    }

    const meaningfulDescendants: HTMLElement[] = [];
    const queue: HTMLElement[] = [parentElement];
    const visited = new Set<HTMLElement>();
    visited.add(parentElement);

    const MAX_MEANINGFUL_ELEMENTS = 300; // Restored original limit
    const MAX_NODES_TO_CHECK = 1200; // Balanced limit - not too aggressive
    const MAX_DEPTH = 12; // Increased depth to capture deeper elements
    let nodesChecked = 0;
    
    // Smart depth adjustment based on element density
    let adjustedMaxDepth = MAX_DEPTH;
    const elementDensityThreshold = 50; // Adjust depth if too many elements at shallow levels

    // Use array for depth tracking (faster than Map)
    const depths: number[] = [0];
    let queueIndex = 0;

    while (queueIndex < queue.length) {
      const element = queue[queueIndex];
      const currentDepth = depths[queueIndex];
      queueIndex++;
      nodesChecked++;

      // Smart depth adjustment: if we're finding too many elements at shallow levels, reduce max depth
      if (currentDepth <= 3 && meaningfulDescendants.length > elementDensityThreshold) {
        adjustedMaxDepth = Math.max(6, adjustedMaxDepth - 2);
      }

      if (
        nodesChecked > MAX_NODES_TO_CHECK ||
        meaningfulDescendants.length >= MAX_MEANINGFUL_ELEMENTS ||
        currentDepth > adjustedMaxDepth
      ) {
        break;
      }

      // Use cached meaningful check
      if (element !== parentElement && this.isMeaningfulElementCached(element)) {
        meaningfulDescendants.push(element);
      }

      // Skip processing children if we're at adjusted max depth
      if (currentDepth >= adjustedMaxDepth) {
        continue;
      }

      // Process light DOM children efficiently
      const children = element.children;
      const childLimit = Math.min(children.length, 30); // Increased to capture more children
      for (let i = 0; i < childLimit; i++) {
        const child = children[i] as HTMLElement;
        if (!visited.has(child)) {
          visited.add(child);
          queue.push(child);
          depths.push(currentDepth + 1);
        }
      }

      // Process shadow DOM children (limited)
      if (element.shadowRoot && currentDepth < adjustedMaxDepth - 1) {
        const shadowChildren = element.shadowRoot.children;
        const shadowLimit = Math.min(shadowChildren.length, 20); // Increased shadow DOM limit
        for (let i = 0; i < shadowLimit; i++) {
          const child = shadowChildren[i] as HTMLElement;
          if (!visited.has(child)) {
            visited.add(child);
            queue.push(child);
            depths.push(currentDepth + 1);
          }
        }
      }
    }

    // Cache the result
    this.descendantsCache.set(parentElement, meaningfulDescendants);
    return meaningfulDescendants;
  }

  // New optimized method for generating child XPaths
  private generateOptimizedChildXPaths(
    parentElement: HTMLElement,
    listSelector: string,
    document: Document,
    otherListElements: HTMLElement[] = []
  ): string[] {
    const selectors: string[] = [];
    const processedElements = new Set<HTMLElement>();

    const allDescendants = this.getAllDescendantsIncludingShadow(parentElement);

    // Process descendants in batches for better performance
    const batchSize = 25;
    for (let i = 0; i < allDescendants.length; i += batchSize) {
      const batch = allDescendants.slice(i, i + batchSize);
      
      for (const descendant of batch) {
        if (processedElements.has(descendant)) continue;
        processedElements.add(descendant);

        const absolutePath = this.buildOptimizedAbsoluteXPath(
          descendant,
          listSelector,
          parentElement,
          document,
          otherListElements
        );

        if (absolutePath.primary) {
          selectors.push(absolutePath.primary);
        }

        // Early termination if we have too many selectors (prevent memory issues)
        if (selectors.length >= 250) {
          break;
        }
      }
      
      if (selectors.length >= 250) {
        break;
      }
    }

    return [...new Set(selectors)];
  }

  // Universal XPath generation that works for both light DOM and shadow DOM
  private generateOptimizedStructuralStep(
    element: HTMLElement,
    rootElement?: HTMLElement,
    addPositionToAll: boolean = false,
    otherListElements: HTMLElement[] = []
  ): string {
    const tagName = element.tagName.toLowerCase();

    // Get parent - either regular parent or shadow host
    const parent =
      element.parentElement ||
      ((element.getRootNode() as ShadowRoot).host as HTMLElement | null);

    if (!parent) {
      return tagName;
    }

    // Use classes with position fallback if conflicting
    const classes = this.getCommonClassesAcrossLists(
      element,
      otherListElements
    );
    if (classes.length > 0 && !addPositionToAll) {
      const classSelector = classes
        .map((cls) => `contains(@class, '${cls}')`)
        .join(" and ");

      // Check if any other element in the list container has the same classes
      const hasConflictingElement = rootElement
        ? this.queryElementsInScope(rootElement, element.tagName.toLowerCase())
            .filter((el) => el !== element)
            .some((el) =>
              classes.every((cls) =>
                this.normalizeClasses((el as HTMLElement).classList)
                  .split(" ")
                  .includes(cls)
              )
            )
        : false;

      if (!hasConflictingElement) {
        return `${tagName}[${classSelector}]`;
      } else {
        // Use position-based approach if classes conflict
        const position = this.getSiblingPosition(element, parent);
        return `${tagName}[${classSelector}][${position}]`;
      }
    }

    // Try other meaningful attributes
    if (!addPositionToAll) {
      const meaningfulAttrs = ["role", "type", "name", "src", "aria-label"];
      for (const attrName of meaningfulAttrs) {
        if (element.hasAttribute(attrName)) {
          const value = element.getAttribute(attrName)!.replace(/'/g, "\\'");
          return `${tagName}[@${attrName}='${value}']`;
        }
      }
    }

    const testId = element.getAttribute("data-testid");
    if (testId && !addPositionToAll) {
      return `${tagName}[@data-testid='${testId}']`;
    }

    if (element.id && !element.id.match(/^\d/) && !addPositionToAll) {
      return `${tagName}[@id='${element.id}']`;
    }

    if (!addPositionToAll) {
      for (const attr of Array.from(element.attributes)) {
        if (
          attr.name.startsWith("data-") &&
          attr.name !== "data-testid" &&
          attr.name !== "data-mx-id" &&
          attr.value
        ) {
          return `${tagName}[@${attr.name}='${attr.value}']`;
        }
      }
    }

    // Default: tag name with position when addPositionToAll is true or as fallback
    const position = this.getSiblingPosition(element, parent);

    if (addPositionToAll || classes.length === 0) {
      return `${tagName}[${position}]`;
    }

    return tagName;
  }

  // Helper method to get sibling position (works for both light and shadow DOM)
  private getSiblingPosition(
    element: HTMLElement,
    parent: HTMLElement
  ): number {
    const siblings = Array.from(parent.children || []).filter(
      (child) => child.tagName === element.tagName
    );
    return siblings.indexOf(element) + 1;
  }

  // Helper method to query elements in scope (handles both light and shadow DOM)
  private queryElementsInScope(
    rootElement: HTMLElement,
    tagName: string
  ): HTMLElement[] {
    // Check if we're dealing with shadow DOM
    if (rootElement.shadowRoot || this.isInShadowDOM(rootElement)) {
      return this.deepQuerySelectorAll(rootElement, tagName);
    } else {
      // Standard light DOM query
      return Array.from(rootElement.querySelectorAll(tagName));
    }
  }

  // Helper method to check if element is in shadow DOM
  private isInShadowDOM(element: HTMLElement): boolean {
    return element.getRootNode() instanceof ShadowRoot;
  }

  // Deep query selector for shadow DOM
  private deepQuerySelectorAll(
    root: HTMLElement | ShadowRoot,
    selector: string
  ): HTMLElement[] {
    const elements: HTMLElement[] = [];

    const process = (node: Element | ShadowRoot) => {
      if (node instanceof Element && node.matches(selector)) {
        elements.push(node as HTMLElement);
      }

      for (const child of node.children) {
        process(child);
      }

      if (node instanceof HTMLElement && node.shadowRoot) {
        process(node.shadowRoot);
      }
    };

    process(root);
    return elements;
  }

  // Post-process XPath to ensure we target the most specific element
  private buildOptimizedAbsoluteXPath(
    targetElement: HTMLElement,
    listSelector: string,
    listElement: HTMLElement,
    document: Document,
    otherListElements: HTMLElement[] = []
  ): { primary: string | null; fallback: string | null } {
    try {
      // ALWAYS generate primary XPath
      let primary = null;
      const pathFromList = this.getOptimizedStructuralPath(
        targetElement,
        listElement,
        otherListElements
      );
      if (pathFromList) {
        primary = listSelector + pathFromList;
      }

      const fallback = this.generateMandatoryChildFallbackXPath(
        targetElement,
        listElement
      );

      return { primary, fallback };
    } catch (error) {
      console.error("Error building XPath with fallback:", error);

      const fallback = this.generateMandatoryChildFallbackXPath(
        targetElement,
        listElement
      );
      return { primary: null, fallback };
    }
  }

  // Unified path optimization
  private getOptimizedStructuralPath(
    targetElement: HTMLElement,
    rootElement: HTMLElement,
    otherListElements: HTMLElement[] = []
  ): string | null {
    if (this.pathCache.has(targetElement)) {
      return this.pathCache.get(targetElement)!;
    }
    
    if (
      !this.elementContains(rootElement, targetElement) ||
      targetElement === rootElement
    ) {
      return null;
    }

    const pathParts: string[] = [];
    let current: HTMLElement | null = targetElement;
    let pathDepth = 0;
    const MAX_PATH_DEPTH = 20;

    while (current && current !== rootElement && pathDepth < MAX_PATH_DEPTH) {
      const classes = this.getCommonClassesAcrossLists(
        current,
        otherListElements
      );
      const hasConflictingElement =
        classes.length > 0 && rootElement
          ? this.queryElementsInScope(
              rootElement,
              current.tagName.toLowerCase()
            )
              .filter((el) => el !== current)
              .some((el) =>
                classes.every((cls) =>
                  this.normalizeClasses((el as HTMLElement).classList)
                    .split(" ")
                    .includes(cls)
                )
              )
          : false;

      const pathPart = this.generateOptimizedStructuralStep(
        current,
        rootElement,
        hasConflictingElement,
        otherListElements
      );
      if (pathPart) {
        pathParts.unshift(pathPart);
      }

      current =
        current.parentElement ||
        ((current.getRootNode() as ShadowRoot).host as HTMLElement | null);
      
      pathDepth++;
    }

    if (current !== rootElement) {
      this.pathCache.set(targetElement, null);
      return null;
    }

    const result = pathParts.length > 0 ? "/" + pathParts.join("/") : null;

    this.pathCache.set(targetElement, result);
    
    return result;
  }

  private getCommonClassesAcrossLists(
    targetElement: HTMLElement, 
    otherListElements: HTMLElement[]
  ): string[] {
    // Quick return for no other elements
    if (otherListElements.length === 0) {
      return this.normalizeClasses(targetElement.classList).split(" ").filter(Boolean);
    }

    const targetClasses = this.normalizeClasses(targetElement.classList).split(" ").filter(Boolean);
    
    // Fast path for elements with no classes
    if (targetClasses.length === 0) {
      return [];
    }

    // Create optimized cache key
    const cacheKey = `${targetElement.tagName}_${targetClasses.join(',')}_${otherListElements.length}`;

    // Check cache first
    if (this.classCache.has(cacheKey)) {
      return this.classCache.get(cacheKey)!;
    }

    // Optimized similarity check - limit elements to check but allow more depth
    const maxElementsToCheck = 100;
    let checkedElements = 0;
    const similarElements: HTMLElement[] = [];

    for (const listEl of otherListElements) {
      if (checkedElements >= maxElementsToCheck) break;
      
      const descendants = this.getAllDescendantsIncludingShadow(listEl);
      for (const child of descendants) {
        if (checkedElements >= maxElementsToCheck) break;
        if (child.tagName === targetElement.tagName) {
          similarElements.push(child);
          checkedElements++;
        }
      }
    }

    if (similarElements.length === 0) {
      this.classCache.set(cacheKey, targetClasses);
      return targetClasses;
    }

    // Fast exact match check
    const targetClassSet = new Set(targetClasses);
    const exactMatches = similarElements.filter(el => {
      const elClasses = this.normalizeClasses(el.classList).split(" ").filter(Boolean);
      if (elClasses.length !== targetClasses.length) return false;
      return elClasses.every(cls => targetClassSet.has(cls));
    });

    // If we found exact matches, return all target classes
    if (exactMatches.length > 0) {
      this.classCache.set(cacheKey, targetClasses);
      return targetClasses;
    }

    const commonClasses: string[] = [];

    for (const targetClass of targetClasses) {
      // Check if this class exists in at least one element from each other list
      const existsInAllOtherLists = otherListElements.every(listEl => {
        const elementsInThisList = this.getAllDescendantsIncludingShadow(listEl).filter(child => 
          child.tagName === targetElement.tagName
        );

        return elementsInThisList.some(el => 
          this.normalizeClasses(el.classList).split(" ").includes(targetClass)
        );
      });

      if (existsInAllOtherLists) {
        commonClasses.push(targetClass);
      }
    }

    // Cache the result
    this.classCache.set(cacheKey, commonClasses);
    return commonClasses;
  }

  // Helper method to check containment (works for both light and shadow DOM)
  private elementContains(
    container: HTMLElement,
    element: HTMLElement
  ): boolean {
    // Standard containment check
    if (container.contains(element)) {
      return true;
    }

    // Check shadow DOM containment
    let current: HTMLElement | null = element;
    while (current) {
      if (current === container) {
        return true;
      }

      // Move to parent or shadow host
      current =
        current.parentElement ||
        ((current.getRootNode() as ShadowRoot).host as HTMLElement | null);
    }

    return false;
  }

  // Simplified validation
  private validateXPath(xpath: string, document: Document): boolean {
    try {
      const result = document.evaluate(
        xpath,
        document,
        null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null
      );
      return result.snapshotLength > 0;
    } catch (error) {
      return false;
    }
  }

  // Enhanced findMatchingAbsoluteXPath with better matching algorithm
  private precomputeSelectorMappings(
    childSelectors: string[],
    document: Document
  ): void {
    if (
      this.lastCachedDocument === document &&
      this.selectorElementCache.size > 0
    ) {
      return; // Already cached
    }

    console.time("Precomputing selector mappings");
    this.selectorElementCache.clear();
    this.elementSelectorCache = new WeakMap();
    this.spatialIndex.clear();

    // Batch process selectors to avoid blocking
    const batchSize = this.performanceConfig.maxSelectorBatchSize;

    for (let i = 0; i < childSelectors.length; i += batchSize) {
      const batch = childSelectors.slice(i, i + batchSize);

      batch.forEach((selector) => {
        try {
          const elements = this.evaluateXPath(selector, document);
          this.selectorElementCache.set(selector, elements);

          // Build reverse mapping: element -> selectors that match it
          elements.forEach((element) => {
            const existingSelectors =
              this.elementSelectorCache.get(element) || [];
            existingSelectors.push(selector);
            this.elementSelectorCache.set(element, existingSelectors);

            // Add to spatial index if enabled
            if (this.performanceConfig.enableSpatialIndexing) {
              const gridKey = this.getElementGridKey(element);
              const gridSelectors = this.spatialIndex.get(gridKey) || [];
              gridSelectors.push(selector);
              this.spatialIndex.set(gridKey, gridSelectors);
            }
          });
        } catch (error) {
          // Skip invalid selectors silently
        }
      });
    }

    this.lastCachedDocument = document;
    console.timeEnd("Precomputing selector mappings");
  }

  // NEW: Simple spatial indexing for proximity-based filtering
  private getElementGridKey(element: HTMLElement): string {
    const rect = element.getBoundingClientRect();
    const gridSize = 100; // 100px grid cells
    const x = Math.floor(rect.left / gridSize);
    const y = Math.floor(rect.top / gridSize);
    return `${x},${y}`;
  }

  // NEW: Get nearby selectors using spatial indexing
  private getNearbySelectorCandidates(element: HTMLElement): string[] {
    if (!this.performanceConfig.enableSpatialIndexing) {
      return Array.from(this.selectorElementCache.keys());
    }

    const gridKey = this.getElementGridKey(element);
    const rect = element.getBoundingClientRect();
    const gridSize = 100;

    // Check current cell and adjacent cells
    const candidates = new Set<string>();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const x = Math.floor(rect.left / gridSize) + dx;
        const y = Math.floor(rect.top / gridSize) + dy;
        const key = `${x},${y}`;
        const selectors = this.spatialIndex.get(key) || [];
        selectors.forEach((s) => candidates.add(s));
      }
    }

    return Array.from(candidates);
  }

  // OPTIMIZED: Ultra-fast direct lookup using cached mappings
  private findDirectMatches(
    targetElement: HTMLElement,
    childSelectors: string[],
    document: Document
  ): string[] {
    // Use cached reverse mapping if available
    if (
      this.performanceConfig.useElementCache &&
      this.elementSelectorCache.has(targetElement)
    ) {
      const cachedSelectors =
        this.elementSelectorCache.get(targetElement) || [];
      // Filter to only selectors in the current child selectors list
      const matches = cachedSelectors.filter((selector) =>
        childSelectors.includes(selector)
      );

      // positional selectors over non-positional ones
      return this.sortByPositionalPriority(matches);
    }

    // Fallback to spatial filtering + selective evaluation
    const candidateSelectors = this.getNearbySelectorCandidates(targetElement);
    const relevantCandidates = candidateSelectors.filter((selector) =>
      childSelectors.includes(selector)
    );

    const matches: string[] = [];

    // Process in smaller batches to avoid blocking
    for (const selector of relevantCandidates.slice(0, 20)) {
      // Limit to top 20 candidates
      try {
        const cachedElements = this.selectorElementCache.get(selector);
        if (cachedElements && cachedElements.includes(targetElement)) {
          matches.push(selector);
        }
      } catch (error) {
        continue;
      }
    }

    // positional selectors and sort by specificity
    return this.sortByPositionalPriority(matches);
  }

  /**
   * Sort selectors to prioritize positional ones over non-positional
   */
  private sortByPositionalPriority(selectors: string[]): string[] {
    return selectors.sort((a, b) => {
      const aIsPositional = /\[\d+\]/.test(a);
      const bIsPositional = /\[\d+\]/.test(b);

      // Positional selectors get higher priority
      if (aIsPositional && !bIsPositional) return -1;
      if (!aIsPositional && bIsPositional) return 1;

      // If both are positional or both are non-positional, sort by specificity
      return (
        this.calculateXPathSpecificity(b) - this.calculateXPathSpecificity(a)
      );
    });
  }

  // OPTIMIZED: Fast element proximity check instead of full similarity calculation
  private findProximityMatch(
    targetElement: HTMLElement,
    childSelectors: string[],
    document: Document
  ): string | null {
    const targetRect = targetElement.getBoundingClientRect();
    const targetCenter = {
      x: targetRect.left + targetRect.width / 2,
      y: targetRect.top + targetRect.height / 2,
    };

    let bestMatch = null;
    let bestDistance = Infinity;
    let bestScore = 0;

    // Use spatial filtering to reduce candidates
    const candidateSelectors = this.getNearbySelectorCandidates(targetElement)
      .filter((selector) => childSelectors.includes(selector))
      .slice(0, 30); // Limit candidates

    for (const selector of candidateSelectors) {
      try {
        const cachedElements = this.selectorElementCache.get(selector) || [];

        for (const element of cachedElements.slice(0, 5)) {
          // Check max 5 elements per selector
          const rect = element.getBoundingClientRect();
          const center = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          };

          const distance = Math.sqrt(
            Math.pow(center.x - targetCenter.x, 2) +
              Math.pow(center.y - targetCenter.y, 2)
          );

          // Quick element similarity check (just tag + basic attributes)
          const similarity = this.calculateQuickSimilarity(
            targetElement,
            element
          );

          if (similarity > 0.7 && distance < bestDistance) {
            bestDistance = distance;
            bestMatch = selector;
            bestScore = similarity;
          }
        }
      } catch (error) {
        continue;
      }
    }

    return bestMatch;
  }

  // NEW: Lightweight similarity calculation for real-time use
  private calculateQuickSimilarity(
    element1: HTMLElement,
    element2: HTMLElement
  ): number {
    if (element1 === element2) return 1.0;

    let score = 0;
    let maxScore = 0;

    // Tag name (most important)
    maxScore += 4;
    if (element1.tagName === element2.tagName) {
      score += 4;
    } else {
      return 0; // Different tags = no match for performance
    }

    // Quick class check (just count common classes)
    maxScore += 3;
    const classes1 = element1.classList;
    const classes2 = element2.classList;
    let commonClasses = 0;
    for (const cls of classes1) {
      if (classes2.contains(cls)) commonClasses++;
    }
    if (classes1.length > 0 && classes2.length > 0) {
      score += (commonClasses / Math.max(classes1.length, classes2.length)) * 3;
    }

    // Quick attribute check (just a few key ones)
    maxScore += 2;
    const keyAttrs = ["data-testid", "role", "type"];
    let matchingAttrs = 0;
    for (const attr of keyAttrs) {
      if (element1.getAttribute(attr) === element2.getAttribute(attr)) {
        matchingAttrs++;
      }
    }
    score += (matchingAttrs / keyAttrs.length) * 2;

    return maxScore > 0 ? score / maxScore : 0;
  }

  /**
   * Helper method to find the list element that contains the target element
   */
  private findListElementForTarget(
    targetElement: HTMLElement,
    listSelector: string,
    document: Document
  ): HTMLElement | null {
    try {
      const parentElements = this.evaluateXPath(listSelector, document);
      return (
        parentElements.find((parent) => parent.contains(targetElement)) || null
      );
    } catch (error) {
      console.error("Error finding list element for target:", error);
      return null;
    }
  }

  // SUPER OPTIMIZED: Main matching function with early exits and caching
  private findMatchingAbsoluteXPath(
    targetElement: HTMLElement,
    childSelectors: string[],
    listSelector: string,
    iframeDocument: Document
  ): { primary: string | null; fallback: string | null } {
    try {
      // Ensure mappings are precomputed
      this.precomputeSelectorMappings(childSelectors, iframeDocument);

      let primaryMatch: string | null = null;

      // Strategy 1: Ultra-fast direct lookup (for functionality)
      const directMatches = this.findDirectMatches(
        targetElement,
        childSelectors,
        iframeDocument
      );

      if (directMatches.length > 0) {
        primaryMatch = directMatches[0];
      }

      // Strategy 2: Fast proximity-based matching (if no direct match)
      if (!primaryMatch) {
        const proximityMatch = this.findProximityMatch(
          targetElement,
          childSelectors,
          iframeDocument
        );
        if (proximityMatch) {
          primaryMatch = proximityMatch;
        }
      }

      // Strategy 3: Build and validate new XPath only if no cached matches found
      if (!primaryMatch) {
        const builtXPath = this.buildTargetXPath(
          targetElement,
          listSelector,
          iframeDocument
        );
        if (builtXPath) {
          primaryMatch = builtXPath;
        }
      }

      // generate fallback XPath for storage
      const listElement = this.findListElementForTarget(
        targetElement,
        listSelector,
        iframeDocument
      );
      const fallbackMatch = listElement
        ? this.generateMandatoryChildFallbackXPath(targetElement, listElement)
        : null;

      return { primary: primaryMatch, fallback: fallbackMatch };
    } catch (error) {
      console.error("Error in optimized matching:", error);

      const listElement = this.findListElementForTarget(
        targetElement,
        listSelector,
        iframeDocument
      );
      const fallbackMatch = listElement
        ? this.generateMandatoryChildFallbackXPath(targetElement, listElement)
        : null;

      return { primary: null, fallback: fallbackMatch };
    }
  }

  // NEW: Public method to precompute mappings when child selectors are first generated
  public precomputeChildSelectorMappings(
    childSelectors: string[],
    document: Document
  ): void {
    this.precomputeSelectorMappings(childSelectors, document);
  }

  // Calculate XPath specificity for better matching
  private calculateXPathSpecificity(xpath: string): number {
    let score = 0;

    // Count specific attributes
    score += (xpath.match(/@id=/g) || []).length * 10;
    score += (xpath.match(/@data-testid=/g) || []).length * 8;
    score += (xpath.match(/contains\(@class/g) || []).length * 3;
    score += (xpath.match(/@\w+=/g) || []).length * 2;
    score += (xpath.match(/\[\d+\]/g) || []).length * 1; // Position predicates

    // Penalty for overly generic selectors
    if (xpath.match(/^\/\/\w+$/) && !xpath.includes("[")) {
      score -= 5; // Just a tag name
    }

    return score;
  }

  // Build XPath for target element
  private buildTargetXPath(
    targetElement: HTMLElement,
    listSelector: string,
    document: Document
  ): string | null {
    try {
      const parentElements = this.evaluateXPath(listSelector, document);
      const containingParent = parentElements[0];

      if (!containingParent) {
        return null;
      }

      const structuralPath = this.getOptimizedStructuralPath(
        targetElement,
        containingParent
      );
      if (!structuralPath) {
        return null;
      }

      return listSelector + structuralPath;
    } catch (error) {
      console.error("Error building target XPath:", error);
      return null;
    }
  }

  private evaluateXPath(
    xpath: string,
    contextNode: Document | ShadowRoot
  ): HTMLElement[] {
    try {
      if (!this.isXPathSelector(xpath)) {
        console.warn("Selector doesn't appear to be XPath:", xpath);
        return [];
      }

      const document =
        contextNode instanceof ShadowRoot
          ? (contextNode.host as HTMLElement).ownerDocument
          : (contextNode as Document);

      const result = document.evaluate(
        xpath,
        contextNode as any,
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
    } catch (error) {
      return this.fallbackXPathEvaluation(xpath, contextNode);
    }
  }

  private isXPathSelector(selector: string): boolean {
    return (
      selector.startsWith("//") ||
      selector.startsWith("/") ||
      selector.startsWith("./") ||
      selector.includes("contains(@") ||
      selector.includes("[count(") ||
      selector.includes("@class=") ||
      selector.includes("@id=") ||
      selector.includes(" and ") ||
      selector.includes(" or ")
    );
  }

  private fallbackXPathEvaluation(
    xpath: string,
    contextNode: Document | ShadowRoot
  ): HTMLElement[] {
    try {
      if (this.isXPathSelector(xpath)) {
        console.warn("⚠️ Complex XPath not supported in fallback:", xpath);
        return [];
      }

      const simpleTagMatch = xpath.match(/^\/\/(\w+)$/);
      if (simpleTagMatch) {
        const tagName = simpleTagMatch[1];
        return Array.from(
          contextNode.querySelectorAll(tagName)
        ) as HTMLElement[];
      }

      const singleClassMatch = xpath.match(
        /^\/\/(\w+)\[contains\(@class,'([^']+)'\)\]$/
      );
      if (singleClassMatch) {
        const [, tagName, className] = singleClassMatch;
        return Array.from(
          contextNode.querySelectorAll(`${tagName}.${CSS.escape(className)}`)
        ) as HTMLElement[];
      }

      const positionMatch = xpath.match(/^\/\/(\w+)\[(\d+)\]$/);
      if (positionMatch) {
        const [, tagName, position] = positionMatch;
        return Array.from(
          contextNode.querySelectorAll(`${tagName}:nth-child(${position})`)
        ) as HTMLElement[];
      }

      console.warn("⚠️ Could not parse XPath pattern:", xpath);
      return [];
    } catch (error) {
      console.error("❌ Fallback XPath evaluation also failed:", error);
      return [];
    }
  }

  private getBestSelectorForAction = (action: Action) => {
    switch (action.type) {
      case ActionType.Click:
      case ActionType.Hover:
      case ActionType.DragAndDrop: {
        const selectors = action.selectors;

        if (selectors?.iframeSelector?.full) {
          return selectors.iframeSelector.full;
        }

        if (selectors?.shadowSelector?.full) {
          return selectors.shadowSelector.full;
        }

        // less than 25 characters, and element only has text inside
        const textSelector =
          selectors?.text?.length != null &&
          selectors?.text?.length < 25 &&
          action.hasOnlyText
            ? selectors.generalSelector
            : null;

        if (action.tagName === TagName.Input) {
          return (
            selectors.testIdSelector ??
            selectors?.id ??
            selectors?.formSelector ??
            selectors?.accessibilitySelector ??
            selectors?.generalSelector ??
            selectors?.attrSelector ??
            null
          );
        }
        if (action.tagName === TagName.A) {
          return (
            selectors.testIdSelector ??
            selectors?.id ??
            selectors?.hrefSelector ??
            selectors?.accessibilitySelector ??
            selectors?.generalSelector ??
            selectors?.attrSelector ??
            null
          );
        }

        // Prefer text selectors for spans, ems over general selectors
        if (
          action.tagName === TagName.Span ||
          action.tagName === TagName.EM ||
          action.tagName === TagName.Cite ||
          action.tagName === TagName.B ||
          action.tagName === TagName.Strong
        ) {
          return (
            selectors.testIdSelector ??
            selectors?.id ??
            selectors?.accessibilitySelector ??
            selectors?.hrefSelector ??
            textSelector ??
            selectors?.generalSelector ??
            selectors?.attrSelector ??
            null
          );
        }
        return (
          selectors.testIdSelector ??
          selectors?.id ??
          selectors?.accessibilitySelector ??
          selectors?.hrefSelector ??
          selectors?.generalSelector ??
          selectors?.attrSelector ??
          null
        );
      }
      case ActionType.Input:
      case ActionType.Keydown: {
        const selectors = action.selectors;

        if (selectors?.shadowSelector?.full) {
          return selectors.shadowSelector.full;
        }

        return (
          selectors.testIdSelector ??
          selectors?.id ??
          selectors?.formSelector ??
          selectors?.accessibilitySelector ??
          selectors?.generalSelector ??
          selectors?.attrSelector ??
          null
        );
      }
      default:
        break;
    }
    return null;
  };

  /**
   * Determines if an element is within a Shadow DOM
   */
  private isElementInShadowDOM(element: HTMLElement): boolean {
    try {
      const rootNode = element.getRootNode();

      return (
        rootNode.constructor.name === "ShadowRoot" ||
        (rootNode && "host" in rootNode && "mode" in rootNode)
      );
    } catch (error) {
      console.warn("Error checking shadow DOM:", error);
      return false;
    }
  }

  /**
   * Enhanced highlighting that detects and highlights entire groups
   */
  public generateDataForHighlighter(
    coordinates: Coordinates,
    iframeDocument: Document,
    isDOMMode: boolean = true,
    cachedChildSelectors: string[] = []
  ): {
    rect: DOMRect;
    selector: string;
    fallbackSelector: string | null;
    elementInfo: ElementInfo | null;
    childSelectors?: string[];
    isShadow?: boolean;
    groupInfo?: {
      isGroupElement: boolean;
      groupSize: number;
      groupElements: HTMLElement[];
      groupFingerprint: ElementFingerprint;
    };
    similarElements?: {
      elements: HTMLElement[];
      rects: DOMRect[];
    };
  } | null {
    try {
      if (this.getList === true) {
        this.analyzeElementGroups(iframeDocument);
      }

      const elementAtPoint = this.findGroupedContainerAtPoint(
        coordinates.x,
        coordinates.y,
        iframeDocument
      );
      if (!elementAtPoint) return null;

      const elementGroup = this.getElementGroup(elementAtPoint);
      const isGroupElement = elementGroup !== null;

      let isShadow = false;
      let targetElement = elementAtPoint;

      const rect = this.getRect(
        iframeDocument,
        coordinates,
        this.listSelector,
        this.getList,
        isDOMMode
      );

      const elementInfo = this.getElementInformation(
        iframeDocument,
        coordinates,
        this.listSelector,
        this.getList
      );

      if (!rect || !elementInfo) {
        return null;
      }

      let displaySelector: string | null = null;
      let fallbackSelector: string | null = null;
      let childSelectors: string[] = [];
      let similarElements:
        | { elements: HTMLElement[]; rects: DOMRect[] }
        | undefined;

      if (this.getList === true && this.listSelector !== "") {
        childSelectors =
          cachedChildSelectors.length > 0
            ? cachedChildSelectors
            : this.getChildSelectors(iframeDocument, this.listSelector);

        if (cachedChildSelectors.length > 0) {
          this.precomputeChildSelectorMappings(
            cachedChildSelectors,
            iframeDocument
          );
        }
      }

      if (isGroupElement && this.getList === true && this.listSelector === "") {
        const groupSelectors = this.generateGroupContainerSelector(
          elementGroup!
        );
        displaySelector = groupSelectors.primary;
        fallbackSelector = groupSelectors.fallback;

        targetElement = elementGroup!.representative;
        isShadow = this.isElementInShadowDOM(targetElement);

        return {
          rect,
          selector: displaySelector,
          fallbackSelector: fallbackSelector,
          elementInfo,
          isShadow,
          groupInfo: {
            isGroupElement: true,
            groupSize: elementGroup!.elements.length,
            groupElements: elementGroup!.elements,
            groupFingerprint: elementGroup!.fingerprint,
          },
        };
      } else if (
        this.getList === true &&
        this.listSelector !== "" &&
        childSelectors.length > 0 &&
        this.paginationMode === false
      ) {
        const selectorResult = this.findMatchingAbsoluteXPath(
          elementAtPoint,
          childSelectors,
          this.listSelector,
          iframeDocument
        );

        displaySelector = selectorResult.primary;
        fallbackSelector = selectorResult.fallback;

        if (displaySelector) {
          const matchingElements = this.getAllMatchingElements(
            displaySelector,
            childSelectors,
            iframeDocument
          );

          if (matchingElements.length > 1) {
            const rects = matchingElements.map((el) => {
              const elementRect = el.getBoundingClientRect();
              if (isDOMMode) {
                return elementRect;
              } else {
                let adjustedRect = elementRect;
                let currentWindow = el.ownerDocument.defaultView;

                while (currentWindow !== window.top) {
                  const frameElement =
                    currentWindow?.frameElement as HTMLIFrameElement;
                  if (!frameElement) break;

                  const frameRect = frameElement.getBoundingClientRect();
                  adjustedRect = new DOMRect(
                    adjustedRect.x + frameRect.x,
                    adjustedRect.y + frameRect.y,
                    adjustedRect.width,
                    adjustedRect.height
                  );

                  currentWindow = frameElement.ownerDocument.defaultView;
                }

                return adjustedRect;
              }
            });

            similarElements = {
              elements: matchingElements,
              rects,
            };
          }
        }
      } else {
        const selectorResult = this.generateSelector(
          iframeDocument,
          coordinates,
          ActionType.Click
        );

        displaySelector = selectorResult.primary;
        fallbackSelector = selectorResult.fallback;
      }

      if (!displaySelector) {
        return null;
      }

      targetElement = elementAtPoint;
      isShadow = this.isElementInShadowDOM(targetElement);

      return {
        rect,
        selector: displaySelector,
        fallbackSelector: fallbackSelector,
        elementInfo,
        childSelectors: childSelectors.length > 0 ? childSelectors : undefined,
        isShadow,
        groupInfo: isGroupElement
          ? {
              isGroupElement: true,
              groupSize: elementGroup!.elements.length,
              groupElements: elementGroup!.elements,
              groupFingerprint: elementGroup!.fingerprint,
            }
          : undefined,
        similarElements,
      };
    } catch (error) {
      console.error("Error generating highlighter data:", error);
      return null;
    }
  }

  /**
   * Generate XPath that matches ALL group elements and ONLY group elements
   */
  private generateGroupContainerSelector(group: ElementGroup): {
    primary: string;
    fallback: string | null;
  } {
    const { elements } = group;

    if (!elements || elements.length === 0) {
      return { primary: "", fallback: null };
    }

    // ALWAYS generate primary XPath
    let primary = "";
    try {
      const tagName = elements[0].tagName.toLowerCase();
      if (!elements.every((el) => el.tagName.toLowerCase() === tagName)) {
        throw new Error("Inconsistent tag names in group.");
      }

      let xpath = `//${tagName}`;
      const predicates: string[] = [];

      // Get common classes
      const commonClasses = this.getCommonStrings(
        elements.map((el) =>
          (el.getAttribute("class") || "").split(/\s+/).filter(Boolean)
        )
      );
      if (commonClasses.length > 0) {
        predicates.push(
          ...commonClasses.map((cls) => `contains(@class, '${cls}')`)
        );
      }

      // Get common attributes (excluding id, style, data-mx-id, class)
      const commonAttributes = this.getCommonAttributes(elements, [
        "id",
        "style",
        "data-mx-id",
        "class",
      ]);
      for (const [attr, value] of Object.entries(commonAttributes)) {
        predicates.push(`@${attr}='${value}'`);
      }

      // Optional: Common child count
      const childrenCountSet = new Set(
        elements.map((el) => el.children.length)
      );
      if (childrenCountSet.size === 1) {
        predicates.push(`count(*)=${[...childrenCountSet][0]}`);
      }

      if (predicates.length > 0) {
        xpath += `[${predicates.join(" and ")}]`;
      }

      primary = xpath;
    } catch (error) {
      console.warn("Primary group XPath generation failed:", error);
      const tagName = elements[0].tagName.toLowerCase();
      primary = `//${tagName}`;
    }

    const fallback = this.generateMandatoryGroupFallback(elements);

    return { primary, fallback };
  }

  // Returns intersection of strings
  private getCommonStrings(lists: string[][]): string[] {
    return lists.reduce((acc, list) =>
      acc.filter((item) => list.includes(item))
    );
  }

  // Returns common attribute key-value pairs across elements
  private getCommonAttributes(
    elements: Element[],
    excludeAttrs: string[] = []
  ): Record<string, string> {
    if (elements.length === 0) return {};

    const firstEl = elements[0];
    const attrMap: Record<string, string> = {};

    for (const attr of Array.from(firstEl.attributes)) {
      if (
        excludeAttrs.includes(attr.name) ||
        !attr.value ||
        attr.value.trim() === ""
      ) {
        continue;
      }

      if (
        attr.name.startsWith("_ngcontent-") ||
        attr.name.startsWith("_nghost-")
      ) {
        continue;
      }

      if (
        attr.name.match(/^(data-reactid|data-react-checksum|ng-reflect-)/) ||
        (attr.name.includes("-c") && attr.name.match(/\d+$/))
      ) {
        continue;
      }

      attrMap[attr.name] = attr.value;
    }

    for (let i = 1; i < elements.length; i++) {
      for (const name of Object.keys(attrMap)) {
        const val = elements[i].getAttribute(name);
        if (val !== attrMap[name]) {
          delete attrMap[name]; // remove if mismatch
        }
      }
    }

    return attrMap;
  }

  /**
   * Unified getDeepestElementFromPoint method that combines all features
   * from the different implementations in getRect, getElementInformation, and the private method
   */
  private getDeepestElementFromPoint(
    x: number,
    y: number,
    iframeDoc: Document
  ): HTMLElement | null {
    let elements = iframeDoc.elementsFromPoint(x, y) as HTMLElement[];
    if (!elements.length) return null;

    // Check for dialog elements and prioritize them if they're actually at the coordinates
    const dialogElement = this.findDialogElement(elements);
    if (dialogElement) {
      // Verify the dialog element is actually at the coordinates (not just a background overlay)
      const dialogRect = dialogElement.getBoundingClientRect();
      const isClickInsideDialog = x >= dialogRect.left && x <= dialogRect.right && 
                                  y >= dialogRect.top && y <= dialogRect.bottom;
      
      if (isClickInsideDialog) {
        // Filter to keep only the dialog and its children
        const dialogElements = elements.filter(
          (el) => el === dialogElement || dialogElement.contains(el)
        );
        
        // Get deepest element within the dialog
        const deepestInDialog = this.findDeepestInDialog(dialogElements, dialogElement);
        if (deepestInDialog) {
          return deepestInDialog;
        }
      }
    }

    const filteredElements = this.filterLogicalElements(elements, x, y);
    const targetElements =
      filteredElements.length > 0 ? filteredElements : elements;

    const visited = new Set<HTMLElement>();
    let deepestElement = this.findTrulyDeepestElement(
      targetElements,
      x,
      y,
      visited
    );
    if (!deepestElement) return null;

    return deepestElement;
  }

  /**
   * Helper methods used by the unified getDeepestElementFromPoint
   */
  private filterLogicalElements(
    elements: HTMLElement[],
    x: number,
    y: number
  ): HTMLElement[] {
    if (elements.length <= 1) return elements;

    const elementsWithContent = elements.filter((element) => {
      return this.elementHasRelevantContentAtPoint(element, x, y);
    });

    if (elementsWithContent.length > 0) {
      return elementsWithContent;
    }

    return elements;
  }

  private elementHasRelevantContentAtPoint(
    element: HTMLElement,
    x: number,
    y: number
  ): boolean {
    const rect = element.getBoundingClientRect();

    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      return false;
    }

    const hasDirectText = Array.from(element.childNodes).some(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
    );

    if (hasDirectText) {
      return true;
    }

    if (element.tagName === "IMG") {
      return true;
    }

    const contentTags = [
      "INPUT",
      "BUTTON",
      "SELECT",
      "TEXTAREA",
      "VIDEO",
      "AUDIO",
      "CANVAS",
      "SVG",
    ];
    if (contentTags.includes(element.tagName)) {
      return true;
    }

    const childElements = Array.from(element.children) as HTMLElement[];
    return childElements.some(child => 
      this.elementHasRelevantContentAtPoint(child, x, y)
    );
  }

  private findTrulyDeepestElement(
    elements: HTMLElement[],
    x: number,
    y: number,
    visited: Set<HTMLElement>
  ): HTMLElement | null {
    let deepestElement: HTMLElement | null = null;
    let maxDepth = -1;

    for (const element of elements) {
      if (visited.has(element)) continue;
      visited.add(element);

      if (element.shadowRoot) {
        const shadowElements = element.shadowRoot.elementsFromPoint(
          x,
          y
        ) as HTMLElement[];
        const deeper = this.findTrulyDeepestElement(
          shadowElements,
          x,
          y,
          visited
        );
        if (deeper) {
          const depth = this.getElementDepth(deeper);
          if (depth > maxDepth) {
            maxDepth = depth;
            deepestElement = deeper;
          }
        }
      }

      const depth = this.getElementDepth(element);
      if (depth > maxDepth) {
        maxDepth = depth;
        deepestElement = element;
      }
    }

    return deepestElement;
  }

  private getElementDepth(element: HTMLElement): number {
    let depth = 0;
    let current: HTMLElement | null = element;

    while (current && current !== this.lastAnalyzedDocument?.body) {
      depth++;
      current =
        current.parentElement ||
        ((current.getRootNode() as ShadowRoot).host as HTMLElement | null);
      if (depth > 50) break;
    }
    return depth;
  }

  /**
   * Find dialog element in the elements array
   */
  private findDialogElement(elements: HTMLElement[]): HTMLElement | null {
    let dialogElement = elements.find((el) => el.getAttribute("role") === "dialog");
    
    if (!dialogElement) {
      dialogElement = elements.find((el) => el.tagName.toLowerCase() === "dialog");
    }
    
    if (!dialogElement) {
      dialogElement = elements.find((el) => {
        const classList = el.classList.toString().toLowerCase();
        const id = (el.id || "").toLowerCase();
        
        return (
          classList.includes("modal") ||
          classList.includes("dialog") ||
          classList.includes("popup") ||
          classList.includes("overlay") ||
          id.includes("modal") ||
          id.includes("dialog") ||
          id.includes("popup")
        );
      });
    }
  
    return dialogElement || null;
  }

  /**
   * Find the deepest element within a dialog
   */
  private findDeepestInDialog(
    dialogElements: HTMLElement[],
    dialogElement: HTMLElement
  ): HTMLElement | null {
    if (!dialogElements.length) return null;
    if (dialogElements.length === 1) return dialogElements[0];

    let deepestElement = dialogElements[0];
    let maxDepth = 0;

    for (const element of dialogElements) {
      let depth = 0;
      let current = element;

      // Calculate depth within the dialog context
      while (
        current &&
        current.parentElement &&
        current !== dialogElement.parentElement
      ) {
        depth++;
        current = current.parentElement;
      }

      if (depth > maxDepth) {
        maxDepth = depth;
        deepestElement = element;
      }
    }

    return deepestElement;
  }

  /**
   * Find all dialog elements in the document
   */
  private findAllDialogElements(doc: Document): HTMLElement[] {
    const dialogElements: HTMLElement[] = [];
    const allElements = Array.from(doc.querySelectorAll("*")) as HTMLElement[];

    for (const element of allElements) {
      if (element.getAttribute("role") === "dialog") {
        dialogElements.push(element);
        continue;
      }

      if (element.tagName.toLowerCase() === "dialog") {
        dialogElements.push(element);
        continue;
      }

      const classList = element.classList.toString().toLowerCase();
      const id = (element.id || "").toLowerCase();
      
      if (
        classList.includes("modal") ||
        classList.includes("dialog") ||
        classList.includes("popup") ||
        classList.includes("overlay") ||
        id.includes("modal") ||
        id.includes("dialog") ||
        id.includes("popup")
      ) {
        dialogElements.push(element);
        continue;
      }
    }

    return dialogElements;
  }

  /**
   * Get all visible elements from within dialog elements
   */
  private getElementsFromDialogs(dialogElements: HTMLElement[]): HTMLElement[] {
    const elements: HTMLElement[] = [];
    const visited = new Set<HTMLElement>();

    for (const dialog of dialogElements) {
      const dialogChildren = Array.from(dialog.querySelectorAll("*")).filter(
        (el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }
      ) as HTMLElement[];

      // Add dialog itself if it's visible
      const dialogRect = dialog.getBoundingClientRect();
      if (dialogRect.width > 0 && dialogRect.height > 0 && !visited.has(dialog)) {
        visited.add(dialog);
        elements.push(dialog);
      }

      // Add all visible children
      dialogChildren.forEach((element) => {
        if (!visited.has(element)) {
          visited.add(element);
          elements.push(element);

          // Traverse shadow DOM if it exists within dialog
          if (element.shadowRoot) {
            const shadowElements = this.getElementsFromShadowRoot(element.shadowRoot);
            shadowElements.forEach(shadowEl => {
              if (!visited.has(shadowEl)) {
                visited.add(shadowEl);
                elements.push(shadowEl);
              }
            });
          }
        }
      });
    }

    return elements;
  }

  /**
   * Get elements from shadow root (helper for dialog analysis)
   */
  private getElementsFromShadowRoot(shadowRoot: ShadowRoot): HTMLElement[] {
    const elements: HTMLElement[] = [];
    try {
      const shadowChildren = Array.from(shadowRoot.querySelectorAll("*")).filter(
        (el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }
      ) as HTMLElement[];

      shadowChildren.forEach((element) => {
        elements.push(element);
        
        // Recursively traverse nested shadow DOMs
        if (element.shadowRoot) {
          const nestedShadowElements = this.getElementsFromShadowRoot(element.shadowRoot);
          elements.push(...nestedShadowElements);
        }
      });
    } catch (error) {
      console.warn("Could not access shadow root:", error);
    }

    return elements;
  }

  /**
   * Clean up when component unmounts or mode changes
   */
  public cleanup(): void {
    this.elementGroups.clear();
    this.groupedElements.clear();
    this.lastAnalyzedDocument = null;
    this.selectorElementCache.clear();
    this.elementSelectorCache = new WeakMap();
    this.spatialIndex.clear();
    this.lastCachedDocument = null;
    this.classCache.clear();
    this.selectorCache.clear();
    this.pathCache = new WeakMap<HTMLElement, string | null>();
    this.descendantsCache = new WeakMap<HTMLElement, HTMLElement[]>();
    this.meaningfulCache = new WeakMap<HTMLElement, boolean>();
  }

  // Update generateSelector to use instance variables
  public generateSelector(
    iframeDocument: Document,
    coordinates: Coordinates,
    action: ActionType
  ): { primary: string | null; fallback: string | null } {
    const elementInfo = this.getElementInformation(
      iframeDocument,
      coordinates,
      "",
      false
    );

    const selectorResult = this.getSelectors(iframeDocument, coordinates);
    const selectorBasedOnCustomAction = selectorResult.primary;
    const fallbackSelector = selectorResult.fallback;

    let primarySelector: string | null = null;

    if (this.paginationMode && selectorBasedOnCustomAction) {
      // Chain CSS selectors in specific priority order
      const selectors = selectorBasedOnCustomAction;
      const selectorChain = [
        selectors &&
        "iframeSelector" in selectors &&
        selectors.iframeSelector?.full
          ? selectors.iframeSelector.full
          : null,
        selectors &&
        "shadowSelector" in selectors &&
        selectors.shadowSelector?.full
          ? selectors.shadowSelector.full
          : null,
        selectors && "testIdSelector" in selectors
          ? selectors.testIdSelector
          : null,
        selectors && "id" in selectors ? selectors.id : null,
        selectors && "hrefSelector" in selectors
          ? selectors.hrefSelector
          : null,
        selectors && "relSelector" in selectors ? selectors.relSelector : null,
        selectors && "accessibilitySelector" in selectors
          ? selectors.accessibilitySelector
          : null,
        selectors && "attrSelector" in selectors
          ? selectors.attrSelector
          : null,
        selectors && "generalSelector" in selectors
          ? selectors.generalSelector
          : null,
      ]
        .filter(
          (selector) =>
            selector !== null && selector !== undefined && selector !== ""
        )
        .join(",");

      primarySelector = selectorChain || null;
    } else {
      // Get the best CSS selector for the action
      primarySelector = this.getBestSelectorForAction({
        type: action,
        tagName: (elementInfo?.tagName as TagName) || TagName.A,
        inputType: undefined,
        value: undefined,
        selectors: selectorBasedOnCustomAction || {},
        timestamp: 0,
        isPassword: false,
        hasOnlyText: elementInfo?.hasOnlyText || false,
      } as Action);
    }

    return {
      primary: primarySelector,
      fallback: fallbackSelector,
    };
  }
}

export const clientSelectorGenerator = new ClientSelectorGenerator();
