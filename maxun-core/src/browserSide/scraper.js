/* eslint-disable @typescript-eslint/no-unused-vars */

const area = (element) => element.offsetHeight * element.offsetWidth;

function getBiggestElement(selector) {
  const elements = Array.from(document.querySelectorAll(selector));
  const biggest = elements.reduce(
    (max, elem) => (
      area(elem) > area(max) ? elem : max),
    { offsetHeight: 0, offsetWidth: 0 },
  );
  return biggest;
}

/**
 * Generates structural selector (describing element by its DOM tree location).
 *
 * **The generated selector is not guaranteed to be unique!** (In fact, this is
 *    the desired behaviour in here.)
 * @param {HTMLElement} element Element being described.
 * @returns {string} CSS-compliant selector describing the element's location in the DOM tree.
 */
function GetSelectorStructural(element) {
  // Base conditions for the recursive approach.
  if (element.tagName === 'BODY') {
    return 'BODY';
  }
  const selector = element.tagName;
  if (element.parentElement) {
    return `${GetSelectorStructural(element.parentElement)} > ${selector}`;
  }

  return selector;
}

/**
 * Heuristic method to find collections of "interesting" items on the page.
 * @returns {Array<HTMLElement>} A collection of interesting DOM nodes
 *  (online store products, plane tickets, list items... and many more?)
 */
function scrapableHeuristics(maxCountPerPage = 50, minArea = 20000, scrolls = 3, metricType = 'size_deviation') {
  const restoreScroll = (() => {
    const { scrollX, scrollY } = window;
    return () => {
      window.scrollTo(scrollX, scrollY);
    };
  })();

  /**
* @typedef {Array<{x: number, y: number}>} Grid
*/

  /**
 * Returns an array of grid-aligned {x,y} points.
 * @param {number} [granularity=0.005] sets the number of generated points
 *  (the higher the granularity, the more points).
 * @returns {Grid} Array of {x, y} objects.
 */
  function getGrid(startX = 0, startY = 0, granularity = 0.005) {
    const width = window.innerWidth;
    const height = window.innerHeight;

    const out = [];
    for (let x = 0; x < width; x += 1 / granularity) {
      for (let y = 0; y < height; y += 1 / granularity) {
        out.push({ x: startX + x, y: startY + y });
      }
    }
    return out;
  }

  let maxSelector = { selector: 'body', metric: 0 };

  const updateMaximumWithPoint = (point) => {
    const currentElement = document.elementFromPoint(point.x, point.y);
    const selector = GetSelectorStructural(currentElement);

    const elements = Array.from(document.querySelectorAll(selector))
      .filter((element) => area(element) > minArea);

    // If the current selector targets less than three elements,
    // we consider it not interesting (would be a very underwhelming scraper)
    if (elements.length < 3) {
      return;
    }

    let metric = null;

    if (metricType === 'total_area') {
      metric = elements
        .reduce((p, x) => p + area(x), 0);
    } else if (metricType === 'size_deviation') {
      // This could use a proper "statistics" approach... but meh, so far so good!
      const sizes = elements
        .map((element) => area(element));

      metric = (1 - (Math.max(...sizes) - Math.min(...sizes)) / Math.max(...sizes));
    }

    if (metric > maxSelector.metric && elements.length < maxCountPerPage) {
      maxSelector = { selector, metric };
    }
  };

  for (let scroll = 0; scroll < scrolls; scroll += 1) {
    window.scrollTo(0, scroll * window.innerHeight);

    const grid = getGrid();

    grid.forEach(updateMaximumWithPoint);
  }

  restoreScroll();

  let out = Array.from(document.querySelectorAll(maxSelector.selector));

  const different = (x, i, a) => a.findIndex((e) => e === x) === i;
  // as long as we don't merge any two elements by substituing them for their parents,
  // we substitute.
  while (out.map((x) => x.parentElement).every(different)
    && out.forEach((x) => x.parentElement !== null)) {
    out = out.map((x) => x.parentElement ?? x);
  }

  return out;
}

/**
 * Returns a "scrape" result from the current page.
 * @returns {Array<Object>} *Curated* array of scraped information (with sparse rows removed)
 */
