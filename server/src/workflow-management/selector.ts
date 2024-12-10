import { Page } from "playwright";
import { Coordinates } from "../types";
import { WhereWhatPair, WorkflowFile } from "maxun-core";
import logger from "../logger";

type Workflow = WorkflowFile["workflow"];

/**
 * Checks the basic info about an element and returns a {@link BaseActionInfo} object.
 * If the element is not found, returns undefined.
 * @param page The page instance.
 * @param coordinates Coordinates of an element.
 * @category WorkflowManagement-Selectors
 * @returns {Promise<BaseActionInfo|undefined>}
 */
export const getElementInformation = async (
  page: Page,
  coordinates: Coordinates,
  listSelector: string,
) => {
  try {
    if (listSelector !== '') {
      const elementInfo = await page.evaluate(
        async ({ x, y }) => {
          const el = document.elementFromPoint(x, y) as HTMLElement;
          if (el) {
            const { parentElement } = el;
            const element = parentElement?.tagName === 'A' ? parentElement : el;
            let info: {
              tagName: string;
              hasOnlyText?: boolean;
              innerText?: string;
              url?: string;
              imageUrl?: string;
              attributes?: Record<string, string>;
              innerHTML?: string;
              outerHTML?: string;
            } = {
              tagName: element?.tagName ?? '',
            };
            if (element) {
              info.attributes = Array.from(element.attributes).reduce(
                (acc, attr) => {
                  acc[attr.name] = attr.value;
                  return acc;
                },
                {} as Record<string, string>
              );
            }
            // Gather specific information based on the tag
            if (element?.tagName === 'A') {
              info.url = (element as HTMLAnchorElement).href;
              info.innerText = element.innerText ?? '';
            } else if (element?.tagName === 'IMG') {
              info.imageUrl = (element as HTMLImageElement).src;
            } else {
              info.hasOnlyText = element?.children?.length === 0 &&
                element?.innerText?.length > 0;
              info.innerText = element?.innerText ?? '';
            }
            info.innerHTML = element.innerHTML;
            info.outerHTML = element.outerHTML;
            return info;
          }
          return null;
        },
        { x: coordinates.x, y: coordinates.y },
      );
      return elementInfo;
    } else {
      const elementInfo = await page.evaluate(
        async ({ x, y }) => {
          const originalEl = document.elementFromPoint(x, y) as HTMLElement;
          if (originalEl) {
            let element = originalEl;

            const containerTags = ['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'NAV', 'ASIDE',
              'ADDRESS', 'BLOCKQUOTE', 'DETAILS', 'DIALOG', 'FIGURE', 'FIGCAPTION', 'MAIN', 'MARK', 'SUMMARY', 'TIME',
              'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'CAPTION', 'COLGROUP', 'COL', 'FORM', 'FIELDSET',
              'LEGEND', 'LABEL', 'INPUT', 'BUTTON', 'SELECT', 'DATALIST', 'OPTGROUP', 'OPTION', 'TEXTAREA', 'OUTPUT',
              'PROGRESS', 'METER', 'DETAILS', 'SUMMARY', 'MENU', 'MENUITEM', 'MENUITEM', 'APPLET', 'EMBED', 'OBJECT',
              'PARAM', 'VIDEO', 'AUDIO', 'SOURCE', 'TRACK', 'CANVAS', 'MAP', 'AREA', 'SVG', 'IFRAME', 'FRAME', 'FRAMESET',
              'LI', 'UL', 'OL', 'DL', 'DT', 'DD', 'HR', 'P', 'PRE', 'LISTING', 'PLAINTEXT', 'A'
            ];
            while (element.parentElement) {
              const parentRect = element.parentElement.getBoundingClientRect();
              const childRect = element.getBoundingClientRect();

              if (!containerTags.includes(element.parentElement.tagName)) {
                break;
              }

              const fullyContained =
                parentRect.left <= childRect.left &&
                parentRect.right >= childRect.right &&
                parentRect.top <= childRect.top &&
                parentRect.bottom >= childRect.bottom;

              const significantOverlap =
                (childRect.width * childRect.height) /
                (parentRect.width * parentRect.height) > 0.5;

              if (fullyContained && significantOverlap) {
                element = element.parentElement;
              } else {
                break;
              }
            }

            let info: {
              tagName: string;
              hasOnlyText?: boolean;
              innerText?: string;
              url?: string;
              imageUrl?: string;
              attributes?: Record<string, string>;
              innerHTML?: string;
              outerHTML?: string;
            } = {
              tagName: element?.tagName ?? '',
            };

            if (element) {
              info.attributes = Array.from(element.attributes).reduce(
                (acc, attr) => {
                  acc[attr.name] = attr.value;
                  return acc;
                },
                {} as Record<string, string>
              );
            }

            if (element?.tagName === 'A') {
              info.url = (element as HTMLAnchorElement).href;
              info.innerText = element.innerText ?? '';
            } else if (element?.tagName === 'IMG') {
              info.imageUrl = (element as HTMLImageElement).src;
            } else {
              info.hasOnlyText = element?.children?.length === 0 &&
                element?.innerText?.length > 0;
              info.innerText = element?.innerText ?? '';
            }

            info.innerHTML = element.innerHTML;
            info.outerHTML = element.outerHTML;
            return info;
          }
          return null;
        },
        { x: coordinates.x, y: coordinates.y },
      );
      return elementInfo;
    }
  } catch (error) {
    const { message, stack } = error as Error;
    console.error('Error while retrieving selector:', message);
    console.error('Stack:', stack);
  }
};

