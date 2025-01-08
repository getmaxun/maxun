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
  
      // First handle iframe traversal if present
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
                    // For document or iframe document
                    const doc = element.contentDocument || element || element.contentWindow?.document;
                    if (!doc) continue;

                    // Query elements in current context
                    const found = Array.from(doc.querySelectorAll(part));
                    
                    if (isLast) {
                        // If it's the last part, keep all matching elements
                        nextElements.push(...found);
                    } else {
                        // If not last, only keep iframes for next iteration
                        const iframes = found.filter(el => el.tagName === 'IFRAME');
                        nextElements.push(...iframes);
                    }
                } catch (error) {
                    console.warn('Cannot access iframe content:', error, {
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

    // Modified to handle iframe context for URL resolution
    function getElementValue(element, attribute) {
      if (!element) return null;
  
      // Get the base URL for resolving relative URLs
      const baseURL = element.ownerDocument?.location?.href || window.location.origin;
  
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
    // Enhanced query function to handle both iframe and shadow DOM
    const queryElement = (rootElement, selector) => {
      if (!selector.includes('>>') && !selector.includes(':>>')) {
          return rootElement.querySelector(selector);
      }

      const parts = selector.split(/(?:>>|:>>)/).map(part => part.trim());
      let currentElement = rootElement;

      for (let i = 0; i < parts.length; i++) {
          if (!currentElement) return null;

          // Handle iframe traversal
          if (currentElement.tagName === 'IFRAME') {
              try {
                  const iframeDoc = currentElement.contentDocument || currentElement.contentWindow.document;
                  currentElement = iframeDoc.querySelector(parts[i]);
                  continue;
              } catch (e) {
                  console.warn('Cannot access iframe content:', e);
                  return null;
              }
          }

          // Try regular DOM first
          let nextElement = currentElement.querySelector(parts[i]);

          // Try shadow DOM if not found
          if (!nextElement && currentElement.shadowRoot) {
              nextElement = currentElement.shadowRoot.querySelector(parts[i]);
          }

          // Check children's shadow roots if still not found
          if (!nextElement) {
              const children = Array.from(currentElement.children || []);
              for (const child of children) {
                  if (child.shadowRoot) {
                      nextElement = child.shadowRoot.querySelector(parts[i]);
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
      if (!selector.includes('>>') && !selector.includes(':>>')) {
          return rootElement.querySelectorAll(selector);
      }

      const parts = selector.split(/(?:>>|:>>)/).map(part => part.trim());
      let currentElements = [rootElement];

      for (const part of parts) {
          const nextElements = [];

          for (const element of currentElements) {
              // Handle iframe traversal
              if (element.tagName === 'IFRAME') {
                  try {
                      const iframeDoc = element.contentDocument || element.contentWindow.document;
                      nextElements.push(...iframeDoc.querySelectorAll(part));
                  } catch (e) {
                      console.warn('Cannot access iframe content:', e);
                      continue;
                  }
              } else {
                  // Regular DOM elements
                  if (element.querySelectorAll) {
                      nextElements.push(...element.querySelectorAll(part));
                  }
                  
                  // Shadow DOM elements
                  if (element.shadowRoot) {
                      nextElements.push(...element.shadowRoot.querySelectorAll(part));
                  }
                  
                  // Check children's shadow roots
                  const children = Array.from(element.children || []);
                  for (const child of children) {
                      if (child.shadowRoot) {
                          nextElements.push(...child.shadowRoot.querySelectorAll(part));
                      }
                  }
              }
          }

          currentElements = nextElements;
      }

      return currentElements;
    };

    // Enhanced value extraction with context awareness
    function extractValue(element, attribute) {
      if (!element) return null;

      // Get context-aware base URL
      const baseURL = element.ownerDocument?.location?.href || window.location.origin;
      
      // Check shadow root first
      if (element.shadowRoot) {
          const shadowContent = element.shadowRoot.textContent;
          if (shadowContent?.trim()) {
              return shadowContent.trim();
          }
      }

      if (attribute === 'innerText') {
          return element.innerText.trim();
      } else if (attribute === 'innerHTML') {
          return element.innerHTML.trim();
      } else if (attribute === 'src' || attribute === 'href') {
          const attrValue = element.getAttribute(attribute);
          return attrValue ? new URL(attrValue, baseURL).href : null;
      }
      return element.getAttribute(attribute);
    }

    // Enhanced table ancestor finding with context support
    function findTableAncestor(element) {
      let currentElement = element;
      const MAX_DEPTH = 5;
      let depth = 0;
      
      while (currentElement && depth < MAX_DEPTH) {
          // Handle shadow DOM
          if (currentElement.getRootNode() instanceof ShadowRoot) {
              currentElement = currentElement.getRootNode().host;
              continue;
          }
          
          if (currentElement.tagName === 'TD') {
              return { type: 'TD', element: currentElement };
          } else if (currentElement.tagName === 'TR') {
              return { type: 'TR', element: currentElement };
          }
          
          // Handle iframe crossing
          if (currentElement.tagName === 'IFRAME') {
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
    }

    // Helper function to get cell index
    function getCellIndex(td) {
      if (td.getRootNode() instanceof ShadowRoot) {
          const shadowRoot = td.getRootNode();
          const allCells = Array.from(shadowRoot.querySelectorAll('td'));
          return allCells.indexOf(td);
      }
      
      let index = 0;
      let sibling = td;
      while (sibling = sibling.previousElementSibling) {
          index++;
      }
      return index;
    }

    // Helper function to check for TH elements
    function hasThElement(row, tableFields) {
      for (const [_, { selector }] of Object.entries(tableFields)) {
          const element = queryElement(row, selector);
          if (element) {
              let current = element;
              while (current && current !== row) {
                  if (current.getRootNode() instanceof ShadowRoot) {
                      current = current.getRootNode().host;
                      continue;
                  }
                  
                  if (current.tagName === 'TH') return true;
                  
                  if (current.tagName === 'IFRAME') {
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
    }

    // Helper function to filter rows
    function filterRowsBasedOnTag(rows, tableFields) {
        for (const row of rows) {
            if (hasThElement(row, tableFields)) {
                return rows;
            }
        }
        // Include shadow DOM in TH search
        return rows.filter(row => {
            const directTH = row.getElementsByTagName('TH').length === 0;
            const shadowTH = row.shadowRoot ? 
                row.shadowRoot.querySelector('th') === null : true;
            return directTH && shadowTH;
        });
    }

    // Class similarity comparison functions
    function calculateClassSimilarity(classList1, classList2) {
        const set1 = new Set(classList1);
        const set2 = new Set(classList2);
        const intersection = new Set([...set1].filter(x => set2.has(x)));
        const union = new Set([...set1, ...set2]);
        return intersection.size / union.size;
    }

    // Enhanced similar elements finding with context support
    function findSimilarElements(baseElement, similarityThreshold = 0.7) {
      const baseClasses = Array.from(baseElement.classList);
      if (baseClasses.length === 0) return [];

      const allElements = [];
      
      // Get elements from main document
      allElements.push(...document.getElementsByTagName(baseElement.tagName));
      
      // Get elements from shadow DOM
      if (baseElement.getRootNode() instanceof ShadowRoot) {
          const shadowHost = baseElement.getRootNode().host;
          allElements.push(...shadowHost.getElementsByTagName(baseElement.tagName));
      }
      
      // Get elements from iframes
      const iframes = document.getElementsByTagName('iframe');
      for (const iframe of iframes) {
          try {
              const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
              allElements.push(...iframeDoc.getElementsByTagName(baseElement.tagName));
          } catch (e) {
              console.warn('Cannot access iframe content:', e);
          }
      }

      return allElements.filter(element => {
          if (element === baseElement) return false;
          const similarity = calculateClassSimilarity(
              baseClasses,
              Array.from(element.classList)
          );
          return similarity >= similarityThreshold;
      });
    }

    // Main scraping logic with context support
    let containers = queryElementAll(document, listSelector);
    containers = Array.from(containers);

    if (containers.length === 0) return [];

    if (limit > 1 && containers.length === 1) {
      const baseContainer = containers[0];
      const similarContainers = findSimilarElements(baseContainer);
      
      if (similarContainers.length > 0) {
          const newContainers = similarContainers.filter(container => 
              !container.matches(listSelector)
          );
          containers = [...containers, ...newContainers];
      }
    }

    const containerFields = containers.map(() => ({
      tableFields: {},
      nonTableFields: {}
    }));

    // Classify fields
    containers.forEach((container, containerIndex) => {
      for (const [label, field] of Object.entries(fields)) {
        const sampleElement = queryElement(container, field.selector);
        
        if (sampleElement) {
            const ancestor = findTableAncestor(sampleElement);
            if (ancestor) {
                containerFields[containerIndex].tableFields[label] = {
                    ...field,
                    tableContext: ancestor.type,
                    cellIndex: ancestor.type === 'TD' ? getCellIndex(ancestor.element) : -1
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

    // Process table data with both iframe and shadow DOM support
    for (let containerIndex = 0; containerIndex < containers.length; containerIndex++) {
      const container = containers[containerIndex];
      const { tableFields } = containerFields[containerIndex];

      if (Object.keys(tableFields).length > 0) {
          const firstField = Object.values(tableFields)[0];
          const firstElement = queryElement(container, firstField.selector);
          let tableContext = firstElement;
          
          // Find table context including both iframe and shadow DOM
          while (tableContext && tableContext.tagName !== 'TABLE' && tableContext !== container) {
              if (tableContext.getRootNode() instanceof ShadowRoot) {
                  tableContext = tableContext.getRootNode().host;
                  continue;
              }
              
              if (tableContext.tagName === 'IFRAME') {
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
              rows.push(...tableContext.getElementsByTagName('TR'));
              
              // Get rows from shadow DOM
              if (tableContext.shadowRoot) {
                  rows.push(...tableContext.shadowRoot.getElementsByTagName('TR'));
              }
              
              // Get rows from iframes
              if (tableContext.tagName === 'IFRAME') {
                  try {
                      const iframeDoc = tableContext.contentDocument || tableContext.contentWindow.document;
                      rows.push(...iframeDoc.getElementsByTagName('TR'));
                  } catch (e) {
                      console.warn('Cannot access iframe rows:', e);
                  }
              }
              
              const processedRows = filterRowsBasedOnTag(rows, tableFields);
              
              for (let rowIndex = 0; rowIndex < Math.min(processedRows.length, limit); rowIndex++) {
                  const record = {};
                  const currentRow = processedRows[rowIndex];
                  
                  for (const [label, { selector, attribute, cellIndex }] of Object.entries(tableFields)) {
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
                              
                              if (!element && selector.split(/(?:>>|:>>)/).pop().includes('td:nth-child')) {
                                  element = td;
                              }

                              if (!element) {
                                  const tagOnlySelector = selector.split('.')[0];
                                  element = queryElement(td, tagOnlySelector);
                              }
                              
                              if (!element) {
                                  let currentElement = td;
                                  while (currentElement && currentElement.children.length > 0) {
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

    // Process non-table data with both contexts support
    for (let containerIndex = 0; containerIndex < containers.length; containerIndex++) {
      if (nonTableData.length >= limit) break;

      const container = containers[containerIndex];
      const { nonTableFields } = containerFields[containerIndex];

      if (Object.keys(nonTableFields).length > 0) {
          const record = {};

          for (const [label, { selector, attribute }] of Object.entries(nonTableFields)) {
              // Get the last part of the selector after any context delimiter
              const relativeSelector = selector.split(/(?:>>|:>>)/).slice(-1)[0];
              const element = queryElement(container, relativeSelector);
              
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