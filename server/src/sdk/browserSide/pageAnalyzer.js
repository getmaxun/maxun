/**
 * Page Analyzer for pagination auto-detection, selector generation and grouping
 */

(function () {
  'use strict';

  /**
   * Helper function to evaluate both CSS and XPath selectors
   * Returns array of matching elements
   */
  function evaluateSelector(selector, doc) {
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

        const elements = [];
        for (let i = 0; i < result.snapshotLength; i++) {
          const node = result.snapshotItem(i);
          if (node && node.nodeType === Node.ELEMENT_NODE) {
            elements.push(node);
          }
        }
        return elements;
      } else {
        return Array.from(doc.querySelectorAll(selector));
      }
    } catch (err) {
      return [];
    }
  }

  /**
   * Convert CSS selector to XPath
   */
  function cssToXPath(cssSelector) {
    if (cssSelector.startsWith('//') || cssSelector.startsWith('/')) {
      return cssSelector;
    }

    try {
      let xpath = '';

      const parts = cssSelector.split(/\s+(?![^[]*])/);

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i].trim();
        if (!part) continue;
        if (part === '>') continue;

        const xpathPart = convertCssPart(part);
        if (i === 0) {
          xpath = '//' + xpathPart;
        } else if (parts[i - 1] === '>') {
          xpath += '/' + xpathPart;
        } else {
          xpath += '//' + xpathPart;
        }
      }

      return xpath || `//*`;
    } catch (error) {
      return `//*`;
    }
  }

  /**
   * Convert a single CSS selector part to XPath
   */
  function convertCssPart(cssPart) {
    const tagMatch = cssPart.match(/^([a-zA-Z][\w-]*|\*)/);
    const tag = tagMatch ? tagMatch[1] : '*';

    const predicates = [];

    const idMatch = cssPart.match(/#([\w-]+)/);
    if (idMatch) {
      predicates.push(`@id='${idMatch[1]}'`);
    }

    const classMatches = cssPart.match(/\.((?:\\.|[^.#[\s])+)/g);
    if (classMatches) {
      classMatches.forEach(cls => {
        let className = cls.substring(1).replace(/\\/g, '');
        predicates.push(`contains(@class, '${className}')`);
      });
    }

    const attrMatches = cssPart.match(/\[([^\]]+)\]/g);
    if (attrMatches) {
      attrMatches.forEach(attr => {
        const content = attr.slice(1, -1);
        const eqMatch = content.match(/([^=]+)="([^"]+)"/);
        if (eqMatch) {
          predicates.push(`@${eqMatch[1]}='${eqMatch[2]}'`);
        } else {
          predicates.push(`@${content}`);
        }
      });
    }

    if (predicates.length > 0) {
      return `${tag}[${predicates.join(' and ')}]`;
    }
    return tag;
  }

  /**
   * Main entry point for SDK - auto-converts CSS to XPath
   */
  window.autoDetectListFields = function (selector) {
    try {
      let xpathSelector = cssToXPath(selector);

      const testElements = evaluateXPath(xpathSelector, document);

      if (testElements.length === 0) {
        console.error('No elements matched the XPath selector!');
        return {
          fields: {},
          listSelector: xpathSelector,
          listFallbackSelector: null,
          error: 'Selector did not match any elements on the page'
        };
      }

      if (testElements.length > 0 && !xpathSelector.includes('count(*)')) {
        const childCounts = testElements.slice(0, 5).map(el => el.children.length);
        const uniqueCounts = [...new Set(childCounts)];

        if (uniqueCounts.length > 1 && childCounts.filter(c => c === 1).length > childCounts.length / 2) {
          if (xpathSelector.includes('[') && xpathSelector.endsWith(']')) {
            xpathSelector = xpathSelector.slice(0, -1) + ' and count(*)=1]';
          } else if (xpathSelector.includes('[')) {
            xpathSelector = xpathSelector.replace(/\]$/, ' and count(*)=1]');
          } else {
            const lastSlash = xpathSelector.lastIndexOf('/');
            if (lastSlash !== -1) {
              const beforeTag = xpathSelector.substring(0, lastSlash + 1);
              const tag = xpathSelector.substring(lastSlash + 1);
              xpathSelector = beforeTag + tag + '[count(*)=1]';
            } else {
              xpathSelector = xpathSelector + '[count(*)=1]';
            }
          }
        }
      }

      const fields = window.getChildSelectors(xpathSelector);

      return {
        fields: fields,
        listSelector: xpathSelector,
        listFallbackSelector: null,
        error: Object.keys(fields).length === 0 ? 'No valid fields could be auto-detected from the list items' : null
      };
    } catch (error) {
      console.error('Exception:', error);
      return {
        fields: {},
        error: error.message || 'Failed to auto-detect fields'
      };
    }
  };

  const pathCache = new WeakMap();
  const descendantsCache = new WeakMap();
  const meaningfulCache = new WeakMap();
  const classCache = new Map();

  /**
   * Main entry point - returns detected fields for a list selector
   */
  window.getChildSelectors = function (parentSelector) {
    try {
      const parentElements = evaluateXPath(parentSelector, document);

      if (parentElements.length === 0) {
        console.error('No parent elements found!');
        return {};
      }

      const maxItems = 10;
      const limitedParents = parentElements.slice(0, Math.min(maxItems, parentElements.length));

      const allChildSelectors = [];

      for (let i = 0; i < limitedParents.length; i++) {
        const parent = limitedParents[i];
        const otherListElements = limitedParents.filter((_, index) => index !== i);

        const selectors = generateOptimizedChildXPaths(
          parent,
          parentSelector,
          otherListElements
        );
        
        allChildSelectors.push(...selectors);
      }

      const childSelectors = Array.from(new Set(allChildSelectors)).sort()

      const fields = createFieldsFromSelectors(
        childSelectors,
        limitedParents,
        parentSelector
      );

      return fields;
    } catch (error) {
      console.error('Exception:', error);
      return {};
    }
  };

  /**
   * Generate optimized XPath selectors for all meaningful children
   */
  function generateOptimizedChildXPaths(parentElement, listSelector, otherListElements) {
    const selectors = [];
    const processedElements = new Set();

    const allDescendants = getAllDescendantsIncludingShadow(parentElement);

    const batchSize = 25;
    for (let i = 0; i < allDescendants.length; i += batchSize) {
      const batch = allDescendants.slice(i, i + batchSize);

      for (const descendant of batch) {
        if (processedElements.has(descendant)) continue;
        processedElements.add(descendant);

        const xpath = buildOptimizedAbsoluteXPath(
          descendant,
          listSelector,
          parentElement,
          otherListElements
        );

        if (xpath.primary) {
          selectors.push({
            primary: xpath.primary,
            fallback: xpath.fallback,
            element: descendant
          });
        }

        if (selectors.length >= 250) {
          break;
        }
      }

      if (selectors.length >= 250) {
        break;
      }
    }

    return selectors;
  }

  /**
   * Get all meaningful descendants including shadow DOM
   */
  function getAllDescendantsIncludingShadow(parentElement) {
    if (descendantsCache.has(parentElement)) {
      return descendantsCache.get(parentElement);
    }

    const meaningfulDescendants = [];
    const queue = [parentElement];
    const visited = new Set();
    visited.add(parentElement);

    const MAX_MEANINGFUL_ELEMENTS = 300;
    const MAX_NODES_TO_CHECK = 1200;
    const MAX_DEPTH = 20;
    let nodesChecked = 0;

    const depths = [0];
    let queueIndex = 0;

    while (queueIndex < queue.length) {
      const element = queue[queueIndex];
      const currentDepth = depths[queueIndex];
      queueIndex++;
      nodesChecked++;

      if (
        nodesChecked > MAX_NODES_TO_CHECK ||
        meaningfulDescendants.length >= MAX_MEANINGFUL_ELEMENTS ||
        currentDepth > MAX_DEPTH
      ) {
        break;
      }

      if (element !== parentElement && isMeaningfulElement(element)) {
        meaningfulDescendants.push(element);
      }

      if (currentDepth >= MAX_DEPTH) {
        continue;
      }

      const children = element.children;
      const childLimit = Math.min(children.length, 30);
      for (let i = 0; i < childLimit; i++) {
        const child = children[i];
        if (!visited.has(child)) {
          visited.add(child);
          queue.push(child);
          depths.push(currentDepth + 1);
        }
      }

      // Process shadow DOM
      if (element.shadowRoot && currentDepth < MAX_DEPTH - 1) {
        const shadowChildren = element.shadowRoot.children;
        const shadowLimit = Math.min(shadowChildren.length, 20);
        for (let i = 0; i < shadowLimit; i++) {
          const child = shadowChildren[i];
          if (!visited.has(child)) {
            visited.add(child);
            queue.push(child);
            depths.push(currentDepth + 1);
          }
        }
      }
    }

    descendantsCache.set(parentElement, meaningfulDescendants);
    return meaningfulDescendants;
  }

  /**
   * Check if element has meaningful content for extraction
   */
  function isMeaningfulElement(element) {
    if (meaningfulCache.has(element)) {
      return meaningfulCache.get(element);
    }

    const tagName = element.tagName.toLowerCase();

    if (tagName === 'img' && element.hasAttribute('src')) {
      meaningfulCache.set(element, true);
      return true;
    }

    if (tagName === 'a' && element.hasAttribute('href')) {
      meaningfulCache.set(element, true);
      return true;
    }

    const text = (element.textContent || '').trim();
    const hasVisibleText = text.length > 0;

    if (hasVisibleText || element.querySelector('svg')) {
      meaningfulCache.set(element, true);
      return true;
    }

    if (element.children.length > 0) {
      meaningfulCache.set(element, false);
      return false;
    }

    meaningfulCache.set(element, false);
    return false;
  }

  /**
   * Build optimized absolute XPath
   */
  function buildOptimizedAbsoluteXPath(targetElement, listSelector, listElement, otherListElements) {
    try {
      let primary = null;
      const pathFromList = getOptimizedStructuralPath(
        targetElement,
        listElement,
        otherListElements
      );

      if (pathFromList) {
        primary = listSelector + pathFromList;
      }

      const fallback = generateMandatoryChildFallbackXPath(targetElement, listElement);

      return { primary, fallback };
    } catch (error) {
      const fallback = generateMandatoryChildFallbackXPath(targetElement, listElement);
      return { primary: null, fallback };
    }
  }

  /**
   * Get optimized structural path from element to root
   */
  function getOptimizedStructuralPath(targetElement, rootElement, otherListElements) {
    if (pathCache.has(targetElement)) {
      return pathCache.get(targetElement);
    }

    if (!elementContains(rootElement, targetElement) || targetElement === rootElement) {
      return null;
    }

    const pathParts = [];
    let current = targetElement;
    let pathDepth = 0;
    const MAX_PATH_DEPTH = 20;

    while (current && current !== rootElement && pathDepth < MAX_PATH_DEPTH) {
      const classes = getCommonClassesAcrossLists(current, otherListElements);
      const hasConflictingElement = classes.length > 0 && rootElement
        ? queryElementsInScope(rootElement, current.tagName.toLowerCase())
          .filter(el => el !== current)
          .some(el => classes.every(cls =>
            normalizeClasses(el.classList).split(' ').includes(cls)
          ))
        : false;

      const pathPart = generateOptimizedStructuralStep(
        current,
        rootElement,
        hasConflictingElement,
        otherListElements
      );

      if (pathPart) {
        pathParts.unshift(pathPart);
      }

      current = current.parentElement ||
        ((current.getRootNode()).host);

      pathDepth++;
    }

    if (current !== rootElement) {
      pathCache.set(targetElement, null);
      return null;
    }

    const result = pathParts.length > 0 ? '/' + pathParts.join('/') : null;
    pathCache.set(targetElement, result);

    return result;
  }

  /**
   * Generate optimized structural step for XPath
   */
  function generateOptimizedStructuralStep(element, rootElement, addPositionToAll, otherListElements) {
    const tagName = element.tagName.toLowerCase();
    const parent = element.parentElement ||
      ((element.getRootNode()).host);

    if (!parent) {
      return tagName;
    }

    const classes = getCommonClassesAcrossLists(element, otherListElements);
    if (classes.length > 0 && !addPositionToAll) {
      const classSelector = classes
        .map(cls => `contains(@class, '${cls}')`)
        .join(' and ');

      const hasConflictingElement = rootElement
        ? queryElementsInScope(rootElement, element.tagName.toLowerCase())
          .filter(el => el !== element)
          .some(el => classes.every(cls =>
            normalizeClasses(el.classList).split(' ').includes(cls)
          ))
        : false;

      if (!hasConflictingElement) {
        return `${tagName}[${classSelector}]`;
      } else {
        const position = getSiblingPosition(element, parent);
        return `${tagName}[${classSelector}][${position}]`;
      }
    }

    if (!addPositionToAll) {
      const meaningfulAttrs = ['role', 'type'];
      for (const attrName of meaningfulAttrs) {
        if (element.hasAttribute(attrName)) {
          const value = element.getAttribute(attrName).replace(/'/g, "\\'");
          const isCommon = isAttributeCommonAcrossLists(
            element,
            attrName,
            value,
            otherListElements
          );
          if (isCommon) {
            return `${tagName}[@${attrName}='${value}']`;
          }
        }
      }
    }

    const position = getSiblingPosition(element, parent);

    if (addPositionToAll || classes.length === 0) {
      return `${tagName}[${position}]`;
    }

    return tagName;
  }

  /**
   * Get common classes across list items
   */
  function getCommonClassesAcrossLists(targetElement, otherListElements) {
    if (otherListElements.length === 0) {
      return normalizeClasses(targetElement.classList).split(' ').filter(Boolean);
    }

    const targetClasses = normalizeClasses(targetElement.classList).split(' ').filter(Boolean);

    if (targetClasses.length === 0) {
      return [];
    }

    const cacheKey = `${targetElement.tagName}_${targetClasses.join(',')}_${otherListElements.length}`;

    if (classCache.has(cacheKey)) {
      return classCache.get(cacheKey);
    }

    const targetClassSet = new Set(targetClasses);
    const similarElements = [];

    const maxElementsToCheck = 100;
    let checkedElements = 0;

    for (const listEl of otherListElements) {
      if (checkedElements >= maxElementsToCheck) break;

      const descendants = getAllDescendantsIncludingShadow(listEl);
      for (const child of descendants) {
        if (checkedElements >= maxElementsToCheck) break;
        if (child.tagName === targetElement.tagName) {
          similarElements.push(child);
          checkedElements++;
        }
      }
    }

    if (similarElements.length === 0) {
      classCache.set(cacheKey, targetClasses);
      return targetClasses;
    }

    const exactMatches = similarElements.filter(el => {
      const elClasses = normalizeClasses(el.classList).split(' ').filter(Boolean);
      if (elClasses.length !== targetClasses.length) return false;
      return elClasses.every(cls => targetClassSet.has(cls));
    });

    if (exactMatches.length > 0) {
      classCache.set(cacheKey, targetClasses);
      return targetClasses;
    }

    const commonClasses = [];

    for (const targetClass of targetClasses) {
      const existsInAllOtherLists = otherListElements.every(listEl => {
        const elementsInThisList = getAllDescendantsIncludingShadow(listEl).filter(child =>
          child.tagName === targetElement.tagName
        );

        return elementsInThisList.some(el =>
          normalizeClasses(el.classList).split(' ').includes(targetClass)
        );
      });

      if (existsInAllOtherLists) {
        commonClasses.push(targetClass);
      }
    }

    classCache.set(cacheKey, commonClasses);
    return commonClasses;
  }

  /**
   * Normalize class names by removing dynamic parts
   */
  function normalizeClasses(classList) {
    return Array.from(classList)
      .filter(cls => {
        return (
          !cls.match(/\d{3,}|uuid|hash|id-|_\d+$/i) &&
          !cls.startsWith('_ngcontent-') &&
          !cls.startsWith('_nghost-') &&
          !cls.match(/^ng-tns-c\d+-\d+$/)
        );
      })
      .sort()
      .join(' ');
  }

  /**
   * Check if attribute is common across lists
   */
  function isAttributeCommonAcrossLists(targetElement, attrName, attrValue, otherListElements) {
    if (otherListElements.length === 0) {
      return true;
    }

    const targetPath = getElementPath(targetElement);

    for (const otherListElement of otherListElements) {
      const correspondingElement = findCorrespondingElement(otherListElement, targetPath);
      if (correspondingElement) {
        const otherValue = correspondingElement.getAttribute(attrName);
        if (otherValue !== attrValue) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Get element path as indices
   */
  function getElementPath(element) {
    const path = [];
    let current = element;

    while (current && current.parentElement) {
      const siblings = Array.from(current.parentElement.children);
      path.unshift(siblings.indexOf(current));
      current = current.parentElement;
    }

    return path;
  }

  /**
   * Find corresponding element in another list
   */
  function findCorrespondingElement(rootElement, path) {
    let current = rootElement;

    for (const index of path) {
      const children = Array.from(current.children);
      if (index >= children.length) {
        return null;
      }
      current = children[index];
    }

    return current;
  }

  /**
   * Get sibling position
   */
  function getSiblingPosition(element, parent) {
    const siblings = Array.from(parent.children || []).filter(
      child => child.tagName === element.tagName
    );
    return siblings.indexOf(element) + 1;
  }

  /**
   * Query elements in scope (handles shadow DOM)
   */
  function queryElementsInScope(rootElement, tagName) {
    if (rootElement.shadowRoot || isInShadowDOM(rootElement)) {
      return deepQuerySelectorAll(rootElement, tagName);
    } else {
      return Array.from(rootElement.querySelectorAll(tagName));
    }
  }

  /**
   * Check if element is in shadow DOM
   */
  function isInShadowDOM(element) {
    return element.getRootNode() instanceof ShadowRoot;
  }

  /**
   * Deep query selector for shadow DOM
   */
  function deepQuerySelectorAll(root, selector) {
    const elements = [];

    function process(node) {
      if (node instanceof Element && node.matches(selector)) {
        elements.push(node);
      }

      for (const child of node.children) {
        process(child);
      }

      if (node instanceof HTMLElement && node.shadowRoot) {
        process(node.shadowRoot);
      }
    }

    process(root);
    return elements;
  }

  /**
   * Check if container contains element (works with shadow DOM)
   */
  function elementContains(container, element) {
    if (container.contains(element)) {
      return true;
    }

    let current = element;
    while (current) {
      if (current === container) {
        return true;
      }

      current = current.parentElement ||
        ((current.getRootNode()).host);
    }

    return false;
  }

  /**
   * Generate fallback XPath using data-mx-id
   */
  function generateMandatoryChildFallbackXPath(childElement, parentElement) {
    try {
      const parentMxId = parentElement.getAttribute('data-mx-id');
      const childMxId = childElement.getAttribute('data-mx-id');

      if (!parentMxId) {
        return null;
      }

      const parentTagName = parentElement.tagName.toLowerCase();
      const childTagName = childElement.tagName.toLowerCase();

      if (childMxId) {
        return `//${parentTagName}[@data-mx-id='${parentMxId}']//${childTagName}[@data-mx-id='${childMxId}']`;
      } else {
        const pathElements = getMandatoryFallbackPath(childElement, parentElement);
        if (pathElements.length > 0) {
          const parentPath = `//${parentTagName}[@data-mx-id='${parentMxId}']`;
          const childPath = pathElements.join('/');
          return `${parentPath}/${childPath}`;
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Build mandatory fallback path using data-mx-id
   */
  function getMandatoryFallbackPath(targetElement, rootElement) {
    const pathParts = [];
    let current = targetElement;

    while (current && current !== rootElement && current.parentElement) {
      const mxId = current.getAttribute('data-mx-id');
      const tagName = current.tagName.toLowerCase();

      if (mxId) {
        pathParts.unshift(`${tagName}[@data-mx-id='${mxId}']`);
      } else {
        const position = Array.from(current.parentElement.children)
          .filter(child => child.tagName === current.tagName)
          .indexOf(current) + 1;
        pathParts.unshift(`${tagName}[${position}]`);
      }

      current = current.parentElement;
    }

    return pathParts;
  }

  /**
   * Evaluate XPath and return elements
   */
  function evaluateXPath(xpath, contextNode) {
    try {
      const doc = contextNode instanceof ShadowRoot
        ? contextNode.host.ownerDocument
        : contextNode;

      const result = doc.evaluate(
        xpath,
        contextNode,
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
      return [];
    }
  }

  /**
   * Create fields from selectors by evaluating them and extracting data
   */
  function createFieldsFromSelectors(selectorObjects, listElements, parentSelector) {
    const candidates = [];

    for (const selectorObj of selectorObjects) {
      try {
        const elements = evaluateXPath(selectorObj.primary, document);

        if (elements.length === 0) continue;

        const element = elements[0];

        const tagName = element.tagName.toLowerCase();
        if (tagName === 'a') {
          const href = element.getAttribute('href');
          const text = (element.textContent || '').trim();

          if (text) {
            const textField = createFieldData(element, selectorObj.primary, 'innerText');
            if (textField && textField.data) {
              candidates.push({
                field: textField,
                element: element,
                position: getElementPosition(element)
              });
            }
          }

          if (href && href !== '#' && !href.startsWith('javascript:')) {
            const hrefField = createFieldData(element, selectorObj.primary, 'href');
            if (hrefField && hrefField.data) {
              candidates.push({
                field: hrefField,
                element: element,
                position: getElementPosition(element)
              });
            }
          }
        } else {
          const field = createFieldData(element, selectorObj.primary);

          if (field && field.data) {
            candidates.push({
              field: field,
              element: element,
              position: getElementPosition(element)
            });
          }
        }
      } catch (error) {
      }
    }

    const filtered = removeParentChildDuplicates(candidates);

    filtered.sort((a, b) => {
      if (Math.abs(a.position.y - b.position.y) > 5) {
        return a.position.y - b.position.y;
      }
      return a.position.x - b.position.x;
    });

    return removeDuplicateContentAndFormat(filtered);
  }

  /**
   * Create field data from element
   */
  function createFieldData(element, selector, forceAttribute) {
    const tagName = element.tagName.toLowerCase();
    let data = '';
    let attribute = forceAttribute || 'innerText';

    if (forceAttribute) {
      if (forceAttribute === 'href') {
        data = element.getAttribute('href') || '';
      } else if (forceAttribute === 'innerText') {
        data = (element.textContent || '').trim();
      }
    } else if (tagName === 'img') {
      data = element.getAttribute('src') || '';
      attribute = 'src';
    } else if (tagName === 'a') {
      const href = element.getAttribute('href') || '';
      const text = (element.textContent || '').trim();
      if (href && href !== '#' && !href.startsWith('javascript:')) {
        data = href;
        attribute = 'href';
      } else if (text) {
        data = text;
        attribute = 'innerText';
      }
    } else {
      data = (element.textContent || '').trim();
      attribute = 'innerText';
    }

    if (!data) {
      return null;
    }

    const isShadow = element.getRootNode() instanceof ShadowRoot;

    return {
      data: data,
      selectorObj: {
        selector: selector,
        attribute: attribute,
        tag: tagName.toUpperCase(),
        isShadow: isShadow
      }
    };
  }

  /**
   * Get element position
   */
  function getElementPosition(element) {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.top
    };
  }

  /**
   * Remove parent-child duplicates
   */
  function removeParentChildDuplicates(candidates) {
    const filtered = [];

    for (const candidate of candidates) {
      let shouldInclude = true;
      const tagName = candidate.element.tagName.toLowerCase();

      for (const existing of filtered) {
        if (candidate.element.contains(existing.element)) {
          shouldInclude = false;
          break;
        } else if (existing.element.contains(candidate.element)) {
          const existingIndex = filtered.indexOf(existing);
          filtered.splice(existingIndex, 1);
          break;
        }
      }

      if (tagName === 'a' || tagName === 'img') {
        shouldInclude = true;
      }

      if (shouldInclude) {
        filtered.push(candidate);
      }
    }

    return filtered;
  }

  /**
   * Remove duplicate content and format for workflow
   */
  function removeDuplicateContentAndFormat(candidates) {
    const finalFields = {};
    const seenContent = new Set();
    const seenSelectors = new Set();
    let labelCounter = 1;

    for (const candidate of candidates) {
      const content = candidate.field.data.trim().toLowerCase();
      const selectorKey = `${candidate.field.selectorObj.selector}::${candidate.field.selectorObj.attribute}`;

      if (!seenContent.has(content) && !seenSelectors.has(selectorKey)) {
        seenContent.add(content);
        seenSelectors.add(selectorKey);
        const fieldName = `Label ${labelCounter}`;

        finalFields[fieldName] = {
          selector: candidate.field.selectorObj.selector,
          attribute: candidate.field.selectorObj.attribute,
          tag: candidate.field.selectorObj.tag,
          isShadow: candidate.field.selectorObj.isShadow
        };

        labelCounter++;
      }
    }

    return finalFields;
  }

  /**
   * Auto-detect pagination type and selector
   * Returns: { type: string, selector: string | null }
   * Types: 'scrollDown', 'scrollUp', 'clickNext', 'clickLoadMore', ''
   */
  window.autoDetectPagination = function (listSelector, options) {
    try {
      var MAX_BUTTON_TEXT_LENGTH = 50;

      var nextButtonTextPatterns = [
        /^\s*next\s*$/i,
        /\bnext\s+page\b/i,
        /\bpage\s+suivante\b/i,
        /\bsiguiente\b/i,
        /\bweiter\b/i,
        /\bnächste\b/i,
        /\bvolgende\b/i,
        /\bpróximo\b/i,
        /\bavanti\b/i,
      ];

      var nextButtonArrowPatterns = [
        /^[>\s›→»⟩]+$/,
        /^>>$/,
      ];

      var loadMorePatterns = [
        /^\s*load\s+more\s*$/i,
        /^\s*show\s+more\s*$/i,
        /^\s*view\s+more\s*$/i,
        /^\s*see\s+more\s*$/i,
        /^\s*more\s+results\s*$/i,
        /^\s*plus\s+de\s+résultats\s*$/i,
        /^\s*más\s+resultados\s*$/i,
        /^\s*weitere\s+ergebnisse\s*$/i,
        /^\s*meer\s+laden\s*$/i,
        /^\s*carica\s+altri\s*$/i,
        /^\s*carregar\s+mais\s*$/i,
      ];

      var paginationContainerPattern = /paginat|page-nav|pager|page-numbers|page-list/i;

      // --- Utility functions ---

      function matchesAnyPattern(text, patterns) {
        return patterns.some(function (pattern) { return pattern.test(text); });
      }

      function isVisible(element) {
        try {
          var style = window.getComputedStyle(element);
          return style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0' &&
            element.offsetWidth > 0 &&
            element.offsetHeight > 0;
        } catch (e) {
          return false;
        }
      }

      function getClickableElements(root) {
        var clickables = [];
        var selectors = ['button', 'a', '[role="button"]', '[onclick]', '.btn', '.button'];
        for (var i = 0; i < selectors.length; i++) {
          var elements = root.querySelectorAll(selectors[i]);
          clickables.push.apply(clickables, Array.from(elements));
        }
        return Array.from(new Set(clickables));
      }

      function isNearList(element, listCont) {
        try {
          var listRect = listCont.getBoundingClientRect();
          var elementRect = element.getBoundingClientRect();

          if (elementRect.top >= listRect.bottom && elementRect.top <= listRect.bottom + 300) {
            return true;
          }
          if (elementRect.bottom <= listRect.top && elementRect.bottom >= listRect.top - 200) {
            return true;
          }
          var verticalOverlap = !(elementRect.bottom < listRect.top || elementRect.top > listRect.bottom);
          if (verticalOverlap) {
            var horizontalDistance = Math.min(
              Math.abs(elementRect.left - listRect.right),
              Math.abs(elementRect.right - listRect.left)
            );
            if (horizontalDistance < 150) return true;
          }
          return false;
        } catch (e) {
          return false;
        }
      }

      function isSkippable(element, listCont) {
        if (listCont.contains(element)) return true;
        if (element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true') return true;
        return false;
      }

      function isNextButton(text, ariaLabel, combinedText) {
        if (matchesAnyPattern(combinedText, nextButtonTextPatterns)) return true;
        if (text.length <= 3 && matchesAnyPattern(text, nextButtonArrowPatterns)) return true;
        if (!text.trim() && matchesAnyPattern(ariaLabel, nextButtonTextPatterns)) return true;
        return false;
      }

      function generatePaginationSelector(element) {
        try {
          element.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
        } catch (e) { }

        var rect = element.getBoundingClientRect();
        var coordinates = {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2
        };

        var result = getSelectors(document, coordinates);
        var selectorChain = [];

        if (result.primary) {
          if (result.primary.id) selectorChain.push(result.primary.id);
          if (result.primary.testIdSelector) selectorChain.push(result.primary.testIdSelector);
          if (result.primary.relSelector) selectorChain.push(result.primary.relSelector);
          if (result.primary.accessibilitySelector) selectorChain.push(result.primary.accessibilitySelector);
          if (result.primary.hrefSelector) selectorChain.push(result.primary.hrefSelector);
          if (result.primary.formSelector) selectorChain.push(result.primary.formSelector);
          if (result.primary.attrSelector) selectorChain.push(result.primary.attrSelector);
          if (result.primary.generalSelector) selectorChain.push(result.primary.generalSelector);
        }

        return selectorChain.length > 0 ? selectorChain.join(',') : element.tagName.toLowerCase();
      }

      /**
       * Comprehensive selector generator (based on @medv/finder)
       * Supports shadow DOM, iframes, and multiple selector strategies
       */
      function getSelectors(iframeDoc, coordinates) {
        try {
          // ===== FINDER ALGORITHM =====
          // Based on @medv/finder by Anton Medvedev
          // https://github.com/antonmedv/finder/blob/master/finder.ts

          const Limit = {
            All: 0,
            Two: 1,
            One: 2
          };

          let config;
          let rootDocument;

          function finder(input, options) {
            if (input.nodeType !== Node.ELEMENT_NODE) {
              throw new Error("Can't generate CSS selector for non-element node type.");
            }

            if ('html' === input.tagName.toLowerCase()) {
              return 'html';
            }

            const defaults = {
              root: iframeDoc.body,
              idName: function (name) { return true; },
              className: function (name) { return true; },
              tagName: function (name) { return true; },
              attr: function (name, value) { return false; },
              seedMinLength: 1,
              optimizedMinLength: 2,
              threshold: 900,
              maxNumberOfTries: 9000
            };

            config = Object.assign({}, defaults, options || {});
            rootDocument = findRootDocument(config.root, defaults);

            let path = bottomUpSearch(input, Limit.All, function () {
              return bottomUpSearch(input, Limit.Two, function () {
                return bottomUpSearch(input, Limit.One);
              });
            });

            if (path) {
              const optimized = sort(optimize(path, input));
              if (optimized.length > 0) {
                path = optimized[0];
              }
              return selector(path);
            } else {
              throw new Error('Selector was not found.');
            }
          }

          function findRootDocument(rootNode, defaults) {
            if (rootNode.nodeType === Node.DOCUMENT_NODE) {
              return rootNode;
            }
            if (rootNode === defaults.root) {
              return rootNode.ownerDocument;
            }
            return rootNode;
          }

          function bottomUpSearch(input, limit, fallback) {
            let path = null;
            let stack = [];
            let current = input;
            let i = 0;

            while (current && current !== config.root.parentElement) {
              let level = maybe(id(current)) ||
                maybe.apply(null, attr(current)) ||
                maybe.apply(null, classNames(current)) ||
                maybe(tagName(current)) ||
                [any()];

              const nth = index(current);

              if (limit === Limit.All) {
                if (nth) {
                  level = level.concat(
                    level.filter(dispensableNth).map(function (node) {
                      return nthChild(node, nth);
                    })
                  );
                }
              } else if (limit === Limit.Two) {
                level = level.slice(0, 1);
                if (nth) {
                  level = level.concat(
                    level.filter(dispensableNth).map(function (node) {
                      return nthChild(node, nth);
                    })
                  );
                }
              } else if (limit === Limit.One) {
                const node = level[0];
                level = level.slice(0, 1);
                if (nth && dispensableNth(node)) {
                  level = [nthChild(node, nth)];
                }
              }

              for (let j = 0; j < level.length; j++) {
                level[j].level = i;
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

          function findUniquePath(stack, fallback) {
            const paths = sort(combinations(stack));

            if (paths.length > config.threshold) {
              return fallback ? fallback() : null;
            }

            for (let i = 0; i < paths.length; i++) {
              if (unique(paths[i])) {
                return paths[i];
              }
            }

            return null;
          }

          function selector(path) {
            let node = path[0];
            let query = node.name;
            for (let i = 1; i < path.length; i++) {
              const level = path[i].level || 0;

              if (node.level === level - 1) {
                query = path[i].name + ' > ' + query;
              } else {
                query = path[i].name + ' ' + query;
              }

              node = path[i];
            }
            return query;
          }

          function penalty(path) {
            return path.map(function (node) { return node.penalty; })
              .reduce(function (acc, i) { return acc + i; }, 0);
          }

          function unique(path) {
            const elements = rootDocument.querySelectorAll(selector(path));
            switch (elements.length) {
              case 0:
                throw new Error("Can't select any node with this selector: " + selector(path));
              case 1:
                return true;
              default:
                return false;
            }
          }

          function id(input) {
            const elementId = input.getAttribute('id');
            if (elementId && config.idName(elementId)) {
              return {
                name: '#' + cssesc(elementId, { isIdentifier: true }),
                penalty: 0
              };
            }
            return null;
          }

          function attr(input) {
            const attrs = Array.from(input.attributes).filter(function (attr) {
              return config.attr(attr.name, attr.value) && attr.name !== 'data-mx-id';
            });

            return attrs.map(function (attr) {
              let attrValue = attr.value;

              if (attr.name === 'href' && attr.value.includes('://')) {
                try {
                  const url = new URL(attr.value);
                  const siteOrigin = url.protocol + '//' + url.host;
                  attrValue = attr.value.replace(siteOrigin, '');
                } catch (e) {
                  // Keep original if URL parsing fails
                }
              }

              return {
                name: '[' + cssesc(attr.name, { isIdentifier: true }) + '="' + cssesc(attrValue) + '"]',
                penalty: 0.5
              };
            });
          }

          function classNames(input) {
            const names = Array.from(input.classList).filter(config.className);

            return names.map(function (name) {
              return {
                name: '.' + cssesc(name, { isIdentifier: true }),
                penalty: 1
              };
            });
          }

          function tagName(input) {
            const name = input.tagName.toLowerCase();
            if (config.tagName(name)) {
              return {
                name: name,
                penalty: 2
              };
            }
            return null;
          }

          function any() {
            return {
              name: '*',
              penalty: 3
            };
          }

          function index(input) {
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

          function nthChild(node, i) {
            return {
              name: node.name + ':nth-child(' + i + ')',
              penalty: node.penalty + 1
            };
          }

          function dispensableNth(node) {
            return node.name !== 'html' && !node.name.startsWith('#');
          }

          function maybe() {
            const args = Array.prototype.slice.call(arguments);
            const list = args.filter(notEmpty);
            if (list.length > 0) {
              return list;
            }
            return null;
          }

          function notEmpty(value) {
            return value !== null && value !== undefined;
          }

          function combinations(stack, path) {
            path = path || [];
            const results = [];

            function* generate(s, p) {
              if (s.length > 0) {
                for (let i = 0; i < s[0].length; i++) {
                  yield* generate(s.slice(1), p.concat(s[0][i]));
                }
              } else {
                yield p;
              }
            }

            const gen = generate(stack, path);
            let next = gen.next();
            while (!next.done) {
              results.push(next.value);
              next = gen.next();
            }
            return results;
          }

          function sort(paths) {
            return Array.from(paths).sort(function (a, b) {
              return penalty(a) - penalty(b);
            });
          }

          function* optimize(path, input, scope) {
            scope = scope || {
              counter: 0,
              visited: new Map()
            };

            if (path.length > 2 && path.length > config.optimizedMinLength) {
              for (let i = 1; i < path.length - 1; i++) {
                if (scope.counter > config.maxNumberOfTries) {
                  return;
                }
                scope.counter += 1;
                const newPath = path.slice();
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
                } catch (e) {
                  continue;
                }
              }
            }
          }

          function same(path, input) {
            return rootDocument.querySelector(selector(path)) === input;
          }

          // ===== CSSESC UTILITY =====
          const regexAnySingleEscape = /[ -,\.\/:-@\[-\^`\{-~]/;
          const regexSingleEscape = /[ -,\.\/:-@\[\]\^`\{-~]/;
          const regexExcessiveSpaces = /(^|\\+)?(\\[A-F0-9]{1,6})\x20(?![a-fA-F0-9\x20])/g;

          const defaultCssEscOptions = {
            escapeEverything: false,
            isIdentifier: false,
            quotes: 'single',
            wrap: false
          };

          function cssesc(string, opt) {
            const options = Object.assign({}, defaultCssEscOptions, opt || {});
            if (options.quotes != 'single' && options.quotes != 'double') {
              options.quotes = 'single';
            }
            const quote = options.quotes == 'double' ? '"' : "'";
            const isIdentifier = options.isIdentifier;

            const firstChar = string.charAt(0);
            let output = '';
            let counter = 0;
            const length = string.length;

            while (counter < length) {
              const character = string.charAt(counter++);
              let codePoint = character.charCodeAt(0);
              let value = undefined;

              if (codePoint < 0x20 || codePoint > 0x7e) {
                if (codePoint >= 0xd800 && codePoint <= 0xdbff && counter < length) {
                  const extra = string.charCodeAt(counter++);
                  if ((extra & 0xfc00) == 0xdc00) {
                    codePoint = ((codePoint & 0x3ff) << 10) + (extra & 0x3ff) + 0x10000;
                  } else {
                    counter--;
                  }
                }
                value = '\\' + codePoint.toString(16).toUpperCase() + ' ';
              } else {
                if (options.escapeEverything) {
                  if (regexAnySingleEscape.test(character)) {
                    value = '\\' + character;
                  } else {
                    value = '\\' + codePoint.toString(16).toUpperCase() + ' ';
                  }
                } else if (/[\t\n\f\r\x0B]/.test(character)) {
                  value = '\\' + codePoint.toString(16).toUpperCase() + ' ';
                } else if (
                  character == '\\' ||
                  (!isIdentifier && ((character == '"' && quote == character) || (character == "'" && quote == character))) ||
                  (isIdentifier && regexSingleEscape.test(character))
                ) {
                  value = '\\' + character;
                } else {
                  value = character;
                }
              }
              output += value;
            }

            if (isIdentifier) {
              if (/^-[-\d]/.test(output)) {
                output = '\\-' + output.slice(1);
              } else if (/\d/.test(firstChar)) {
                output = '\\3' + firstChar + ' ' + output.slice(1);
              }
            }

            output = output.replace(regexExcessiveSpaces, function ($0, $1, $2) {
              if ($1 && $1.length % 2) {
                return $0;
              }
              return ($1 || '') + $2;
            });

            if (!isIdentifier && options.wrap) {
              return quote + output + quote;
            }
            return output;
          }

          function getDeepestElementFromPoint(x, y) {
            let elements = iframeDoc.elementsFromPoint(x, y);
            if (!elements || elements.length === 0) return null;

            const dialogElement = elements.find(function (el) {
              return el.getAttribute('role') === 'dialog';
            });

            if (dialogElement) {
              const dialogElements = elements.filter(function (el) {
                return el === dialogElement || dialogElement.contains(el);
              });

              const findDeepestInDialog = function (elems) {
                if (!elems.length) return null;
                if (elems.length === 1) return elems[0];

                let deepestElement = elems[0];
                let maxDepth = 0;

                for (let i = 0; i < elems.length; i++) {
                  let depth = 0;
                  let current = elems[i];

                  while (current && current.parentElement && current !== dialogElement.parentElement) {
                    depth++;
                    current = current.parentElement;
                  }

                  if (depth > maxDepth) {
                    maxDepth = depth;
                    deepestElement = elems[i];
                  }
                }

                return deepestElement;
              };

              return findDeepestInDialog(dialogElements);
            }

            const findDeepestElement = function (elems) {
              if (!elems.length) return null;
              if (elems.length === 1) return elems[0];

              for (let i = 0; i < Math.min(3, elems.length); i++) {
                const element = elems[i];
                const style = window.getComputedStyle(element);
                const zIndex = parseInt(style.zIndex) || 0;

                if ((style.position === 'fixed' || style.position === 'absolute') && zIndex > 50) {
                  return element;
                }

                if (element.tagName === 'SVG' && i < 2) {
                  return element;
                }
              }

              let deepestElement = elems[0];
              let maxDepth = 0;

              for (let i = 0; i < elems.length; i++) {
                let depth = 0;
                let current = elems[i];

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
                  deepestElement = elems[i];
                }
              }

              return deepestElement;
            };

            let deepestElement = findDeepestElement(elements);
            if (!deepestElement) return null;

            const traverseShadowDOM = function (element) {
              let current = element;
              let shadowRoot = current.shadowRoot;
              let deepest = current;
              let depth = 0;
              const MAX_SHADOW_DEPTH = 4;

              while (shadowRoot && depth < MAX_SHADOW_DEPTH) {
                const shadowElement = shadowRoot.elementFromPoint(x, y);
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
          }

          // ===== SELECTOR GENERATION =====
          function genAttributeSet(element, attributes) {
            return new Set(
              attributes.filter(function (attr) {
                const attrValue = element.getAttribute(attr);
                return attrValue != null && attrValue.length > 0;
              })
            );
          }

          function isAttributesDefined(element, attributes) {
            return genAttributeSet(element, attributes).size > 0;
          }

          function genValidAttributeFilter(element, attributes) {
            const attrSet = genAttributeSet(element, attributes);
            return function (name) { return attrSet.has(name); };
          }

          function genSelectorForAttributes(element, attributes) {
            let selector = null;
            try {
              if (attributes.includes('rel') && element.hasAttribute('rel')) {
                const relValue = element.getAttribute('rel');
                return '[rel="' + relValue + '"]';
              }

              selector = isAttributesDefined(element, attributes)
                ? finder(element, {
                  idName: function () { return false; },
                  attr: genValidAttributeFilter(element, attributes)
                })
                : null;
            } catch (e) { }

            return selector;
          }

          function isCharacterNumber(char) {
            return char && char.length === 1 && /[0-9]/.test(char);
          }

          function generateMandatoryCSSFallback(element) {
            const mxId = Math.floor(Math.random() * 10000).toString();
            element.setAttribute('data-mx-id', mxId);
            return element.tagName.toLowerCase() + '[data-mx-id="' + mxId + '"]';
          }

          function genSelectors(element) {
            if (element == null) {
              return null;
            }

            const href = element.getAttribute('href');

            let generalSelector = null;
            try {
              generalSelector = finder(element);
            } catch (e) { }

            let attrSelector = null;
            try {
              attrSelector = finder(element, {
                attr: function () { return true; }
              });
            } catch (e) { }

            const relSelector = genSelectorForAttributes(element, ['rel']);
            const hrefSelector = genSelectorForAttributes(element, ['href']);
            const formSelector = genSelectorForAttributes(element, ['name', 'placeholder', 'for']);
            const accessibilitySelector = genSelectorForAttributes(element, ['aria-label', 'alt', 'title']);
            const testIdSelector = genSelectorForAttributes(element, [
              'data-testid', 'data-test-id', 'data-testing',
              'data-test', 'data-qa', 'data-cy'
            ]);

            let idSelector = null;
            try {
              const elementId = element.getAttribute('id');
              idSelector = isAttributesDefined(element, ['id']) && !isCharacterNumber(elementId ? elementId[0] : '')
                ? finder(element, {
                  attr: function (name) { return name === 'id'; }
                })
                : null;
            } catch (e) { }

            return {
              id: idSelector,
              generalSelector: generalSelector,
              attrSelector: attrSelector,
              testIdSelector: testIdSelector,
              text: element.innerText,
              href: href || undefined,
              hrefSelector: hrefSelector,
              accessibilitySelector: accessibilitySelector,
              formSelector: formSelector,
              relSelector: relSelector,
              iframeSelector: null,
              shadowSelector: null
            };
          }

          const hoveredElement = getDeepestElementFromPoint(coordinates.x, coordinates.y);

          if (hoveredElement != null) {
            const parentElement = hoveredElement.parentElement;
            const element = (parentElement && parentElement.tagName === 'A') ? parentElement : hoveredElement;

            const generatedSelectors = genSelectors(element);

            return {
              primary: generatedSelectors
            };
          }
        } catch (e) {
        }

        return { primary: null };
      }

      // --- Structural detection helpers ---

      function containsNumericPageLinks(container) {
        var links = container.querySelectorAll('a, button, [role="button"]');
        var numbers = [];
        for (var i = 0; i < links.length; i++) {
          var text = (links[i].textContent || '').trim();
          if (/^\d+$/.test(text)) {
            numbers.push(parseInt(text, 10));
          }
        }
        if (numbers.length < 2) return false;
        numbers.sort(function (a, b) { return a - b; });
        for (var j = 0; j < numbers.length - 1; j++) {
          if (numbers[j + 1] - numbers[j] === 1) return true;
        }
        return false;
      }

      function containsPaginationLinks(container) {
        var links = container.querySelectorAll('a, button, [role="button"]');
        var numericCount = 0;
        var hasNextPrev = false;
        for (var i = 0; i < links.length; i++) {
          var text = (links[i].textContent || '').trim();
          if (/^\d+$/.test(text)) numericCount++;
          if (matchesAnyPattern(text, nextButtonTextPatterns)) hasNextPrev = true;
          if (matchesAnyPattern(text, loadMorePatterns)) hasNextPrev = true;
        }
        return numericCount >= 2 || hasNextPrev;
      }

      function getListContainer(listElements) {
        if (listElements.length === 0) return listElements[0];
        var firstParent = listElements[0].parentElement;
        if (!firstParent) return listElements[0];

        var allShareParent = listElements.every(function (el) { return el.parentElement === firstParent; });
        if (allShareParent) return firstParent;

        var ancestor = firstParent;
        while (ancestor) {
          var a = ancestor;
          if (listElements.every(function (el) { return a.contains(el); })) {
            return ancestor;
          }
          ancestor = ancestor.parentElement;
        }
        return firstParent;
      }

      function findPaginationContainer(listCont) {
        var scope = listCont.parentElement;
        var MAX_LEVELS = 4;

        for (var level = 0; level < MAX_LEVELS && scope; level++) {
          var children = Array.from(scope.children);

          for (var i = 0; i < children.length; i++) {
            var child = children[i];
            if (child === listCont || child.contains(listCont) || listCont.contains(child)) continue;
            if (!isVisible(child)) continue;

            var classAndLabel = (child.className || '') + ' ' + (child.getAttribute('aria-label') || '') + ' ' + (child.getAttribute('role') || '');
            if (paginationContainerPattern.test(classAndLabel)) {
              return child;
            }

            if (child.tagName === 'NAV') {
              if (containsPaginationLinks(child)) {
                return child;
              }
            }

            if (containsNumericPageLinks(child)) {
              return child;
            }
          }

          scope = scope.parentElement;
        }
        return null;
      }

      function findLastPageLink(container) {
        var links = Array.from(container.querySelectorAll('a, button, [role="button"]'));
        for (var i = 0; i < links.length; i++) {
          var link = links[i];
          var isActive = link.getAttribute('aria-current') === 'page' ||
            link.classList.contains('active') ||
            link.classList.contains('current') ||
            link.classList.contains('selected') ||
            (link.closest('[aria-current="page"]') !== null);

          if (isActive && i + 1 < links.length) {
            return links[i + 1];
          }
        }
        return null;
      }

      // --- Phase functions ---

      function detectFromPaginationWrapper(wrapper) {
        var clickables = getClickableElements(wrapper);

        var nextBtn = null;
        var nextScore = 0;
        var loadMoreBtn = null;
        var lmScore = 0;

        for (var i = 0; i < clickables.length; i++) {
          var element = clickables[i];
          if (!isVisible(element)) continue;
          if (element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true') continue;

          var text = (element.textContent || '').trim();
          var ariaLabel = element.getAttribute('aria-label') || '';
          var title = element.getAttribute('title') || '';
          if (text.length > MAX_BUTTON_TEXT_LENGTH) continue;

          var combinedText = text + ' ' + ariaLabel + ' ' + title;

          if (matchesAnyPattern(combinedText, loadMorePatterns)) {
            if (20 > lmScore) {
              lmScore = 20;
              loadMoreBtn = element;
            }
          }

          if (isNextButton(text, ariaLabel, combinedText)) {
            if (20 > nextScore) {
              nextScore = 20;
              nextBtn = element;
            }
          }
        }

        var hasNumberedPages = containsNumericPageLinks(wrapper);

        if (loadMoreBtn) {
          return { type: 'clickLoadMore', selector: generatePaginationSelector(loadMoreBtn), confidence: 'high' };
        }

        if (nextBtn) {
          return { type: 'clickNext', selector: generatePaginationSelector(nextBtn), confidence: 'high' };
        }

        if (hasNumberedPages) {
          var lastLink = findLastPageLink(wrapper);
          if (lastLink) {
            return { type: 'clickNext', selector: generatePaginationSelector(lastLink), confidence: 'medium' };
          }
        }

        return null;
      }

      function detectFromNearbyElements(listCont) {
        var clickables = getClickableElements(document);

        var nextBtn = null;
        var nextScore = 0;
        var loadMoreBtn = null;
        var lmScore = 0;

        for (var i = 0; i < clickables.length; i++) {
          var element = clickables[i];
          if (!isVisible(element)) continue;
          if (isSkippable(element, listCont)) continue;

          var text = (element.textContent || '').trim();
          var ariaLabel = element.getAttribute('aria-label') || '';
          var title = element.getAttribute('title') || '';
          if (text.length > MAX_BUTTON_TEXT_LENGTH) continue;

          var combinedText = text + ' ' + ariaLabel + ' ' + title;
          if (!isNearList(element, listCont)) continue;

          if (matchesAnyPattern(combinedText, loadMorePatterns)) {
            var score = 15;
            if (element.tagName === 'BUTTON') score += 2;
            var className = element.className || '';
            if (paginationContainerPattern.test(className)) score += 3;
            if (score > lmScore) {
              lmScore = score;
              loadMoreBtn = element;
            }
          }

          if (isNextButton(text, ariaLabel, combinedText)) {
            var nScore = 15;
            if (element.tagName === 'BUTTON') nScore += 2;
            var cn = element.className || '';
            if (paginationContainerPattern.test(cn)) nScore += 3;
            try {
              var pagAnc = element.closest('[class*="paginat"], [class*="pager"]');
              if (pagAnc) nScore += 5;
            } catch (e) { }
            if (nScore > nextScore) {
              nextScore = nScore;
              nextBtn = element;
            }
          }
        }

        if (loadMoreBtn && lmScore >= 15) {
          var conf = lmScore >= 18 ? 'high' : 'medium';
          return { type: 'clickLoadMore', selector: generatePaginationSelector(loadMoreBtn), confidence: conf };
        }

        if (nextBtn && nextScore >= 15) {
          var nConf = nextScore >= 18 ? 'high' : 'medium';
          return { type: 'clickNext', selector: generatePaginationSelector(nextBtn), confidence: nConf };
        }

        return null;
      }

      function detectInfiniteScrollScore() {
        try {
          var score = 0;
          var initialHeight = document.documentElement.scrollHeight;
          var viewportHeight = window.innerHeight;

          if (initialHeight <= viewportHeight) return 0;

          var sentinelPatterns = [
            '[data-infinite]', '[data-scroll-trigger]',
            '#infinite-scroll-trigger', '[class*="infinite-scroll"]', '[id*="infinite-scroll"]',
          ];
          for (var i = 0; i < sentinelPatterns.length; i++) {
            if (document.querySelector(sentinelPatterns[i])) { score += 6; break; }
          }

          var infiniteScrollLibraries = [
            '.infinite-scroll', '[data-infinite-scroll]', '[class*="infinite-scroll"]',
          ];
          for (var j = 0; j < infiniteScrollLibraries.length; j++) {
            if (document.querySelector(infiniteScrollLibraries[j])) { score += 6; break; }
          }

          var scrollToTopPatterns = [
            '.back-to-top', '#back-to-top', '[class*="scrolltop"]', '[class*="backtotop"]',
          ];
          for (var k = 0; k < scrollToTopPatterns.length; k++) {
            try {
              var el = document.querySelector(scrollToTopPatterns[k]);
              if (el && isVisible(el)) { score += 2; break; }
            } catch (e) { continue; }
          }

          if (initialHeight > viewportHeight * 5) score += 2;
          return score;
        } catch (e) {
          return 0;
        }
      }

      function detectFromFullDocument(listCont) {
        var clickables = getClickableElements(document);

        var nextBtn = null;
        var nextScore = 0;
        var loadMoreBtn = null;
        var lmScore = 0;

        for (var i = 0; i < clickables.length; i++) {
          var element = clickables[i];
          if (!isVisible(element)) continue;
          if (isSkippable(element, listCont)) continue;

          var text = (element.textContent || '').trim();
          var ariaLabel = element.getAttribute('aria-label') || '';
          var title = element.getAttribute('title') || '';
          if (text.length > MAX_BUTTON_TEXT_LENGTH) continue;

          var combinedText = text + ' ' + ariaLabel + ' ' + title;
          var nearList = isNearList(element, listCont);

          if (matchesAnyPattern(combinedText, loadMorePatterns)) {
            var score = 10;
            if (nearList) score += 5;
            if (element.tagName === 'BUTTON') score += 2;
            if (score > lmScore) {
              lmScore = score;
              loadMoreBtn = element;
            }
          }

          if (isNextButton(text, ariaLabel, combinedText)) {
            var nScore = 10;
            if (nearList) nScore += 5;
            if (element.tagName === 'BUTTON') nScore += 2;
            if (nScore > nextScore) {
              nextScore = nScore;
              nextBtn = element;
            }
          }
        }

        if (loadMoreBtn && lmScore >= 10) {
          var conf = lmScore >= 15 ? 'medium' : 'low';
          return { type: 'clickLoadMore', selector: generatePaginationSelector(loadMoreBtn), confidence: conf };
        }

        if (nextBtn && nextScore >= 10) {
          var nConf = nextScore >= 15 ? 'medium' : 'low';
          return { type: 'clickNext', selector: generatePaginationSelector(nextBtn), confidence: nConf };
        }

        return null;
      }

      var listElements = evaluateSelector(listSelector, document);
      if (listElements.length === 0) {
        return { type: '', selector: null, confidence: 'low', debug: 'No list elements found' };
      }

      var listContainer = getListContainer(listElements);

      var paginationWrapper = findPaginationContainer(listContainer);
      if (paginationWrapper) {
        var scopedResult = detectFromPaginationWrapper(paginationWrapper);
        if (scopedResult) return scopedResult;
      }

      var nearbyResult = detectFromNearbyElements(listContainer);
      if (nearbyResult) return nearbyResult;

      var infiniteScrollScore = (options && options.disableScrollDetection)
        ? 0
        : detectInfiniteScrollScore();

      if (infiniteScrollScore >= 8) {
        var confidence = infiniteScrollScore >= 15 ? 'high' : infiniteScrollScore >= 12 ? 'medium' : 'low';
        return { type: 'scrollDown', selector: null, confidence: confidence };
      }

      var fallbackResult = detectFromFullDocument(listContainer);
      if (fallbackResult) return fallbackResult;

      return {
        type: '',
        selector: null,
        confidence: 'low',
        debug: {
          listElementsCount: listElements.length,
          paginationWrapperFound: !!paginationWrapper,
          infiniteScrollScore: infiniteScrollScore
        }
      };

    } catch (error) {
      return {
        type: '',
        selector: null,
        confidence: 'low',
        error: error.message,
        debug: 'Exception thrown: ' + error.message
      };
    }
  };

  /**
   * Analyze element groups on the page
   * Returns grouped elements with their structural fingerprints
   */
  window.analyzeElementGroups = function() {
    try {
      const normalizeClasses = (classList) => {
        return Array.from(classList)
          .filter((cls) => {
            return (
              !cls.match(/\d{3,}|uuid|hash|id-|_\d+$/i) &&
              !cls.startsWith('_ngcontent-') &&
              !cls.startsWith('_nghost-') &&
              !cls.match(/^ng-tns-c\d+-\d+$/)
            );
          })
          .sort()
          .join(' ');
      };

      const getStructuralFingerprint = (element) => {
        if (element.nodeType !== Node.ELEMENT_NODE) return null;

        const tagName = element.tagName.toLowerCase();
        const isCustomElement = tagName.includes('-');

        const standardExcludeSelectors = ['script', 'style', 'meta', 'link', 'title', 'head'];
        if (!isCustomElement && standardExcludeSelectors.includes(tagName)) {
          return null;
        }

        const children = Array.from(element.children);
        let childrenStructureString;

        if (tagName === 'table') {
          const thead = element.querySelector('thead');
          const representativeRow = thead ? thead.querySelector('tr') : element.querySelector('tr');

          if (representativeRow) {
            const structure = Array.from(representativeRow.children).map(child => ({
              tag: child.tagName.toLowerCase(),
              classes: normalizeClasses(child.classList),
            }));
            childrenStructureString = JSON.stringify(structure);
          } else {
            childrenStructureString = JSON.stringify([]);
          }
        } else if (tagName === 'tr') {
          const structure = children.map((child) => ({
            tag: child.tagName.toLowerCase(),
            classes: normalizeClasses(child.classList),
          }));
          childrenStructureString = JSON.stringify(structure);
        } else {
          const structure = children.map((child) => ({
            tag: child.tagName.toLowerCase(),
            classes: normalizeClasses(child.classList),
            hasText: (child.textContent ?? '').trim().length > 0,
          }));
          childrenStructureString = JSON.stringify(structure);
        }

        const normalizedClasses = normalizeClasses(element.classList);

        const relevantAttributes = Array.from(element.attributes)
          .filter((attr) => {
            if (isCustomElement) {
              return !['id', 'style', 'data-reactid', 'data-react-checksum'].includes(attr.name.toLowerCase());
            } else {
              return (
                !['id', 'style', 'data-reactid', 'data-react-checksum'].includes(attr.name.toLowerCase()) &&
                (!attr.name.startsWith('data-') || attr.name === 'data-type' || attr.name === 'data-role')
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

        const textContent = (element.textContent ?? '').trim();
        const textCharacteristics = {
          hasText: textContent.length > 0,
          textLength: Math.floor(textContent.length / 20) * 20,
          hasLinks: element.querySelectorAll('a').length,
          hasImages: element.querySelectorAll('img').length,
          hasButtons: element.querySelectorAll('button, input[type="button"], input[type="submit"]').length,
        };

        const signature = `${tagName}::${normalizedClasses}::${children.length}::${childrenStructureString}::${relevantAttributes.join('|')}`;

        return {
          tagName,
          normalizedClasses,
          childrenCount: children.length,
          childrenStructure: childrenStructureString,
          attributes: relevantAttributes.join('|'),
          depth,
          textCharacteristics,
          signature,
        };
      };

      const calculateSimilarity = (fp1, fp2) => {
        if (!fp1 || !fp2) return 0;

        let score = 0;
        let maxScore = 0;

        maxScore += 10;
        if (fp1.tagName === fp2.tagName) score += 10;
        else return 0;

        maxScore += 8;
        if (fp1.normalizedClasses === fp2.normalizedClasses) score += 8;
        else if (fp1.normalizedClasses && fp2.normalizedClasses) {
          const classes1 = fp1.normalizedClasses.split(' ').filter((c) => c);
          const classes2 = fp2.normalizedClasses.split(' ').filter((c) => c);
          const commonClasses = classes1.filter((c) => classes2.includes(c));
          if (classes1.length > 0 && classes2.length > 0) {
            score += (commonClasses.length / Math.max(classes1.length, classes2.length)) * 8;
          }
        }

        maxScore += 8;
        if (fp1.childrenStructure === fp2.childrenStructure) score += 8;
        else if (fp1.childrenCount === fp2.childrenCount) score += 4;

        maxScore += 5;
        if (fp1.attributes === fp2.attributes) score += 5;
        else if (fp1.attributes && fp2.attributes) {
          const attrs1 = fp1.attributes.split('|').filter((a) => a);
          const attrs2 = fp2.attributes.split('|').filter((a) => a);
          const commonAttrs = attrs1.filter((a) => attrs2.includes(a));
          if (attrs1.length > 0 && attrs2.length > 0) {
            score += (commonAttrs.length / Math.max(attrs1.length, attrs2.length)) * 5;
          }
        }

        maxScore += 2;
        if (Math.abs(fp1.depth - fp2.depth) <= 1) score += 2;
        else if (Math.abs(fp1.depth - fp2.depth) <= 2) score += 1;

        maxScore += 3;
        const tc1 = fp1.textCharacteristics;
        const tc2 = fp2.textCharacteristics;
        if (tc1.hasText === tc2.hasText) score += 1;
        if (Math.abs(tc1.textLength - tc2.textLength) <= 40) score += 1;
        if (tc1.hasLinks === tc2.hasLinks && tc1.hasImages === tc2.hasImages) score += 1;

        return maxScore > 0 ? score / maxScore : 0;
      };

      const hasAnyMeaningfulChildren = (element) => {
        const meaningfulChildren = [];

        const traverse = (el, depth) => {
          if (depth === undefined) depth = 0;
          if (depth > 5) return;

          Array.from(el.children).forEach(function(child) {
            const tagName = child.tagName.toLowerCase();

            if (tagName === 'img' && child.hasAttribute('src')) {
              meaningfulChildren.push(child);
              return;
            }

            if (tagName === 'a' && child.hasAttribute('href')) {
              meaningfulChildren.push(child);
              return;
            }

            const text = (child.textContent || '').trim();
            const hasVisibleText = text.length > 0;

            if (hasVisibleText || child.querySelector('svg')) {
              meaningfulChildren.push(child);
              return;
            }

            if (child.children.length > 0) {
              traverse(child, depth + 1);
            }
          });

          if (el.shadowRoot) {
            Array.from(el.shadowRoot.children).forEach(function(shadowChild) {
              const tagName = shadowChild.tagName.toLowerCase();

              if (tagName === 'img' && shadowChild.hasAttribute('src')) {
                meaningfulChildren.push(shadowChild);
                return;
              }

              if (tagName === 'a' && shadowChild.hasAttribute('href')) {
                meaningfulChildren.push(shadowChild);
                return;
              }

              const text = (shadowChild.textContent || '').trim();
              const hasVisibleText = text.length > 0;

              if (hasVisibleText || shadowChild.querySelector('svg')) {
                meaningfulChildren.push(shadowChild);
                return;
              }

              if (shadowChild.children.length > 0) {
                traverse(shadowChild, depth + 1);
              }
            });
          }
        };

        traverse(element);
        return meaningfulChildren.length > 0;
      };

      const getAllVisibleElements = () => {
        const allElements = [];
        const visited = new Set();

        const traverseContainer = (container) => {
          try {
            const elements = Array.from(container.querySelectorAll('*')).filter((el) => {
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            });

            elements.forEach((element) => {
              if (!visited.has(element)) {
                visited.add(element);
                allElements.push(element);

                if (element.shadowRoot) {
                  traverseContainer(element.shadowRoot);
                }
              }
            });
          } catch (error) {
            console.warn('Error traversing container:', error);
          }
        };

        traverseContainer(document);
        return allElements;
      };

      const allElements = getAllVisibleElements();
      const processedInTables = new Set();
      const elementGroups = new Map();
      const groupedElements = new Set();

      const tables = allElements.filter(el => el.tagName === 'TABLE');
      tables.forEach(table => {
        const rows = Array.from(table.querySelectorAll('tbody > tr')).filter(row => {
          const parent = row.parentElement;
          if (!parent || !table.contains(parent)) return false;

          const rect = row.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });

        if (rows.length >= 2) {
          const representativeFingerprint = getStructuralFingerprint(rows[0]);
          if (!representativeFingerprint) return;

          const group = {
            elements: rows,
            fingerprint: representativeFingerprint,
            representative: rows[0],
          };

          rows.forEach(row => {
            elementGroups.set(row, group);
            groupedElements.add(row);
            processedInTables.add(row);
          });
        }
      });

      const remainingElements = allElements.filter(el => !processedInTables.has(el));
      const elementFingerprints = new Map();
      remainingElements.forEach((element) => {
        const fingerprint = getStructuralFingerprint(element);
        if (fingerprint) {
          elementFingerprints.set(element, fingerprint);
        }
      });

      const processedElements = new Set();
      const similarityThreshold = 0.7;
      const minGroupSize = 2;
      const maxParentLevels = 5;

      elementFingerprints.forEach((fingerprint, element) => {
        if (processedElements.has(element)) return;

        const currentGroup = [element];
        processedElements.add(element);

        elementFingerprints.forEach((otherFingerprint, otherElement) => {
          if (processedElements.has(otherElement)) return;

          const similarity = calculateSimilarity(fingerprint, otherFingerprint);
          if (similarity >= similarityThreshold) {
            currentGroup.push(otherElement);
            processedElements.add(otherElement);
          }
        });

        if (currentGroup.length >= minGroupSize && hasAnyMeaningfulChildren(element)) {
          let grouped = false;

          for (let level = 1; level <= maxParentLevels && !grouped; level++) {
            let ancestor = currentGroup[0];
            for (let i = 0; i < level && ancestor; i++) {
              ancestor = ancestor.parentElement;
            }

            if (!ancestor) break;

            const allShareAncestor = currentGroup.every(el => {
              let elAncestor = el;
              for (let i = 0; i < level && elAncestor; i++) {
                elAncestor = elAncestor.parentElement;
              }
              return elAncestor === ancestor;
            });

            if (allShareAncestor) {
              const group = {
                elements: currentGroup,
                fingerprint,
                representative: element,
              };
              currentGroup.forEach((el) => {
                elementGroups.set(el, group);
                groupedElements.add(el);
              });
              grouped = true;
            }
          }

          if (!grouped) {
            currentGroup.forEach((el, idx) => {
              if (idx > 0) processedElements.delete(el);
            });
          }
        }
      });

      const uniqueGroups = new Map();
      elementGroups.forEach((group) => {
        const signature = group.fingerprint.signature;
        if (!uniqueGroups.has(signature)) {
          const tagName = group.fingerprint.tagName;
          const classes = group.fingerprint.normalizedClasses.split(' ').filter(Boolean);

          let xpath = `//${tagName}`;
          if (classes.length > 0) {
            const classConditions = classes.map(cls => `contains(@class, '${cls}')`).join(' and ');
            xpath += `[${classConditions}]`;
          }

          const sampleTexts = group.elements.slice(0, 3).map((el) => {
            return (el.textContent || '').trim().substring(0, 200);
          });

          const sampleHTML = group.representative.outerHTML.substring(0, 500);

          uniqueGroups.set(signature, {
            fingerprint: group.fingerprint,
            count: group.elements.length,
            xpath: xpath,
            sampleTexts: sampleTexts,
            sampleHTML: sampleHTML,
          });
        }
      });

      return Array.from(uniqueGroups.values());
    } catch (error) {
      console.error('[analyzeElementGroups] Error:', error);
      return [];
    }
  };

})();