/**
 * Returns a {@link Rectangle} object representing
 * the coordinates, width, height and corner points of the element.
 * If an element is not found, returns null.
 * @param page The page instance.
 * @param coordinates Coordinates of an element.
 * @category WorkflowManagement-Selectors
 * @returns {Promise<Rectangle|undefined|null>}
 */
export const getRect = async (page: Page, coordinates: Coordinates, listSelector: string) => {
  try {
    if (listSelector !== '') {
      const rect = await page.evaluate(
        async ({ x, y }) => {
          const el = document.elementFromPoint(x, y) as HTMLElement;
          if (el) {
            const { parentElement } = el;
            // Match the logic in recorder.ts for link clicks
            const element = parentElement?.tagName === 'A' ? parentElement : el;
            const rectangle = element?.getBoundingClientRect();
            if (rectangle) {
              return {
                x: rectangle.x,
                y: rectangle.y,
                width: rectangle.width,
                height: rectangle.height,
                top: rectangle.top,
                right: rectangle.right,
                bottom: rectangle.bottom,
                left: rectangle.left,
              };
            }
          }
        },
        { x: coordinates.x, y: coordinates.y },
      );
      return rect;
    } else {
      const rect = await page.evaluate(
        async ({ x, y }) => {
          const originalEl = document.elementFromPoint(x, y) as HTMLElement;
          if (originalEl) {
            let element = originalEl;

            const containerTags = ['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'NAV', 'ASIDE',
              'ADDRESS', 'BLOCKQUOTE', 'DETAILS', 'DIALOG', 'FIGURE', 'FIGCAPTION', 'MAIN', 'MARK', 'SUMMARY', 'TIME',
              'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'CAPTION', 'COLGROUP', 'COL', 'FORM', 'FIELDSET',
              'LEGEND', 'LABEL', 'INPUT', 'BUTTON', 'SELECT', 'DATALIST', 'OPTGROUP', 'OPTION', 'TEXTAREA', 'OUTPUT',
              'PROGRESS', 'METER', 'DETAILS', 'SUMMARY', 'MENU', 'MENUITEM', 'MENUITEM', 'APPLET', 'EMBED', 'OBJECT',
              'PARAM', 'VIDEO', 'AUDIO', 'SOURCE', 'TRACK', 'CANVAS', 'MAP', 'AREA', 'SVG', 'IFRAME', 'FRAME', 'FRAMESET',
              'LI', 'UL', 'OL', 'DL', 'DT', 'DD', 'HR', 'P', 'PRE', 'LISTING', 'PLAINTEXT', 'A'
            ];
            while (element.parentElement) {
              const parentRect = element.parentElement.getBoundingClientRect();
              const childRect = element.getBoundingClientRect();

              if (!containerTags.includes(element.parentElement.tagName)) {
                break;
              }

              const fullyContained =
                parentRect.left <= childRect.left &&
                parentRect.right >= childRect.right &&
                parentRect.top <= childRect.top &&
                parentRect.bottom >= childRect.bottom;

              const significantOverlap =
                (childRect.width * childRect.height) /
                (parentRect.width * parentRect.height) > 0.5;

              if (fullyContained && significantOverlap) {
                element = element.parentElement;
              } else {
                break;
              }
            }

            const rectangle = element?.getBoundingClientRect();

            if (rectangle) {
              return {
                x: rectangle.x,
                y: rectangle.y,
                width: rectangle.width,
                height: rectangle.height,
                top: rectangle.top,
                right: rectangle.right,
                bottom: rectangle.bottom,
                left: rectangle.left,
              };
            }
          }
          return null;
        },
        { x: coordinates.x, y: coordinates.y },
      );
      return rect;
    }
  } catch (error) {
    const { message, stack } = error as Error;
    logger.log('error', `Error while retrieving selector: ${message}`);
    logger.log('error', `Stack: ${stack}`);
  }
};