// Wrap the entire function in an IIFE (Immediately Invoked Function Expression)
// and attach it to the window object
(function (window) {
  /**
   * Returns a "scrape" result from the current page.
   * @returns {Array<Object>} *Curated* array of scraped information (with sparse rows removed)
   */
  window.scrape = function (selector = null) {
    /**
     * **crudeRecords** contains uncurated rundowns of "scrapable" elements
     * @type {Array<Object>}
     */
    const crudeRecords = (selector
      ? Array.from(document.querySelectorAll(selector))
      : scrapableHeuristics())
      .map((record) => ({
        ...Array.from(record.querySelectorAll('img'))
          .reduce((p, x, i) => {
            let url = null;
            if (x.srcset) {
              const urls = x.srcset.split(', ');
              [url] = urls[urls.length - 1].split(' ');
            }

            /**
               * Contains the largest elements from `srcset` - if `srcset` is not present, contains
               * URL from the `src` attribute
               *
               * If the `src` attribute contains a data url, imgUrl contains `undefined`.
               */
            let imgUrl;
            if (x.srcset) {
              imgUrl = url;
            } else if (x.src.indexOf('data:') === -1) {
              imgUrl = x.src;
            }

            return ({
              ...p,
              ...(imgUrl ? { [`img_${i}`]: imgUrl } : {}),
            });
          }, {}),
        ...record.innerText.split('\n')
          .reduce((p, x, i) => ({
            ...p,
            [`record_${String(i).padStart(4, '0')}`]: x.trim(),
          }), {}),
      }));

    return crudeRecords;
  };

  /**
   * TODO: Simplify.
   * Given an object with named lists of elements,
   *  groups the elements by their distance in the DOM tree.
   * @param {Object.<string, {selector: string, tag: string}>} lists The named lists of HTML elements.
   * @returns {Array.<Object.<string, string>>}
   */
  window.scrapeSchema = function(lists) {
    // Utility functions remain the same
    function omap(object, f, kf = (x) => x) {
      return Object.fromEntries(
        Object.entries(object)
            .map(([k, v]) => [kf(k), f(v)]),
      );
    }

    function ofilter(object, f) {
      return Object.fromEntries(
        Object.entries(object)
            .filter(([k, v]) => f(k, v)),
      );
    }

    function findAllElements(config) {
      // Regular DOM query if no special delimiters
      if (!config.selector.includes('>>') && !config.selector.includes(':>>')) {
          return Array.from(document.querySelectorAll(config.selector));
      }
  
      if (config.selector.includes(':>>')) {
        const parts = config.selector.split(':>>').map(s => s.trim());
        let currentElements = [document];

        // Traverse through each part of the selector
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const nextElements = [];
            const isLast = i === parts.length - 1;

            for (const element of currentElements) {
                try {
                    const doc = element.contentDocument || element || element.contentWindow?.document;
                    if (!doc) continue;

                    if (part.startsWith('frame[name=') || part.startsWith('iframe[name=')) {
                        const nameMatch = part.match(/\[name=['"]([^'"]+)['"]\]/);
                        if (nameMatch && nameMatch[1]) {
                            const frameName = nameMatch[1];
                            let foundFrames = [];
                            
                            if (doc.getElementsByName && typeof doc.getElementsByName === 'function') {
                                foundFrames = Array.from(doc.getElementsByName(frameName))
                                    .filter(el => el.tagName === 'FRAME' || el.tagName === 'IFRAME');
                            }
                            
                            if (foundFrames.length === 0) {
                                const framesBySelector = Array.from(doc.querySelectorAll(`frame[name="${frameName}"], iframe[name="${frameName}"]`));
                                foundFrames = framesBySelector;
                            }
                            
                            if (isLast) {
                                nextElements.push(...foundFrames);
                            } else {
                                nextElements.push(...foundFrames);
                            }
                            continue;
                        }
                    }

                    const found = Array.from(doc.querySelectorAll(part));
                    
                    if (isLast) {
                        nextElements.push(...found);
                    } else {
                        const frames = found.filter(el => el.tagName === 'IFRAME' || el.tagName === 'FRAME');
                        nextElements.push(...frames);
                    }
                } catch (error) {
                    console.warn('Cannot access iframe/frame content:', error, {
                        part,
                        element,
                        index: i
                    });
                }
            }

            if (nextElements.length === 0) {
                console.warn('No elements found for part:', part, 'at depth:', i);
                return [];
            }
            currentElements = nextElements;
        }

        return currentElements;
      }
  
      // Handle shadow DOM traversal
      if (config.selector.includes('>>')) {
          const parts = config.selector.split('>>').map(s => s.trim());
          let currentElements = [document];
  
          for (const part of parts) {
              const nextElements = [];
              for (const element of currentElements) {
                  // Try regular DOM first
                  const found = Array.from(element.querySelectorAll(part));
                  
                  // Then check shadow roots
                  for (const foundEl of found) {
                      if (foundEl.shadowRoot) {
                          nextElements.push(foundEl.shadowRoot);
                      } else {
                          nextElements.push(foundEl);
                      }
                  }
              }
              currentElements = nextElements;
          }
          return currentElements.filter(el => !(el instanceof ShadowRoot));
      }
  
      return [];
    }

    function getElementValue(element, attribute) {
      if (!element) return null;
  
      let baseURL;
      try {
          baseURL = element.ownerDocument?.location?.href || 
                    element.ownerDocument?.baseURI || 
                    window.location.origin;
      } catch (e) {
          baseURL = window.location.origin;
      }
  
      switch (attribute) {
        case 'href': {
            const relativeHref = element.getAttribute('href');
            return relativeHref ? new URL(relativeHref, baseURL).href : null;
        }
        case 'src': {
            const relativeSrc = element.getAttribute('src');
            return relativeSrc ? new URL(relativeSrc, baseURL).href : null;
        }
        case 'innerText':
            return element.innerText?.trim();
        case 'textContent':
            return element.textContent?.trim();
        case 'innerHTML':
            return element.innerHTML;
        case 'outerHTML':
            return element.outerHTML;
        default:
            return element.getAttribute(attribute) || element.innerText?.trim();
      }
    }

    // Rest of the functions remain largely the same
    function getSeedKey(listObj) {
      const maxLength = Math.max(...Object.values(
          omap(listObj, (x) => findAllElements(x).length)
      ));
      return Object.keys(
          ofilter(listObj, (_, v) => findAllElements(v).length === maxLength)
      )[0];
    }

    // Find minimal bounding elements
    function getMBEs(elements) {
      return elements.map((element) => {
        let candidate = element;
        const isUniqueChild = (e) => elements
          .filter((elem) => {
            // Handle both iframe and shadow DOM boundaries
            const sameContext = elem.getRootNode() === e.getRootNode() && 
                              elem.ownerDocument === e.ownerDocument;
            return sameContext && e.parentNode?.contains(elem);
          })
          .length === 1;
  
        while (candidate && isUniqueChild(candidate)) {
          candidate = candidate.parentNode;
        }
  
        return candidate;
      });
    }

    const seedName = getSeedKey(lists);
    const seedElements = findAllElements(lists[seedName]);
    const MBEs = getMBEs(seedElements);
    
    const mbeResults = MBEs.map((mbe) => omap(
        lists,
        (config) => {
            const elem = findAllElements(config)
                .find((elem) => mbe.contains(elem));
            
            return elem ? getElementValue(elem, config.attribute) : undefined;
        },
        (key) => key
    )) || [];

    // If MBE approach didn't find all elements, try independent scraping
    if (mbeResults.some(result => Object.values(result).some(v => v === undefined))) {
        // Fall back to independent scraping
        const results = [];
        const foundElements = new Map();

        // Find all elements for each selector
        Object.entries(lists).forEach(([key, config]) => {
            const elements = findAllElements(config);
            foundElements.set(key, elements);
        });

        // Create result objects for each found element
        foundElements.forEach((elements, key) => {
            elements.forEach((element, index) => {
                if (!results[index]) {
                    results[index] = {};
                }
                results[index][key] = getElementValue(element, lists[key].attribute);
            });
        });

        return results.filter(result => Object.keys(result).length > 0);
    }

    return mbeResults;
  };

  /**
 * Scrapes multiple lists of similar items based on a template item.
 * @param {Object} config - Configuration object
 * @param {string} config.listSelector - Selector for the list container(s)
 * @param {Object.<string, {selector: string, attribute?: string}>} config.fields - Fields to scrape
 * @param {number} [config.limit] - Maximum number of items to scrape per list (optional)
 * @param {boolean} [config.flexible=false] - Whether to use flexible matching for field selectors
 * @returns {Array.<Array.<Object>>} Array of arrays of scraped items, one sub-array per list
 */
  window.scrapeList = async function ({ listSelector, fields, limit = 10 }) {
    // XPath evaluation functions
    const queryInsideContext = (context, part) => {
      try {
        const { tagName, conditions } = parseXPathPart(part);

        const candidateElements = Array.from(context.querySelectorAll(tagName));
        if (candidateElements.length === 0) {
          return [];
        }

        const matchingElements = candidateElements.filter((el) => {
          return elementMatchesConditions(el, conditions);
        });

        return matchingElements;
      } catch (err) {
        console.error("Error in queryInsideContext:", err);
        return [];
      }
    };

    // Helper function to parse XPath part
    const parseXPathPart = (part) => {
      const tagMatch = part.match(/^([a-zA-Z0-9-]+)/);
      const tagName = tagMatch ? tagMatch[1] : "*";

      const conditionMatches = part.match(/\[([^\]]+)\]/g);
      const conditions = conditionMatches
        ? conditionMatches.map((c) => c.slice(1, -1))
        : [];

      return { tagName, conditions };
    };

    // Helper function to check if element matches all conditions
    const elementMatchesConditions = (element, conditions) => {
      for (const condition of conditions) {
        if (!elementMatchesCondition(element, condition)) {
          return false;
        }
      }
      return true;
    };

    // Helper function to check if element matches a single condition
    const elementMatchesCondition = (element, condition) => {
      condition = condition.trim();

      if (/^\d+$/.test(condition)) {
        return true;
      }

      // Handle @attribute="value"
      const attrMatch = condition.match(/^@([^=]+)=["']([^"']+)["']$/);
      if (attrMatch) {
        const [, attr, value] = attrMatch;
        const elementValue = element.getAttribute(attr);
        return elementValue === value;
      }

      // Handle contains(@class, 'value')
      const classContainsMatch = condition.match(
        /^contains\(@class,\s*["']([^"']+)["']\)$/
      );
      if (classContainsMatch) {
        const className = classContainsMatch[1];
        return element.classList.contains(className);
      }

      // Handle contains(@attribute, 'value')
      const attrContainsMatch = condition.match(
        /^contains\(@([^,]+),\s*["']([^"']+)["']\)$/
      );
      if (attrContainsMatch) {
        const [, attr, value] = attrContainsMatch;
        const elementValue = element.getAttribute(attr) || "";
        return elementValue.includes(value);
      }

      // Handle text()="value"
      const textMatch = condition.match(/^text\(\)=["']([^"']+)["']$/);
      if (textMatch) {
        const expectedText = textMatch[1];
        const elementText = element.textContent?.trim() || "";
        return elementText === expectedText;
      }

      // Handle contains(text(), 'value')
      const textContainsMatch = condition.match(
        /^contains\(text\(\),\s*["']([^"']+)["']\)$/
      );
      if (textContainsMatch) {
        const expectedText = textContainsMatch[1];
        const elementText = element.textContent?.trim() || "";
        return elementText.includes(expectedText);
      }

      // Handle count(*)=0 (element has no children)
      if (condition === "count(*)=0") {
        return element.children.length === 0;
      }

      // Handle other count conditions
      const countMatch = condition.match(/^count\(\*\)=(\d+)$/);
      if (countMatch) {
        const expectedCount = parseInt(countMatch[1]);
        return element.children.length === expectedCount;
      }

      return true;
    };

    const evaluateXPath = (document, xpath, isShadow = false) => {
      try {
        if (!document || !xpath) {
          console.warn('Invalid document or xpath provided to evaluateXPath');
          return null;
        }
        
        const result = document.evaluate(
          xpath,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        ).singleNodeValue;

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

        let currentContexts = [document];

        for (let i = 0; i < pathParts.length; i++) {
          const part = pathParts[i];
          const nextContexts = [];

          for (const ctx of currentContexts) {
            const positionalMatch = part.match(/^([^[]+)\[(\d+)\]$/);
            let partWithoutPosition = part;
            let requestedPosition = null;

            if (positionalMatch) {
              partWithoutPosition = positionalMatch[1];
              requestedPosition = parseInt(positionalMatch[2]);
            }

            const matched = queryInsideContext(ctx, partWithoutPosition);

            let elementsToAdd = matched;
            if (requestedPosition !== null) {
              const index = requestedPosition - 1; // XPath is 1-based, arrays are 0-based
              if (index >= 0 && index < matched.length) {
                elementsToAdd = [matched[index]];
              } else {
                console.warn(
                  `Position ${requestedPosition} out of range (${matched.length} elements found)`
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
            const requestedIndex = parseInt(indexedMatch[2]) - 1;
            if (requestedIndex >= 0 && requestedIndex < currentContexts.length) {
              return currentContexts[requestedIndex];
            } else {
              console.warn(
                `Requested index ${requestedIndex + 1} out of range (${currentContexts.length} elements found)`
              );
              return null;
            }
          }

          return currentContexts[0];
        }

        return null;
      } catch (err) {
        console.error("Critical XPath failure:", xpath, err);
        // Return null instead of throwing to prevent crashes
        return null;
      }
    };

    const evaluateXPathAll = (rootElement, xpath) => {
      try {
        const ownerDoc =
          rootElement.nodeType === Node.DOCUMENT_NODE
            ? rootElement
            : rootElement.ownerDocument;

        if (!ownerDoc) return [];

        const result = ownerDoc.evaluate(
          xpath,
          rootElement,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null
        );

        const elements = [];
        for (let i = 0; i < result.snapshotLength; i++) {
          const node = result.snapshotItem(i);
          if (node && node.nodeType === Node.ELEMENT_NODE) {
            elements.push(node);
          }
        }

        return elements;
      } catch (error) {
        console.warn("XPath evaluation failed:", xpath, error);
        return [];
      }
    };

    // Helper function to detect selector type
    const isXPathSelector = (selector) => {
      return (
        selector.startsWith("//") ||
        selector.startsWith("/") ||
        selector.startsWith("./")
      );
    };

    // Enhanced query function to handle iframe, frame, shadow DOM, CSS selectors, and XPath
    const queryElement = (rootElement, selector) => {
      if (!selector.includes(">>") && !selector.includes(":>>")) {
        // Check if it's an XPath selector
        if (isXPathSelector(selector)) {
          return evaluateXPath(rootElement, selector);
        } else {
          return rootElement.querySelector(selector);
        }
      }

      const parts = selector.split(/(?:>>|:>>)/).map((part) => part.trim());
      let currentElement = rootElement;

      for (let i = 0; i < parts.length; i++) {
        if (!currentElement) return null;

        // Handle iframe and frame traversal with enhanced safety
        if (
          currentElement.tagName === "IFRAME" ||
          currentElement.tagName === "FRAME"
        ) {
          try {
            // Check if frame is accessible
            if (!currentElement.contentDocument && !currentElement.contentWindow) {
              console.warn('Frame is not accessible (cross-origin or unloaded)');
              return null;
            }
            
            const frameDoc =
              currentElement.contentDocument ||
              currentElement.contentWindow?.document;
            if (!frameDoc) {
              console.warn('Frame document is not available');
              return null;
            }

            if (isXPathSelector(parts[i])) {
              currentElement = evaluateXPath(frameDoc, parts[i]);
            } else {
              currentElement = frameDoc.querySelector(parts[i]);
            }
            continue;
          } catch (e) {
            console.warn(
              `Cannot access ${currentElement.tagName.toLowerCase()} content:`,
              e
            );
            return null;
          }
        }

        let nextElement = null;

        // Try regular DOM first
        if ("querySelector" in currentElement) {
          if (isXPathSelector(parts[i])) {
            nextElement = evaluateXPath(currentElement, parts[i]);
          } else {
            nextElement = currentElement.querySelector(parts[i]);
          }
        }

        // Try shadow DOM if not found
        if (
          !nextElement &&
          "shadowRoot" in currentElement &&
          currentElement.shadowRoot
        ) {
          if (isXPathSelector(parts[i])) {
            nextElement = evaluateXPath(currentElement.shadowRoot, parts[i]);
          } else {
            nextElement = currentElement.shadowRoot.querySelector(parts[i]);
          }
        }

        // Check children's shadow roots if still not found
        if (!nextElement && "children" in currentElement) {
          const children = Array.from(currentElement.children || []);
          for (const child of children) {
            if (child.shadowRoot) {
              if (isXPathSelector(parts[i])) {
                nextElement = evaluateXPath(child.shadowRoot, parts[i]);
              } else {
                nextElement = child.shadowRoot.querySelector(parts[i]);
              }
              if (nextElement) break;
            }
          }
        }

        currentElement = nextElement;
      }

      return currentElement;
    };

    // Enhanced query all function for both contexts
    const queryElementAll = (rootElement, selector) => {
      if (!selector.includes(">>") && !selector.includes(":>>")) {
        if (isXPathSelector(selector)) {
          return evaluateXPathAll(rootElement, selector);
        } else {
          return Array.from(rootElement.querySelectorAll(selector));
        }
      }

      const parts = selector.split(/(?:>>|:>>)/).map((part) => part.trim());
      let currentElements = [rootElement];

      for (const part of parts) {
        const nextElements = [];

        for (const element of currentElements) {
          // Handle iframe and frame traversal
          if (element.tagName === "IFRAME" || element.tagName === "FRAME") {
            try {
              const frameDoc =
                element.contentDocument || element.contentWindow.document;
              if (frameDoc) {
                if (isXPathSelector(part)) {
                  nextElements.push(...evaluateXPathAll(frameDoc, part));
                } else {
                  nextElements.push(
                    ...Array.from(frameDoc.querySelectorAll(part))
                  );
                }
              }
            } catch (e) {
              console.warn(
                `Cannot access ${element.tagName.toLowerCase()} content:`,
                e
              );
              continue;
            }
          } else {
            // Regular DOM elements
            if (element.querySelectorAll) {
              if (isXPathSelector(part)) {
                nextElements.push(...evaluateXPathAll(element, part));
              } else {
                nextElements.push(
                  ...Array.from(element.querySelectorAll(part))
                );
              }
            }

            // Shadow DOM elements
            if (element.shadowRoot) {
              if (isXPathSelector(part)) {
                nextElements.push(
                  ...evaluateXPathAll(element.shadowRoot, part)
                );
              } else {
                nextElements.push(
                  ...Array.from(element.shadowRoot.querySelectorAll(part))
                );
              }
            }

            // Check children's shadow roots
            const children = Array.from(element.children || []);
            for (const child of children) {
              if (child.shadowRoot) {
                if (isXPathSelector(part)) {
                  nextElements.push(
                    ...evaluateXPathAll(child.shadowRoot, part)
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

        currentElements = nextElements;
      }

      return currentElements;
    };

    // Enhanced value extraction with context awareness
    const extractValue = (element, attribute) => {
      if (!element) return null;

      // Get context-aware base URL
      const baseURL =
        element.ownerDocument?.location?.href || window.location.origin;

      // Check shadow root first
      if (element.shadowRoot) {
        const shadowContent = element.shadowRoot.textContent;
        if (shadowContent?.trim()) {
          return shadowContent.trim();
        }
      }

      if (attribute === "innerText") {
        // First try standard innerText/textContent
        let textContent =
          element.innerText?.trim() || element.textContent?.trim();

        // If empty, check for common data attributes that might contain the text
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
            const style = window.getComputedStyle(element);
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

    // Enhanced table ancestor finding with context support
    const findTableAncestor = (element) => {
      let currentElement = element;
      const MAX_DEPTH = 5;
      let depth = 0;

      while (currentElement && depth < MAX_DEPTH) {
        // Handle shadow DOM
        if (currentElement.getRootNode() instanceof ShadowRoot) {
          currentElement = currentElement.getRootNode().host;
          continue;
        }

        if (currentElement.tagName === "TD") {
          return { type: "TD", element: currentElement };
        } else if (currentElement.tagName === "TR") {
          return { type: "TR", element: currentElement };
        }

        // Handle iframe and frame crossing
        if (
          currentElement.tagName === "IFRAME" ||
          currentElement.tagName === "FRAME"
        ) {
          try {
            currentElement = currentElement.contentDocument.body;
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

    // Helper function to get cell index
    const getCellIndex = (td) => {
      if (td.getRootNode() instanceof ShadowRoot) {
        const shadowRoot = td.getRootNode();
        const allCells = Array.from(shadowRoot.querySelectorAll("td"));
        return allCells.indexOf(td);
      }

      let index = 0;
      let sibling = td;
      while ((sibling = sibling.previousElementSibling)) {
        index++;
      }
      return index;
    };

    // Helper function to check for TH elements
    const hasThElement = (row, tableFields) => {
      for (const [_, { selector }] of Object.entries(tableFields)) {
        const element = queryElement(row, selector);
        if (element) {
          let current = element;
          while (current && current !== row) {
            if (current.getRootNode() instanceof ShadowRoot) {
              current = current.getRootNode().host;
              continue;
            }

            if (current.tagName === "TH") return true;

            if (current.tagName === "IFRAME" || current.tagName === "FRAME") {
              try {
                current = current.contentDocument.body;
              } catch (e) {
                break;
              }
            } else {
              current = current.parentElement;
            }
          }
        }
      }
      return false;
    };

    // Helper function to filter rows
    const filterRowsBasedOnTag = (rows, tableFields) => {
      for (const row of rows) {
        if (hasThElement(row, tableFields)) {
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

    // Class similarity comparison functions
    const calculateClassSimilarity = (classList1, classList2) => {
      const set1 = new Set(classList1);
      const set2 = new Set(classList2);
      const intersection = new Set([...set1].filter((x) => set2.has(x)));
      const union = new Set([...set1, ...set2]);
      return intersection.size / union.size;
    };

    // Enhanced similar elements finding with context support
    const findSimilarElements = (baseElement, similarityThreshold = 0.7) => {
      const baseClasses = Array.from(baseElement.classList);
      if (baseClasses.length === 0) return [];

      const allElements = [];

      // Get elements from main document
      allElements.push(...document.getElementsByTagName(baseElement.tagName));

      // Get elements from shadow DOM
      if (baseElement.getRootNode() instanceof ShadowRoot) {
        const shadowHost = baseElement.getRootNode().host;
        allElements.push(
          ...shadowHost.getElementsByTagName(baseElement.tagName)
        );
      }

      // Get elements from iframes and frames
      const frames = [
        ...Array.from(document.getElementsByTagName("iframe")),
        ...Array.from(document.getElementsByTagName("frame")),
      ];

      for (const frame of frames) {
        try {
          const frameDoc =
            frame.contentDocument || frame.contentWindow.document;
          allElements.push(
            ...frameDoc.getElementsByTagName(baseElement.tagName)
          );
        } catch (e) {
          console.warn(
            `Cannot access ${frame.tagName.toLowerCase()} content:`,
            e
          );
        }
      }

      return allElements.filter((element) => {
        if (element === baseElement) return false;
        const similarity = calculateClassSimilarity(
          baseClasses,
          Array.from(element.classList)
        );
        return similarity >= similarityThreshold;
      });
    };

    const tryFallbackSelector = (rootElement, originalSelector) => {
      let element = queryElement(rootElement, originalSelector);

      if (!element && originalSelector.includes("nth-child")) {
        const match = originalSelector.match(/nth-child\((\d+)\)/);
        if (match) {
          const position = parseInt(match[1], 10);

          for (let i = position - 1; i >= 1; i--) {
            const fallbackSelector = originalSelector.replace(
              /nth-child\(\d+\)/,
              `nth-child(${i})`
            );
            element = queryElement(rootElement, fallbackSelector);
            if (element) break;
          }

          if (!element) {
            const baseSelector = originalSelector.replace(
              /\:nth-child\(\d+\)/,
              ""
            );
            element = queryElement(rootElement, baseSelector);
          }
        }
      }

      return element;
    };

    // Create indexed XPath for specific container instance
    const createIndexedXPath = (
      childSelector,
      listSelector,
      containerIndex
    ) => {
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
        return `(${listSelector})[${containerIndex}]${childSelector.replace(
          "//",
          "/"
        )}`;
      }
    };

    // Main scraping logic with unified support for both CSS and XPath
    console.log("🚀 Starting unified list data extraction");
    console.log("List Selector:", listSelector);
    console.log("Fields:", fields);

    let containers = queryElementAll(document, listSelector);
    containers = Array.from(containers);

    if (containers.length === 0) {
      console.warn("❌ No containers found for listSelector:", listSelector);
      return [];
    }

    console.log(`📦 Found ${containers.length} list containers`);

    // For CSS selectors, try to find similar containers if needed
    if (
      !isXPathSelector(listSelector) &&
      limit > 1 &&
      containers.length === 1
    ) {
      const baseContainer = containers[0];
      const similarContainers = findSimilarElements(baseContainer);

      if (similarContainers.length > 0) {
        const newContainers = similarContainers.filter(
          (container) => !container.matches(listSelector)
        );
        containers = [...containers, ...newContainers];
      }
    }

    const containerFields = containers.map(() => ({
      tableFields: {},
      nonTableFields: {},
    }));

    // For XPath selectors, use the new approach
    if (isXPathSelector(listSelector)) {
      const extractedData = [];
      const containersToProcess = Math.min(containers.length, limit);

      for (
        let containerIndex = 0;
        containerIndex < containersToProcess;
        containerIndex++
      ) {
        const record = {};

        for (const [label, field] of Object.entries(fields)) {
          let element = null;

          if (isXPathSelector(field.selector)) {
            // Create indexed absolute XPath
            const indexedSelector = createIndexedXPath(
              field.selector,
              listSelector,
              containerIndex + 1
            );
            element = evaluateXPath(document, indexedSelector, field.isShadow);
          } else {
            // Fallback for CSS selectors within XPath containers
            const container = containers[containerIndex];
            element = queryElement(container, field.selector);
          }

          if (element) {
            const value = extractValue(element, field.attribute);
            if (value !== null && value !== "") {
              record[label] = value;
            } else {
              record[label] = "";
            }
          } else {
            record[label] = "";
          }
        }

        if (Object.values(record).some((value) => value !== "")) {
          extractedData.push(record);
        }
      }

      console.log(`📊 Total records extracted: ${extractedData.length}`);
      return extractedData;
    }

    // For CSS selectors, use the original table-aware approach
    containers.forEach((container, containerIndex) => {
      for (const [label, field] of Object.entries(fields)) {
        const sampleElement = queryElement(container, field.selector);

        if (sampleElement) {
          const ancestor = findTableAncestor(sampleElement);
          if (ancestor) {
            containerFields[containerIndex].tableFields[label] = {
              ...field,
              tableContext: ancestor.type,
              cellIndex:
                ancestor.type === "TD" ? getCellIndex(ancestor.element) : -1,
            };
          } else {
            containerFields[containerIndex].nonTableFields[label] = field;
          }
        } else {
          containerFields[containerIndex].nonTableFields[label] = field;
        }
      }
    });

    const tableData = [];
    const nonTableData = [];

    // Process table data with support for iframes, frames, and shadow DOM
    for (
      let containerIndex = 0;
      containerIndex < containers.length;
      containerIndex++
    ) {
      const container = containers[containerIndex];
      const { tableFields } = containerFields[containerIndex];

      if (Object.keys(tableFields).length > 0) {
        const firstField = Object.values(tableFields)[0];
        const firstElement = queryElement(container, firstField.selector);
        let tableContext = firstElement;

        // Find table context including iframe, frame and shadow DOM
        while (
          tableContext &&
          tableContext.tagName !== "TABLE" &&
          tableContext !== container
        ) {
          if (tableContext.getRootNode() instanceof ShadowRoot) {
            tableContext = tableContext.getRootNode().host;
            continue;
          }

          if (
            tableContext.tagName === "IFRAME" ||
            tableContext.tagName === "FRAME"
          ) {
            try {
              tableContext = tableContext.contentDocument.body;
            } catch (e) {
              break;
            }
          } else {
            tableContext = tableContext.parentElement;
          }
        }

        if (tableContext) {
          // Get rows from all contexts
          const rows = [];

          // Get rows from regular DOM
          rows.push(...tableContext.getElementsByTagName("TR"));

          // Get rows from shadow DOM
          if (tableContext.shadowRoot) {
            rows.push(...tableContext.shadowRoot.getElementsByTagName("TR"));
          }

          // Get rows from iframes and frames
          if (
            tableContext.tagName === "IFRAME" ||
            tableContext.tagName === "FRAME"
          ) {
            try {
              const frameDoc =
                tableContext.contentDocument ||
                tableContext.contentWindow.document;
              rows.push(...frameDoc.getElementsByTagName("TR"));
            } catch (e) {
              console.warn(
                `Cannot access ${tableContext.tagName.toLowerCase()} rows:`,
                e
              );
            }
          }

          const processedRows = filterRowsBasedOnTag(rows, tableFields);

          for (
            let rowIndex = 0;
            rowIndex < Math.min(processedRows.length, limit);
            rowIndex++
          ) {
            const record = {};
            const currentRow = processedRows[rowIndex];

            for (const [
              label,
              { selector, attribute, cellIndex },
            ] of Object.entries(tableFields)) {
              let element = null;

              if (cellIndex >= 0) {
                // Get TD element considering both contexts
                let td = currentRow.children[cellIndex];

                // Check shadow DOM for td
                if (!td && currentRow.shadowRoot) {
                  const shadowCells = currentRow.shadowRoot.children;
                  if (shadowCells && shadowCells.length > cellIndex) {
                    td = shadowCells[cellIndex];
                  }
                }

                if (td) {
                  element = queryElement(td, selector);

                  if (
                    !element &&
                    selector
                      .split(/(?:>>|:>>)/)
                      .pop()
                      .includes("td:nth-child")
                  ) {
                    element = td;
                  }

                  if (!element) {
                    const tagOnlySelector = selector.split(".")[0];
                    element = queryElement(td, tagOnlySelector);
                  }

                  if (!element) {
                    let currentElement = td;
                    while (
                      currentElement &&
                      currentElement.children.length > 0
                    ) {
                      let foundContentChild = false;
                      for (const child of currentElement.children) {
                        if (extractValue(child, attribute)) {
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
                element = queryElement(currentRow, selector);
              }

              if (element) {
                record[label] = extractValue(element, attribute);
              }
            }

            if (Object.keys(record).length > 0) {
              tableData.push(record);
            }
          }
        }
      }
    }

    // Process non-table data with all contexts support
    for (
      let containerIndex = 0;
      containerIndex < containers.length;
      containerIndex++
    ) {
      if (nonTableData.length >= limit) break;

      const container = containers[containerIndex];
      const { nonTableFields } = containerFields[containerIndex];

      if (Object.keys(nonTableFields).length > 0) {
        const record = {};

        for (const [label, { selector, attribute }] of Object.entries(
          nonTableFields
        )) {
          // Get the last part of the selector after any context delimiter
          const relativeSelector = selector.split(/(?:>>|:>>)/).slice(-1)[0];
          const element = tryFallbackSelector(container, relativeSelector);

          if (element) {
            record[label] = extractValue(element, attribute);
          }
        }

        if (Object.keys(record).length > 0) {
          nonTableData.push(record);
        }
      }
    }

    // Merge and limit the results
    const scrapedData = [...tableData, ...nonTableData];
    console.log(`📊 Total records extracted: ${scrapedData.length}`);

    return scrapedData;
  };

  /**
 * Gets all children of the elements matching the listSelector,
 * returning their CSS selectors and innerText.
 * @param {string} listSelector - Selector for the list container(s)
 * @returns {Array.<Object>} Array of objects, each containing the CSS selector and innerText of the children
 */
  window.scrapeListAuto = function (listSelector) {
    const lists = Array.from(document.querySelectorAll(listSelector));

    const results = [];

    lists.forEach(list => {
      const children = Array.from(list.children);

      children.forEach(child => {
        const selectors = [];
        let element = child;

        // Traverse up to gather the CSS selector for the element
        while (element && element !== document) {
          let selector = element.nodeName.toLowerCase();
          if (element.id) {
            selector += `#${element.id}`;
            selectors.push(selector);
            break;
          } else {
            const className = element.className.trim().split(/\s+/).join('.');
            if (className) {
              selector += `.${className}`;
            }
            selectors.push(selector);
            element = element.parentElement;
          }
        }

        results.push({
          selector: selectors.reverse().join(' > '),
          innerText: child.innerText.trim()
        });
      });
    });

    return results;
  };

})(window);

/* Media extraction support - listens for clicks on media elements and extracts text.
   Sends { url, tag, selector, extractedText } via postMessage to the parent window. */

// Extract text from image: alt/title first, then OCR via Tesseract if available
async function extractImageText(img) {
  try {
    const altTitle = (img.alt || img.title || '').trim();
    if (altTitle) return altTitle;

    if (window.Tesseract && typeof window.Tesseract.recognize === 'function') {
      // Use the image src (may be data: or remote); ignore if data: that contains large chunks
      const src = img.currentSrc || img.src || '';
      if (!src) return '';
      try {
        const result = await window.Tesseract.recognize(src, 'eng');
        return (result?.data?.text || '').trim();
      } catch (e) {
        return '';
      }
    }
  } catch (e) {
    return '';
  }
  return '';
}

// Extract text from PDF using pdf.js if available
async function extractPdfText(url) {
  try {
    if (!window.pdfjsLib) return '';
    const loadingTask = window.pdfjsLib.getDocument(url);
    const pdf = await loadingTask.promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      // eslint-disable-next-line no-await-in-loop
      const page = await pdf.getPage(i);
      // eslint-disable-next-line no-await-in-loop
      const content = await page.getTextContent();
      text += content.items.map((it) => it.str).join(' ') + '\n';
    }
    return text.trim();
  } catch (e) {
    return '';
  }
}

// Helper to generate structural selector if function is available
function structuralSelector(el) {
  try {
    if (typeof GetSelectorStructural === 'function') return GetSelectorStructural(el);
  } catch (e) {
    // fallthrough
  }
  return '';
}

// Click listener for media elements
document.addEventListener('click', async (ev) => {
  try {
    const el = ev.target;
    if (!el || !el.tagName) return;
    const tag = el.tagName.toLowerCase();
    let url = '';
    let selector = structuralSelector(el);
    let extractedText = '';

    if (tag === 'img') {
      url = el.currentSrc || el.src || '';
      extractedText = (el.alt || el.title || '').trim();
      if (!extractedText) extractedText = await extractImageText(el);
    } else if (tag === 'iframe' || tag === 'embed') {
      url = el.src || el.data || '';
      if (url && /\.pdf(\?|$)/i.test(url)) {
        extractedText = await extractPdfText(url);
      }
    } else if (tag === 'object') {
      // <object data="...pdf"> style
      url = el.data || '';
      if (url && /\.pdf(\?|$)/i.test(url)) {
        extractedText = await extractPdfText(url);
      }
    }

    if (url && extractedText) {
      // Post to parent so the recorder frontend (or wrapper) can relay it to server socket
      try {
        window.parent.postMessage({
          type: 'maxun:media-extracted',
          url,
          tag,
          selector,
          extractedText
        }, '*');
      } catch (e) {
        // ignore
      }
    }
  } catch (e) {
    // swallow
  }
});

// Load Tesseract and PDF.js if not already present (CDN).
if (!window.Tesseract) {
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@4.0.2/dist/tesseract.min.js';
  s.async = true;
  document.head.appendChild(s);
}
if (!window.pdfjsLib) {
  const s2 = document.createElement('script');
  s2.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
  s2.async = true;
  s2.onload = () => {
    try {
      // eslint-disable-next-line no-undef
      window.pdfjsLib = window['pdfjs-dist/build/pdf'];
      if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    } catch (e) {}
  };
  document.head.appendChild(s2);
}