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

interface SelectorResult {
  generalSelector: string;
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
        return !cls.match(/\d{3,}|uuid|hash|id-|_\d+$/i);
      })
      .sort()
      .join(" ");
  }

  /**
   * Get element's structural fingerprint for grouping
   */
  private getStructuralFingerprint(
    element: HTMLElement
  ): ElementFingerprint | null {
    if (element.nodeType !== Node.ELEMENT_NODE) return null;

    const tagName = element.tagName.toLowerCase();
    if (this.groupingConfig.excludeSelectors.includes(tagName)) return null;

    const children = Array.from(element.children);
    const childrenStructure = children.map((child) => ({
      tag: child.tagName.toLowerCase(),
      classes: this.normalizeClasses(child.classList),
      hasText: (child.textContent ?? "").trim().length > 0,
    }));

    const normalizedClasses = this.normalizeClasses(element.classList);

    // Get attributes (excluding unique identifiers)
    const relevantAttributes = Array.from(element.attributes)
      .filter(
        (attr) =>
          !["id", "style", "data-reactid", "data-react-checksum"].includes(
            attr.name.toLowerCase()
          )
      )
      .filter(
        (attr) =>
          !attr.name.startsWith("data-") ||
          attr.name === "data-type" ||
          attr.name === "data-role"
      )
      .map((attr) => `${attr.name}=${attr.value}`)
      .sort();

    // Calculate element depth
    let depth = 0;
    let parent = element.parentElement;
    while (parent && depth < 20) {
      depth++;
      parent = parent.parentElement;
    }

    // Get text content characteristics
    const textContent = (element.textContent ?? "").trim();
    const textCharacteristics = {
      hasText: textContent.length > 0,
      textLength: Math.floor(textContent.length / 20) * 20,
      hasLinks: element.querySelectorAll("a").length,
      hasImages: element.querySelectorAll("img").length,
      hasButtons: element.querySelectorAll(
        'button, input[type="button"], input[type="submit"]'
      ).length,
    };

    const signature = `${tagName}::${normalizedClasses}::${
      children.length
    }::${JSON.stringify(childrenStructure)}::${relevantAttributes.join("|")}`;

    return {
      tagName,
      normalizedClasses,
      childrenCount: children.length,
      childrenStructure: JSON.stringify(childrenStructure),
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

    // Get all visible elements
    const allElements = Array.from(iframeDoc.querySelectorAll("*")).filter(
      (el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0; // Only visible elements
      }
    ) as HTMLElement[];

    // Create fingerprints for all elements
    const elementFingerprints = new Map<HTMLElement, ElementFingerprint>();

    allElements.forEach((element) => {
      const fingerprint = this.getStructuralFingerprint(element);
      if (fingerprint) {
        elementFingerprints.set(element, fingerprint);
      }
    });

    // Find similar groups using similarity scoring
    const similarGroups: ElementGroup[] = [];
    const processedElements = new Set<HTMLElement>();

    elementFingerprints.forEach((fingerprint, element) => {
      if (processedElements.has(element)) return;

      const currentGroup = [element];
      processedElements.add(element);

      // Find similar elements
      elementFingerprints.forEach((otherFingerprint, otherElement) => {
        if (processedElements.has(otherElement)) return;

        const similarity = this.calculateSimilarity(
          fingerprint,
          otherFingerprint
        );
        if (similarity >= this.groupingConfig.similarityThreshold) {
          currentGroup.push(otherElement);
          processedElements.add(otherElement);
        }
      });

      // Add group if it has enough members AND has meaningful children
      if (currentGroup.length >= this.groupingConfig.minGroupSize) {
        // Check if the representative element has meaningful children
        const hasChildren = this.hasAnyMeaningfulChildren(element);

        if (hasChildren) {
          const group: ElementGroup = {
            elements: currentGroup,
            fingerprint,
            representative: element,
          };
          similarGroups.push(group);

          // Map each element to its group
          currentGroup.forEach((el) => {
            this.elementGroups.set(el, group);
            this.groupedElements.add(el);
          });
        }
      }
    });

    // Sort groups by size and relevance
    similarGroups.sort((a, b) => {
      // Prioritize by size first
      if (b.elements.length !== a.elements.length)
        return b.elements.length - a.elements.length;

      // Then by element size
      const aSize =
        a.representative.getBoundingClientRect().width *
        a.representative.getBoundingClientRect().height;
      const bSize =
        b.representative.getBoundingClientRect().width *
        b.representative.getBoundingClientRect().height;
      return bSize - aSize;
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

    const traverse = (el: HTMLElement) => {
      Array.from(el.children).forEach((child) => {
        const htmlChild = child as HTMLElement;

        // Check if this child has meaningful content
        if (this.isMeaningfulElement(htmlChild)) {
          meaningfulChildren.push(htmlChild);
        } else {
          // If not meaningful itself, check its children
          traverse(htmlChild);
        }
      });
    };

    traverse(element);
    return meaningfulChildren;
  }

  /**
   * Check if element has meaningful content for extraction
   */
  private isMeaningfulElement(element: HTMLElement): boolean {
    const tagName = element.tagName.toLowerCase();
    const text = (element.textContent || "").trim();
    const hasHref = element.hasAttribute("href");
    const hasSrc = element.hasAttribute("src");

    // Meaningful if it has text content, is a link, image, or input
    return (
      text.length > 0 ||
      hasHref ||
      hasSrc ||
      ["a", "img", "input", "button", "select"].includes(tagName)
    );
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

    // In list mode without selector, transform table cells to rows and prioritize grouped elements
    if (this.getList === true && this.listSelector === "") {
      const transformedElements: HTMLElement[] = [];

      elementsAtPoint.forEach((element) => {
        if (element.tagName === "TD" || element.tagName === "TH") {
          // Find parent TR for table cells
          const parentRow = element.closest("tr") as HTMLElement;
          if (parentRow && !transformedElements.includes(parentRow)) {
            transformedElements.push(parentRow);
          }
        } else {
          // Keep non-table-cell elements as is
          if (!transformedElements.includes(element)) {
            transformedElements.push(element);
          }
        }
      });

      // Now filter for grouped elements from the transformed list
      const groupedElementsAtPoint = transformedElements.filter((element) =>
        this.isElementGrouped(element)
      );

      if (groupedElementsAtPoint.length > 0) {
        // Sort by DOM depth (deeper elements first for more specificity)
        groupedElementsAtPoint.sort((a, b) => {
          const aDepth = this.getElementDepth(a);
          const bDepth = this.getElementDepth(b);
          return bDepth - aDepth;
        });

        const selectedElement = groupedElementsAtPoint[0];
        return selectedElement;
      }

      return null;
    }

    // For other modes or when list selector exists, return regular element
    return this.getDeepestElementFromPoint(elementsAtPoint);
  }

  private getElementDepth(element: HTMLElement): number {
    let depth = 0;
    let current = element;
    while (current && current !== this.lastAnalyzedDocument?.body) {
      depth++;
      current = current.parentElement as HTMLElement;
      if (depth > 50) break;
    }
    return depth;
  }

  public getElementInformation = (
    iframeDoc: Document,
    coordinates: Coordinates,
    listSelector: string,
    getList: boolean
  ) => {
    try {
      if (!getList || listSelector !== "") {
        const getDeepestElementFromPoint = (
          x: number,
          y: number
        ): HTMLElement | null => {
          let elements = iframeDoc.elementsFromPoint(x, y) as HTMLElement[];
          if (!elements.length) return null;

          const findDeepestElement = (
            elements: HTMLElement[]
          ): HTMLElement | null => {
            if (!elements.length) return null;
            if (elements.length === 1) return elements[0];

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

        const el = getDeepestElementFromPoint(coordinates.x, coordinates.y);

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
        const getDeepestElementFromPoint = (
          x: number,
          y: number
        ): HTMLElement | null => {
          let elements = iframeDoc.elementsFromPoint(x, y) as HTMLElement[];
          if (!elements.length) return null;

          const findDeepestElement = (
            elements: HTMLElement[]
          ): HTMLElement | null => {
            if (!elements.length) return null;
            if (elements.length === 1) return elements[0];

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

        const el = getDeepestElementFromPoint(coordinates.x, coordinates.y);
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

  private getSelectors = (iframeDoc: Document, coordinates: Coordinates) => {
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
        const attrs = Array.from(input.attributes).filter((attr) =>
          config.attr(attr.name, attr.value)
        );

        return attrs.map(
          (attr): Node => {
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
          }
        );
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
        return generatedSelectors;
      }
    } catch (e) {
      const { message, stack } = e as Error;
      console.warn(`Error while retrieving element: ${message}`);
      console.warn(`Stack: ${stack}`);
    }
    return null;
  };

  private getNonUniqueSelectors = (
    iframeDoc: Document,
    coordinates: Coordinates,
    listSelector: string
  ): SelectorResult => {
    interface DOMContext {
      type: "shadow";
      element: HTMLElement;
      container: ShadowRoot;
      host: HTMLElement;
    }

    try {
      if (!listSelector) {
        function generateXPathSelector(
          element: HTMLElement,
          relative: boolean = false
        ): string {
          let xpath = relative
            ? element.tagName.toLowerCase()
            : `//${element.tagName.toLowerCase()}`;

          // Handle table cells specially
          if (element.tagName === "TD" || element.tagName === "TH") {
            if (element.parentElement) {
              const siblings = Array.from(element.parentElement.children);
              const position = siblings.indexOf(element) + 1;
              return relative
                ? `${element.tagName.toLowerCase()}[${position}]`
                : `//tr/${element.tagName.toLowerCase()}[${position}]`;
            }
          }

          // Add class-based predicates
          if (element.className) {
            const classes = element.className
              .split(/\s+/)
              .filter((cls: string) => Boolean(cls))
              .filter(
                (cls: string) => !cls.startsWith("!") && !cls.includes(":")
              );

            if (classes.length > 0) {
              const classPredicates = classes
                .map((cls) => `contains(@class,'${cls}')`)
                .join(" and ");
              xpath += `[${classPredicates}]`;
            }
          }

          // Add positional predicate if there are similar siblings
          if (element.parentElement) {
            const siblings = Array.from(element.parentElement.children);
            const elementClasses = Array.from(element.classList || []);

            const similarSiblings = siblings.filter((sibling) => {
              if (sibling === element) return false;
              const siblingClasses = Array.from(sibling.classList || []);
              return siblingClasses.some((cls) => elementClasses.includes(cls));
            });

            if (similarSiblings.length > 0) {
              const position = siblings.indexOf(element) + 1;
              // Remove existing predicates and add position-based one
              const baseXpath = relative
                ? element.tagName.toLowerCase()
                : `//${element.tagName.toLowerCase()}`;
              xpath = `${baseXpath}[${position}]`;
            }
          }

          return xpath;
        }

        function getContextPath(element: HTMLElement): DOMContext[] {
          const path: DOMContext[] = [];
          let current = element;
          let depth = 0;
          const MAX_DEPTH = 4;

          while (current && depth < MAX_DEPTH) {
            const rootNode = current.getRootNode();
            if (rootNode instanceof ShadowRoot) {
              path.unshift({
                type: "shadow",
                element: current,
                container: rootNode,
                host: rootNode.host as HTMLElement,
              });
              current = rootNode.host as HTMLElement;
              depth++;
              continue;
            }
            break;
          }

          return path;
        }

        function getXPathSelectorPath(element: HTMLElement | null): string {
          if (!element) return "";

          const contextPath = getContextPath(element);
          if (contextPath.length > 0) {
            const selectorParts: string[] = [];

            contextPath.forEach((context, index) => {
              const containerSelector = generateXPathSelector(context.host);

              if (index === contextPath.length - 1) {
                const elementSelector = generateXPathSelector(element);
                selectorParts.push(
                  `${containerSelector} >> ${elementSelector}`
                );
              } else {
                selectorParts.push(containerSelector);
              }
            });

            return selectorParts.join(" >> ");
          }

          const elementSelector = generateXPathSelector(element);

          // For simple cases, return the element selector
          if (
            elementSelector.includes("contains(@class") ||
            elementSelector.includes("[")
          ) {
            return elementSelector;
          }

          // Build path with limited depth
          const path: string[] = [];
          let currentElement = element;
          const MAX_DEPTH = 2;
          let depth = 0;

          while (
            currentElement &&
            currentElement !== iframeDoc.body &&
            depth < MAX_DEPTH
          ) {
            const selector = generateXPathSelector(currentElement);
            path.unshift(selector.replace("//", ""));

            if (!currentElement.parentElement) break;
            currentElement = currentElement.parentElement;
            depth++;
          }

          return "//" + path.join("/");
        }

        const originalEl = this.findGroupedContainerAtPoint(
          coordinates.x,
          coordinates.y,
          iframeDoc
        );
        if (!originalEl) return { generalSelector: "" };

        let element = originalEl;

        if (element.tagName === "TD" || element.tagName === "TH") {
          const tableParent = element.closest("table");
          if (tableParent) {
            element = tableParent;
          }
        }

        const generalSelector = getXPathSelectorPath(element);
        return { generalSelector };
      } else {
        // Similar logic for when listSelector exists
        const getDeepestElementFromPoint = (
          x: number,
          y: number
        ): HTMLElement | null => {
          let elements = iframeDoc.elementsFromPoint(x, y) as HTMLElement[];
          if (!elements.length) return null;

          const findDeepestElement = (
            elements: HTMLElement[]
          ): HTMLElement | null => {
            if (!elements.length) return null;
            if (elements.length === 1) return elements[0];

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

          deepestElement = traverseShadowDOM(deepestElement);
          return deepestElement;
        };

        function generateRelativeXPathSelector(element: HTMLElement): string {
          let xpath = element.tagName.toLowerCase();

          if (xpath === "td" && element.parentElement) {
            const siblings = Array.from(element.parentElement.children);
            const position = siblings.indexOf(element) + 1;
            return `${xpath}[${position}]`;
          }

          const className =
            typeof element.className === "string" ? element.className : "";

          if (element.parentElement) {
            const allSiblings = Array.from(element.parentElement.children);
            const sameTagSiblings = allSiblings.filter(
              (sibling) => sibling.tagName === element.tagName
            );

            if (sameTagSiblings.length > 1) {
              // Multiple siblings with same tag - MUST use position
              const position = sameTagSiblings.indexOf(element) + 1;

              if (className) {
                const classes = className
                  .split(/\s+/)
                  .filter((cls: string) => Boolean(cls))
                  .filter(
                    (cls: string) => !cls.startsWith("!") && !cls.includes(":")
                  );

                if (classes.length > 0) {
                  const classPredicates = classes
                    .map((cls) => `contains(@class,'${cls}')`)
                    .join(" and ");
                  xpath += `[${classPredicates}][${position}]`;
                } else {
                  xpath += `[${position}]`;
                }
              } else {
                xpath += `[${position}]`;
              }
            } else {
              // Only one sibling with this tag - classes are sufficient
              if (className) {
                const classes = className
                  .split(/\s+/)
                  .filter((cls: string) => Boolean(cls))
                  .filter(
                    (cls: string) => !cls.startsWith("!") && !cls.includes(":")
                  );

                if (classes.length > 0) {
                  const classPredicates = classes
                    .map((cls) => `contains(@class,'${cls}')`)
                    .join(" and ");
                  xpath += `[${classPredicates}]`;
                }
              }
            }
          } else if (className) {
            // No parent but has classes
            const classes = className
              .split(/\s+/)
              .filter((cls: string) => Boolean(cls))
              .filter(
                (cls: string) => !cls.startsWith("!") && !cls.includes(":")
              );

            if (classes.length > 0) {
              const classPredicates = classes
                .map((cls) => `contains(@class,'${cls}')`)
                .join(" and ");
              xpath += `[${classPredicates}]`;
            }
          }

          return `./${xpath}`; // Make it relative
        }
        function getContextPath(element: HTMLElement): DOMContext[] {
          const path: DOMContext[] = [];
          let current = element;
          let depth = 0;
          const MAX_DEPTH = 4;

          while (current && depth < MAX_DEPTH) {
            const rootNode = current.getRootNode();
            if (rootNode instanceof ShadowRoot) {
              path.unshift({
                type: "shadow",
                element: current,
                container: rootNode,
                host: rootNode.host as HTMLElement,
              });
              current = rootNode.host as HTMLElement;
              depth++;
              continue;
            }
            break;
          }

          return path;
        }

        function getRelativeXPathSelectorPath(
          element: HTMLElement | null
        ): string {
          if (!element) return "";

          const contextPath = getContextPath(element);
          if (contextPath.length > 0) {
            const selectorParts: string[] = [];

            contextPath.forEach((context, index) => {
              const containerSelector = generateRelativeXPathSelector(
                context.host
              );

              if (index === contextPath.length - 1) {
                const elementSelector = generateRelativeXPathSelector(element);
                selectorParts.push(
                  `${containerSelector} >> ${elementSelector}`
                );
              } else {
                selectorParts.push(containerSelector);
              }
            });

            return selectorParts.join(" >> ");
          }

          const elementSelector = generateRelativeXPathSelector(element);
          return elementSelector;
        }

        const originalEl = getDeepestElementFromPoint(
          coordinates.x,
          coordinates.y
        );
        if (!originalEl) return { generalSelector: "" };

        let element = originalEl;
        const generalSelector = getRelativeXPathSelectorPath(element);
        return { generalSelector };
      }
    } catch (error) {
      console.error("Error in getNonUniqueSelectors:", error);
      return { generalSelector: "" };
    }
  };

  public getChildSelectors = (
    iframeDoc: Document,
    parentSelector: string
  ): string[] => {
    try {
      // Use XPath evaluation to find parent elements
      let parentElements: HTMLElement[] = [];

      if (parentSelector.includes(">>")) {
        // Handle shadow DOM
        const selectorParts = parentSelector
          .split(">>")
          .map((part) => part.trim());

        // Evaluate the first part with XPath
        parentElements = this.evaluateXPath(selectorParts[0], iframeDoc);

        // Handle shadow DOM traversal
        for (let i = 1; i < selectorParts.length; i++) {
          const newParentElements: HTMLElement[] = [];
          for (const element of parentElements) {
            if (element.shadowRoot) {
              const shadowChildren = this.evaluateXPath(
                selectorParts[i],
                element.shadowRoot as any
              );
              newParentElements.push(...shadowChildren);
            }
          }
          parentElements = newParentElements;
        }
      } else {
        // Use XPath evaluation directly for regular DOM
        parentElements = this.evaluateXPath(parentSelector, iframeDoc);
      }

      if (parentElements.length === 0) {
        console.warn("No parent elements found for selector:", parentSelector);
        return [];
      }

      const allChildSelectors = new Set<string>();

      parentElements.forEach((parentElement) => {
        const childSelectors = this.generateAbsoluteChildXPaths(
          parentElement,
          parentSelector
        );
        childSelectors.forEach((selector) => allChildSelectors.add(selector));
      });

      // Convert Set back to array to get unique selectors
      const childSelectors = Array.from(allChildSelectors);

      return childSelectors;
    } catch (error) {
      console.error("Error in optimized getChildSelectors:", error);
      return [];
    }
  };

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
    return selector.startsWith('//') || 
      selector.startsWith('/') || 
      selector.startsWith('./') ||
      selector.includes('contains(@') ||
      selector.includes('[count(') ||
      selector.includes('@class=') ||
      selector.includes('@id=') ||
      selector.includes(' and ') ||
      selector.includes(' or ');
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

  private generateAbsoluteChildXPaths(
    parentElement: HTMLElement,
    listSelector: string
  ): string[] {
    const selectors: string[] = [];
    const processedElements = new Set<HTMLElement>();

    // More efficient traversal - use querySelectorAll to get all descendants at once
    const allDescendants = Array.from(
      parentElement.querySelectorAll("*")
    ) as HTMLElement[];

    allDescendants.forEach((descendant, index) => {
      if (processedElements.has(descendant)) return;
      processedElements.add(descendant);

      const absolutePath = this.buildAbsoluteXPath(
        descendant,
        listSelector,
        parentElement
      );

      if (absolutePath) {
        selectors.push(absolutePath);
      }
    });

    // Handle shadow DOM descendants
    const shadowElements = this.getShadowDOMDescendants(parentElement);
    shadowElements.forEach((shadowElement) => {
      const shadowPath = this.buildAbsoluteXPath(
        shadowElement,
        listSelector,
        parentElement
      );
      if (shadowPath) {
        selectors.push(shadowPath);
      }
    });

    return selectors;
  }

  private getShadowDOMDescendants(element: HTMLElement): HTMLElement[] {
    const shadowDescendants: HTMLElement[] = [];

    const traverse = (el: HTMLElement) => {
      if (el.shadowRoot) {
        const shadowElements = Array.from(
          el.shadowRoot.querySelectorAll("*")
        ) as HTMLElement[];
        shadowDescendants.push(...shadowElements);

        // Recursively check shadow elements for more shadow roots
        shadowElements.forEach((shadowEl) => traverse(shadowEl));
      }
    };

    traverse(element);
    return shadowDescendants;
  }

  private buildAbsoluteXPath(
    targetElement: HTMLElement,
    listSelector: string,
    listElement: HTMLElement
  ): string | null {
    try {
      // Start with the list selector as base
      let xpath = listSelector;

      // Build path from list element to target element
      const pathFromList = this.getStructuralPath(targetElement, listElement);

      if (!pathFromList) return null;

      // Append the structural path to the list selector
      return xpath + pathFromList;
    } catch (error) {
      console.error("Error building absolute XPath:", error);
      return null;
    }
  }

  private getStructuralPath(
    targetElement: HTMLElement,
    rootElement: HTMLElement
  ): string | null {
    if (!rootElement.contains(targetElement) || targetElement === rootElement) {
      return null;
    }

    const pathParts: string[] = [];
    let current = targetElement;

    // Build path from target up to root
    while (current && current !== rootElement && current.parentElement) {
      const pathPart = this.generateStructuralStep(current);
      if (pathPart) {
        pathParts.unshift(pathPart);
      }
      current = current.parentElement;
    }

    return pathParts.length > 0 ? "/" + pathParts.join("/") : null;
  }

  private generateStructuralStep(element: HTMLElement): string {
    const tagName = element.tagName.toLowerCase();

    if (!element.parentElement) {
      return tagName;
    }

    // Get all sibling elements with the same tag name
    const siblings = Array.from(element.parentElement.children).filter(
      (sibling) => sibling.tagName === element.tagName
    );

    if (siblings.length === 1) {
      // Only one element with this tag - no position needed
      return tagName;
    } else {
      // Multiple elements with same tag - use position
      const position = siblings.indexOf(element) + 1;
      return `${tagName}[${position}]`;
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
    elementInfo: ElementInfo | null;
    childSelectors?: string[];
    groupInfo?: {
      isGroupElement: boolean;
      groupSize: number;
      groupElements: HTMLElement[];
      groupFingerprint: ElementFingerprint;
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

      let displaySelector: string | null;
      let childSelectors: string[] = [];

      if (this.getList === true && this.listSelector !== "") {
        childSelectors =
          cachedChildSelectors.length > 0
            ? cachedChildSelectors
            : this.getChildSelectors(iframeDocument, this.listSelector);
      }

      if (isGroupElement && this.getList === true && this.listSelector === "") {
        displaySelector = this.generateGroupContainerSelector(elementGroup!);

        return {
          rect,
          selector: displaySelector,
          elementInfo,
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
        // For child elements within a list, find the matching absolute XPath
        displaySelector = this.findMatchingAbsoluteXPath(
          elementAtPoint,
          childSelectors,
          this.listSelector,
          iframeDocument
        );
      } else {
        // Fall back to regular selector generation for non-list elements
        displaySelector = this.generateSelector(
          iframeDocument,
          coordinates,
          ActionType.Click
        );
      }

      if (!displaySelector) {
        return null;
      }

      return {
        rect,
        selector: displaySelector,
        elementInfo,
        childSelectors: childSelectors.length > 0 ? childSelectors : undefined,
        groupInfo: isGroupElement
          ? {
              isGroupElement: true,
              groupSize: elementGroup!.elements.length,
              groupElements: elementGroup!.elements,
              groupFingerprint: elementGroup!.fingerprint,
            }
          : undefined,
      };
    } catch (error) {
      console.error("Error generating highlighter data:", error);
      return null;
    }
  }

  private findMatchingAbsoluteXPath(
    targetElement: HTMLElement,
    childSelectors: string[],
    listSelector: string,
    iframeDocument: Document
  ): string | null {
    try {
      // Use XPath evaluation directly instead of CSS conversion
      const parentElements = this.evaluateXPath(listSelector, iframeDocument);

      const containingParent = parentElements.find((parent) =>
        parent.contains(targetElement)
      );

      if (!containingParent) {
        console.warn("Could not find containing parent for target element");
        return null;
      }

      // Get the structural path from parent to target
      const structuralPath = this.getStructuralPath(
        targetElement,
        containingParent
      );

      if (!structuralPath) {
        console.warn("Could not determine structural path");
        return null;
      }

      // Construct the absolute XPath
      const absoluteXPath = listSelector + structuralPath;

      // Check if this XPath exists in our child selectors
      const matchingSelector = childSelectors.find(
        (selector) =>
          selector === absoluteXPath ||
          this.isEquivalentXPath(selector, absoluteXPath)
      );

      if (matchingSelector) {
        return matchingSelector;
      }

      // If no exact match, find the closest matching selector
      const closestMatch = this.findClosestXPathMatch(
        absoluteXPath,
        childSelectors
      );

      if (closestMatch) {
        return closestMatch;
      }

      return absoluteXPath;
    } catch (error) {
      console.error("Error finding matching absolute XPath:", error);
      return null;
    }
  }

  private isEquivalentXPath(xpath1: string, xpath2: string): boolean {
    // Normalize both XPaths for comparison
    const normalize = (xpath: string) => {
      return xpath
        .replace(/\s+/g, " ") // Normalize whitespace
        .replace(
          /\[\s*contains\s*\(\s*@class\s*,\s*'([^']+)'\s*\)\s*\]/g,
          "[contains(@class,'$1')]"
        ) // Normalize class predicates
        .trim();
    };

    return normalize(xpath1) === normalize(xpath2);
  }

  private findClosestXPathMatch(
    targetXPath: string,
    candidateSelectors: string[]
  ): string | null {
    // Extract the path components for comparison
    const getPathComponents = (xpath: string) => {
      // Remove the list selector prefix and get just the relative path
      const pathMatch = xpath.match(/\/([^\/].*)$/);
      return pathMatch ? pathMatch[1].split("/") : [];
    };

    const targetComponents = getPathComponents(targetXPath);

    let bestMatch = null;
    let bestScore = 0;

    for (const selector of candidateSelectors) {
      const selectorComponents = getPathComponents(selector);

      // Calculate similarity score
      const commonLength = Math.min(
        targetComponents.length,
        selectorComponents.length
      );
      let score = 0;

      for (let i = 0; i < commonLength; i++) {
        if (targetComponents[i] === selectorComponents[i]) {
          score++;
        } else {
          // Check if they're the same tag with different positions
          const targetTag = targetComponents[i].replace(/\[\d+\]/, "");
          const selectorTag = selectorComponents[i].replace(/\[\d+\]/, "");
          if (targetTag === selectorTag) {
            score += 0.5; // Partial match for same tag
          }
          break; // Stop at first mismatch
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = selector;
      }
    }

    // Only return a match if we have reasonable confidence
    return bestScore >= targetComponents.length * 0.7 ? bestMatch : null;
  }

  /**
   * Generate XPath that matches ALL group elements and ONLY group elements
   */
  private generateGroupContainerSelector(group: ElementGroup): string {
    const { elements } = group;

    if (!elements || elements.length === 0) return "";

    // 1. Tag name (ensure all tags match first)
    const tagName = elements[0].tagName.toLowerCase();
    if (!elements.every((el) => el.tagName.toLowerCase() === tagName)) {
      throw new Error("Inconsistent tag names in group.");
    }

    let xpath = `//${tagName}`;
    const predicates: string[] = [];

    // 2. Get common classes
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

    // 3. Get common attributes (excluding id, style, dynamic ones)
    const commonAttributes = this.getCommonAttributes(elements, [
      "id",
      "style",
    ]);
    for (const [attr, value] of Object.entries(commonAttributes)) {
      predicates.push(`@${attr}='${value}'`);
    }

    // 4. Optional: Common child count
    const childrenCountSet = new Set(elements.map((el) => el.children.length));
    if (childrenCountSet.size === 1) {
      predicates.push(`count(*)=${[...childrenCountSet][0]}`);
    }

    // 5. Build XPath
    if (predicates.length > 0) {
      xpath += `[${predicates.join(" and ")}]`;
    }

    // 6. Post-validate that XPath matches all elements
    const matched = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null
    );
    const matchedSet = new Set<HTMLElement>();
    for (let i = 0; i < matched.snapshotLength; i++) {
      matchedSet.add(matched.snapshotItem(i) as HTMLElement);
    }
  
    return xpath;
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
      if (excludeAttrs.includes(attr.name)) continue;
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
   * Get deepest element from a list of elements
   */
  private getDeepestElementFromPoint(
    elements: HTMLElement[]
  ): HTMLElement | null {
    if (!elements.length) return null;
    if (elements.length === 1) return elements[0];

    let deepestElement = elements[0];
    let maxDepth = 0;

    for (const element of elements) {
      const depth = this.getElementDepth(element);
      if (depth > maxDepth) {
        maxDepth = depth;
        deepestElement = element;
      }
    }

    return deepestElement;
  }

  /**
   * Clean up when component unmounts or mode changes
   */
  public cleanup(): void {
    this.elementGroups.clear();
    this.groupedElements.clear();
    this.lastAnalyzedDocument = null;
  }

  // Update generateSelector to use instance variables
  public generateSelector(
    iframeDocument: Document,
    coordinates: Coordinates,
    action: ActionType
  ): string | null {
    const elementInfo = this.getElementInformation(
      iframeDocument,
      coordinates,
      '',
      false
    );

    const selectorBasedOnCustomAction = this.getSelectors(iframeDocument, coordinates);

    if (this.paginationMode && selectorBasedOnCustomAction) {
      // Chain selectors in specific priority order
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

      return selectorChain;
    }

    const bestSelector = this.getBestSelectorForAction({
      type: action,
      tagName: (elementInfo?.tagName as TagName) || TagName.A,
      inputType: undefined,
      value: undefined,
      selectors: selectorBasedOnCustomAction || {},
      timestamp: 0,
      isPassword: false,
      hasOnlyText: elementInfo?.hasOnlyText || false,
    } as Action);

    return bestSelector;
  }
}

export const clientSelectorGenerator = new ClientSelectorGenerator();