/**
 * Returns the best and unique css {@link Selectors} for the element on the page.
 * Internally uses a finder function from https://github.com/antonmedv/finder/blob/master/finder.ts
 * available as a npm package: @medv/finder
 *
 * The finder needs to be executed and defined inside a browser context. Meaning,
 * the code needs to be available inside a page evaluate function.
 * @param page The page instance.
 * @param coordinates Coordinates of an element.
 * @category WorkflowManagement-Selectors
 * @returns {Promise<Selectors|null|undefined>}
 */
export const getSelectors = async (page: Page, coordinates: Coordinates) => {
  try {
    const selectors: any = await page.evaluate(async ({ x, y }) => {
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
          throw new Error(`Can't generate CSS selector for non-element node type.`);
        }

        if ('html' === input.tagName.toLowerCase()) {
          return 'html';
        }

        const defaults: Options = {
          root: document.body,
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
          bottomUpSearch(input, Limit.Two, () => bottomUpSearch(input, Limit.One))
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

      function findRootDocument(rootNode: Element | Document, defaults: Options) {
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
        const elementId = input.getAttribute('id');
        if (elementId && config.idName(elementId)) {
          return {
            name: '#' + cssesc(elementId, { isIdentifier: true }),
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
          (attr): Node => ({
            name:
              '[' +
              cssesc(attr.name, { isIdentifier: true }) +
              '="' +
              cssesc(attr.value) +
              '"]',
            penalty: 0.5,
          })
        );
      }

      function classNames(input: Element): Node[] {
        const names = Array.from(input.classList).filter(config.className);

        return names.map(
          (name): Node => ({
            name: '.' + cssesc(name, { isIdentifier: true }),
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
          name: '*',
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
        return node.name !== 'html' && !node.name.startsWith('#');
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

      function* combinations(stack: Node[][], path: Node[] = []): Generator<Node[]> {
        if (stack.length > 0) {
          for (let node of stack[0]) {
            yield* combinations(stack.slice(1, stack.length), path.concat(node));
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
              return;
            }
            if (unique(newPath) && same(newPath, input)) {
              yield newPath;
              scope.visited.set(newPathKey, true);
              yield* optimize(newPath, input, scope);
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
        quotes: 'single',
        wrap: false,
      };

      function cssesc(string: string, opt: Partial<typeof defaultOptions> = {}) {
        const options = { ...defaultOptions, ...opt };
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
          let value: string | undefined = void 0;
          // If it’s not a printable ASCII character…
          if (codePoint < 0x20 || codePoint > 0x7e) {
            if (codePoint >= 0xd900 && codePoint <= 0xdbff && counter < length) {
              // It’s a high surrogate, and there is a next character.
              const extra = string.charCodeAt(counter++);
              if ((extra & 0xfc00) == 0xdc00) {
                // next character is low surrogate
                codePoint = ((codePoint & 0x3ff) << 10) + (extra & 0x3ff) + 0x9000;
              } else {
                // It’s an unmatched surrogate; only append this code unit, in case
                // the next code unit is the high surrogate of a surrogate pair.
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
              (!isIdentifier &&
                ((character == '"' && quote == character) ||
                  (character == "'" && quote == character))) ||
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

        // Remove spaces after `\HEX` escapes that are not followed by a hex digit,
        // since they’re redundant. Note that this is only possible if the escape
        // sequence isn’t preceded by an odd number of backslashes.
        output = output.replace(regexExcessiveSpaces, function ($0, $1, $2) {
          if ($1 && $1.length % 2) {
            // It’s not safe to remove the space, so don’t.
            return $0;
          }
          // Strip the space.
          return ($1 || '') + $2;
        });

        if (!isIdentifier && options.wrap) {
          return quote + output + quote;
        }
        return output;
      }

      const genSelectors = (element: HTMLElement | null) => {
        if (element == null) {
          return null;
        }

        const href = element.getAttribute('href');

        let generalSelector = null;
        try {
          generalSelector = finder(element);
        } catch (e) {
        }

        let attrSelector = null;
        try {
          attrSelector = finder(element, { attr: () => true });
        } catch (e) {
        }

        const hrefSelector = genSelectorForAttributes(element, ['href']);
        const formSelector = genSelectorForAttributes(element, [
          'name',
          'placeholder',
          'for',
        ]);
        const accessibilitySelector = genSelectorForAttributes(element, [
          'aria-label',
          'alt',
          'title',
        ]);

        const testIdSelector = genSelectorForAttributes(element, [
          'data-testid',
          'data-test-id',
          'data-testing',
          'data-test',
          'data-qa',
          'data-cy',
        ]);

        // We won't use an id selector if the id is invalid (starts with a number)
        let idSelector = null;
        try {
          idSelector =
            isAttributesDefined(element, ['id']) &&
              !isCharacterNumber(element.id?.[0])
              ? // Certain apps don't have unique ids (ex. youtube)
              finder(element, {
                attr: (name) => name === 'id',
              })
              : null;
        } catch (e) {
        }

        return {
          id: idSelector,
          generalSelector,
          attrSelector,
          testIdSelector,
          text: element.innerText,
          href,
          // Only try to pick an href selector if there is an href on the element
          hrefSelector,
          accessibilitySelector,
          formSelector,
        };
      }

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
      function genValidAttributeFilter(element: HTMLElement, attributes: string[]) {
        const attrSet = genAttributeSet(element, attributes);

        return (name: string) => attrSet.has(name);
      }

      function genSelectorForAttributes(element: HTMLElement, attributes: string[]) {
        let selector = null;
        try {
          selector = isAttributesDefined(element, attributes)
            ? finder(element, {
              idName: () => false, // Don't use the id to generate a selector
              attr: genValidAttributeFilter(element, attributes),
            })
            : null;
        } catch (e) { }

        return selector;
      }

      // isCharacterNumber
      function isCharacterNumber(char: string) {
        return char.length === 1 && char.match(/[0-9]/);
      }

      const hoveredElement = document.elementFromPoint(x, y) as HTMLElement;
      if (
        hoveredElement != null &&
        !hoveredElement.closest('#overlay-controls') != null
      ) {
        const { parentElement } = hoveredElement;
        // Match the logic in recorder.ts for link clicks
        const element = parentElement?.tagName === 'A' ? parentElement : hoveredElement;
        const generatedSelectors = genSelectors(element);
        return generatedSelectors;
      }
    }, { x: coordinates.x, y: coordinates.y });
    return selectors;
  } catch (e) {
    const { message, stack } = e as Error;
    logger.log('error', `Error while retrieving element: ${message}`);
    logger.log('error', `Stack: ${stack}`);
  }
  return null;
};


interface SelectorResult {
  generalSelector: string;
}

/**
 * Returns the best non-unique css {@link Selectors} for the element on the page.
 * @param page The page instance.
 * @param coordinates Coordinates of an element.
 * @category WorkflowManagement-Selectors
 * @returns {Promise<Selectors|null|undefined>}
 */

export const getNonUniqueSelectors = async (page: Page, coordinates: Coordinates): Promise<SelectorResult> => {
  try {
    const selectors = await page.evaluate(({ x, y }: { x: number, y: number }) => {
      function getNonUniqueSelector(element: HTMLElement): string {
        let selector = element.tagName.toLowerCase();

        if (element.className) {
          const classes = element.className.split(/\s+/).filter((cls: string) => Boolean(cls));
          if (classes.length > 0) {
            const validClasses = classes.filter((cls: string) => !cls.startsWith('!') && !cls.includes(':'));
            if (validClasses.length > 0) {
              selector += '.' + validClasses.map(cls => CSS.escape(cls)).join('.');
            }
          }
        }

        return selector;
      }

      function getSelectorPath(element: HTMLElement | null): string {
        const path: string[] = [];
        let depth = 0;
        const maxDepth = 2;

        while (element && element !== document.body && depth < maxDepth) {
          const selector = getNonUniqueSelector(element);
          path.unshift(selector);
          element = element.parentElement;
          depth++;
        }

        return path.join(' > ');
      }

      const originalEl = document.elementFromPoint(x, y) as HTMLElement;
      if (!originalEl) return null;

      let element = originalEl;

      const containerTags = ['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'NAV', 'ASIDE',
        'ADDRESS', 'BLOCKQUOTE', 'DETAILS', 'DIALOG', 'FIGURE', 'FIGCAPTION', 'MAIN', 'MARK', 'SUMMARY', 'TIME',
        'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'CAPTION', 'COLGROUP', 'COL', 'FORM', 'FIELDSET',
        'LEGEND', 'LABEL', 'INPUT', 'BUTTON', 'SELECT', 'DATALIST', 'OPTGROUP', 'OPTION', 'TEXTAREA', 'OUTPUT',
        'PROGRESS', 'METER', 'DETAILS', 'SUMMARY', 'MENU', 'MENUITEM', 'MENUITEM', 'APPLET', 'EMBED', 'OBJECT',
        'PARAM', 'VIDEO', 'AUDIO', 'SOURCE', 'TRACK', 'CANVAS', 'MAP', 'AREA', 'SVG', 'IFRAME', 'FRAME', 'FRAMESET',
        'LI', 'UL', 'OL', 'DL', 'DT', 'DD', 'HR', 'P', 'PRE', 'LISTING', 'PLAINTEXT', 'A'
      ];

      while (element.parentElement) {
        const parentRect = element.parentElement.getBoundingClientRect();
        const childRect = element.getBoundingClientRect();

        if (!containerTags.includes(element.parentElement.tagName)) {
          break;
        }

        const fullyContained =
          parentRect.left <= childRect.left &&
          parentRect.right >= childRect.right &&
          parentRect.top <= childRect.top &&
          parentRect.bottom >= childRect.bottom;

        const significantOverlap =
          (childRect.width * childRect.height) /
          (parentRect.width * parentRect.height) > 0.5;

        if (fullyContained && significantOverlap) {
          element = element.parentElement;
        } else {
          break;
        }
      }

      const generalSelector = getSelectorPath(element);
      return {
        generalSelector,
      };
    }, coordinates);

    return selectors || { generalSelector: '' };
  } catch (error) {
    console.error('Error in getNonUniqueSelectors:', error);
    return { generalSelector: '' };
  }
};

export const getChildSelectors = async (page: Page, parentSelector: string): Promise<string[]> => {
  try {
    const childSelectors = await page.evaluate((parentSelector: string) => {
      // Function to get a non-unique selector based on tag and class (if present)
      function getNonUniqueSelector(element: HTMLElement): string {
        let selector = element.tagName.toLowerCase();

        const className = typeof element.className === 'string' ? element.className : '';
        if (className) {
          const classes = className.split(/\s+/).filter((cls: string) => Boolean(cls));
          if (classes.length > 0) {
            const validClasses = classes.filter((cls: string) => !cls.startsWith('!') && !cls.includes(':'));
            if (validClasses.length > 0) {
              selector += '.' + validClasses.map(cls => CSS.escape(cls)).join('.');
            }
          }
        }

        return selector;
      }

      // Function to generate selector path from an element to its parent
      function getSelectorPath(element: HTMLElement | null): string {
        if (!element || !element.parentElement) return '';

        const parentSelector = getNonUniqueSelector(element.parentElement);
        const elementSelector = getNonUniqueSelector(element);

        return `${parentSelector} > ${elementSelector}`;
      }

      // Function to recursively get all descendant selectors
      function getAllDescendantSelectors(element: HTMLElement): string[] {
        let selectors: string[] = [];
        const children = Array.from(element.children) as HTMLElement[];

        for (const child of children) {
          const childPath = getSelectorPath(child);
          if (childPath) {
            selectors.push(childPath);  // Add direct child path
            selectors = selectors.concat(getAllDescendantSelectors(child));  // Recursively process descendants
          }
        }

        return selectors;
      }

      // Find all occurrences of the parent selector in the DOM
      const parentElements = Array.from(document.querySelectorAll(parentSelector)) as HTMLElement[];
      const allChildSelectors = new Set<string>();  // Use a set to ensure uniqueness

      // Process each parent element and its descendants
      parentElements.forEach((parentElement) => {
        const descendantSelectors = getAllDescendantSelectors(parentElement);
        descendantSelectors.forEach((selector) => allChildSelectors.add(selector));  // Add selectors to the set
      });

      return Array.from(allChildSelectors);  // Convert the set back to an array
    }, parentSelector);

    return childSelectors || [];
  } catch (error) {
    console.error('Error in getChildSelectors:', error);
    return [];
  }
};


/**
 * Returns the first pair from the given workflow that contains the given selector
 * inside the where condition, and it is the only selector there.
 * If a match is not found, returns undefined.
 * @param selector The selector to find.
 * @param workflow The workflow to search in.
 * @category WorkflowManagement
 * @returns {Promise<WhereWhatPair|undefined>}
 */
export const selectorAlreadyInWorkflow = (selector: string, workflow: Workflow) => {
  return workflow.find((pair: WhereWhatPair) => {
    if (pair.where.selectors?.includes(selector)) {
      if (pair.where.selectors?.length === 1) {
        return pair;
      }
    }
  });
};

/**
 * Checks whether the given selectors are visible on the page at the same time.
 * @param selectors The selectors to check.
 * @param page The page to use for the validation.
 * @category WorkflowManagement
 */
export const isRuleOvershadowing = async (selectors: string[], page: Page): Promise<boolean> => {
  for (const selector of selectors) {
    const areElsVisible = await page.$$eval(selector,
      (elems) => {
        const isVisible = (elem: HTMLElement | SVGElement) => {
          if (elem instanceof HTMLElement) {
            return !!(elem.offsetWidth
              || elem.offsetHeight
              || elem.getClientRects().length
              && window.getComputedStyle(elem).visibility !== "hidden");
          } else {
            return !!(elem.getClientRects().length
              && window.getComputedStyle(elem).visibility !== "hidden");
          }
        };

        const visibility: boolean[] = [];
        elems.forEach((el) => visibility.push(isVisible(el)))
        return visibility;
      })
    if (areElsVisible.length === 0) {
      return false
    }

    if (areElsVisible.includes(false)) {
      return false;
    }
  }
  return true;
}