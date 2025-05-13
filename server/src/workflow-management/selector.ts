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
  getList: boolean
) => {
  try {
    if (!getList || listSelector !== '') {
      const elementInfo = await page.evaluate(
        async ({ x, y }) => {
          const getDeepestElementFromPoint = (x: number, y: number): HTMLElement | null => {
            let elements = document.elementsFromPoint(x, y) as HTMLElement[];
            if (!elements.length) return null;

            const findDeepestElement = (elements: HTMLElement[]): HTMLElement | null => {
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
                const shadowElement = shadowRoot.elementFromPoint(x, y) as HTMLElement;
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
                if (node.tagName === 'FRAMESET' || node.tagName === 'FRAME') {
                  return true;
                }
                node = node.parentElement;
              }
              return false;
            };
          
            if (deepestElement.tagName === 'IFRAME') {
              let currentIframe = deepestElement as HTMLIFrameElement;
              let depth = 0;
              const MAX_IFRAME_DEPTH = 4;
          
              while (currentIframe && depth < MAX_IFRAME_DEPTH) {
                try {
                  const iframeRect = currentIframe.getBoundingClientRect();
                  const iframeX = x - iframeRect.left;
                  const iframeY = y - iframeRect.top;
          
                  const iframeDocument = currentIframe.contentDocument || currentIframe.contentWindow?.document;
                  if (!iframeDocument) break;
          
                  const iframeElement = iframeDocument.elementFromPoint(iframeX, iframeY) as HTMLElement;
                  if (!iframeElement) break;
          
                  deepestElement = traverseShadowDOM(iframeElement);
          
                  if (iframeElement.tagName === 'IFRAME') {
                    currentIframe = iframeElement as HTMLIFrameElement;
                    depth++;
                  } else {
                    break;
                  }
                } catch (error) {
                  console.warn('Cannot access iframe content:', error);
                  break;
                }
              }
            } 
            else if (deepestElement.tagName === 'FRAME' || isInFrameset()) {
              const framesToCheck = [];
              
              if (deepestElement.tagName === 'FRAME') {
                framesToCheck.push(deepestElement as HTMLFrameElement);
              }
              
              if (isInFrameset()) {
                document.querySelectorAll('frame').forEach(frame => {
                  framesToCheck.push(frame as HTMLFrameElement);
                });
              }
          
              let frameDepth = 0;
              const MAX_FRAME_DEPTH = 4;
              
              const processFrames = (frames: HTMLFrameElement[], currentDepth: number) => {
                if (currentDepth >= MAX_FRAME_DEPTH) return;
                
                for (const frameElement of frames) {
                  try {
                    const frameRect = frameElement.getBoundingClientRect();
                    const frameX = x - frameRect.left;
                    const frameY = y - frameRect.top;
          
                    if (frameX < 0 || frameY < 0 || frameX > frameRect.width || frameY > frameRect.height) {
                      continue;
                    }
          
                    const frameDocument = 
                      frameElement.contentDocument || 
                      frameElement.contentWindow?.document;
                      
                    if (!frameDocument) continue;
          
                    const frameElementAtPoint = frameDocument.elementFromPoint(frameX, frameY) as HTMLElement;
                    if (!frameElementAtPoint) continue;
          
                    deepestElement = traverseShadowDOM(frameElementAtPoint);
                    
                    if (frameElementAtPoint.tagName === 'FRAME') {
                      processFrames([frameElementAtPoint as HTMLFrameElement], currentDepth + 1);
                    }
                    
                    break; 
                  } catch (error) {
                    console.warn('Cannot access frame content:', error);
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

          const el = getDeepestElementFromPoint(x, y);
          
          if (el) {
            // Prioritize Link (DO NOT REMOVE)
            const { parentElement } = el;
            const targetElement = parentElement?.tagName === 'A' ? parentElement : el;

            const ownerDocument = targetElement.ownerDocument;
            const frameElement = ownerDocument?.defaultView?.frameElement as HTMLIFrameElement;
            const isIframeContent = Boolean(frameElement);
            const isFrameContent = frameElement?.tagName === 'FRAME';
            
            const containingShadowRoot = targetElement.getRootNode() as ShadowRoot;
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
                tagName: targetElement?.tagName ?? '',
                isIframeContent,
                isFrameContent,
                isShadowRoot
            };

            if (isIframeContent || isFrameContent) {
              if (isIframeContent) {
                info.iframeURL = (frameElement as HTMLIFrameElement).src;
              } else {
                info.frameURL = (frameElement).src;
              }
              
              let currentFrame = frameElement;
              const frameHierarchy: string[] = [];
              let frameIndex = 0;
              
              while (currentFrame) {
                frameHierarchy.unshift(
                    currentFrame.id || 
                    currentFrame.getAttribute('name') ||
                    currentFrame.src || 
                    `${currentFrame.tagName.toLowerCase()}[${frameIndex}]`
                );
                
                const parentDoc = currentFrame.ownerDocument;
                currentFrame = parentDoc?.defaultView?.frameElement as HTMLIFrameElement;
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

              if (targetElement.tagName === 'A') {
                info.url = (targetElement as HTMLAnchorElement).href;
                info.innerText = targetElement.textContent ?? '';
              } else if (targetElement.tagName === 'IMG') {
                info.imageUrl = (targetElement as HTMLImageElement).src;
              } else if (targetElement?.tagName === 'SELECT') {
                const selectElement = targetElement as HTMLSelectElement;
                info.innerText = selectElement.options[selectElement.selectedIndex]?.text ?? '';
                info.attributes = {
                  ...info.attributes,
                  selectedValue: selectElement.value,
                };
              } else if (targetElement?.tagName === 'INPUT' && (targetElement as HTMLInputElement).type === 'time' || (targetElement as HTMLInputElement).type === 'date') {
                info.innerText = (targetElement as HTMLInputElement).value;
              }
              else {
                info.hasOnlyText = targetElement.children.length === 0 && 
                  (targetElement.textContent !== null && 
                   targetElement.textContent.trim().length > 0);
                info.innerText = targetElement.textContent ?? '';
              }

              info.innerHTML = targetElement.innerHTML;
              info.outerHTML = targetElement.outerHTML;
            }

            return info;
          }
          return null;
        },
        { x: coordinates.x, y: coordinates.y }
      );
      return elementInfo;
    } else {
      const elementInfo = await page.evaluate(
        async ({ x, y }) => {
          const getDeepestElementFromPoint = (x: number, y: number): HTMLElement | null => {
            let elements = document.elementsFromPoint(x, y) as HTMLElement[];
            if (!elements.length) return null;

            const findContainerElement = (elements: HTMLElement[]): HTMLElement | null => {
              if (!elements.length) return null;
              if (elements.length === 1) return elements[0];
              
              for (let i = 0; i < elements.length; i++) {
                const element = elements[i];
                const rect = element.getBoundingClientRect();
                
                if (rect.width >= 30 && rect.height >= 30) {
                  const hasChildrenInList = elements.some((otherElement, j) => 
                    i !== j && element.contains(otherElement)
                  );
                  
                  if (hasChildrenInList) {
                    return element;
                  }
                }
              }
              
              return elements[0];
            };

            let deepestElement = findContainerElement(elements);
            if (!deepestElement) return null;
          
            const traverseShadowDOM = (element: HTMLElement): HTMLElement => {
              let current = element;
              let shadowRoot = current.shadowRoot;
              let deepest = current;
              let depth = 0;
              const MAX_SHADOW_DEPTH = 4;
          
              while (shadowRoot && depth < MAX_SHADOW_DEPTH) {
                const shadowElement = shadowRoot.elementFromPoint(x, y) as HTMLElement;
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
                if (node.tagName === 'FRAMESET' || node.tagName === 'FRAME') {
                  return true;
                }
                node = node.parentElement;
              }
              return false;
            };
          
            if (deepestElement.tagName === 'IFRAME') {
              let currentIframe = deepestElement as HTMLIFrameElement;
              let depth = 0;
              const MAX_IFRAME_DEPTH = 4;
          
              while (currentIframe && depth < MAX_IFRAME_DEPTH) {
                try {
                  const iframeRect = currentIframe.getBoundingClientRect();
                  const iframeX = x - iframeRect.left;
                  const iframeY = y - iframeRect.top;
          
                  const iframeDocument = currentIframe.contentDocument || currentIframe.contentWindow?.document;
                  if (!iframeDocument) break;
          
                  const iframeElement = iframeDocument.elementFromPoint(iframeX, iframeY) as HTMLElement;
                  if (!iframeElement) break;
          
                  deepestElement = traverseShadowDOM(iframeElement);
          
                  if (iframeElement.tagName === 'IFRAME') {
                    currentIframe = iframeElement as HTMLIFrameElement;
                    depth++;
                  } else {
                    break;
                  }
                } catch (error) {
                  console.warn('Cannot access iframe content:', error);
                  break;
                }
              }
            } 
            else if (deepestElement.tagName === 'FRAME' || isInFrameset()) {
              const framesToCheck = [];
              
              if (deepestElement.tagName === 'FRAME') {
                framesToCheck.push(deepestElement as HTMLFrameElement);
              }
              
              if (isInFrameset()) {
                document.querySelectorAll('frame').forEach(frame => {
                  framesToCheck.push(frame as HTMLFrameElement);
                });
              }
          
              let frameDepth = 0;
              const MAX_FRAME_DEPTH = 4;
              
              const processFrames = (frames: HTMLFrameElement[], currentDepth: number) => {
                if (currentDepth >= MAX_FRAME_DEPTH) return;
                
                for (const frameElement of frames) {
                  try {
                    const frameRect = frameElement.getBoundingClientRect();
                    const frameX = x - frameRect.left;
                    const frameY = y - frameRect.top;
          
                    if (frameX < 0 || frameY < 0 || frameX > frameRect.width || frameY > frameRect.height) {
                      continue;
                    }
          
                    const frameDocument = 
                      frameElement.contentDocument || 
                      frameElement.contentWindow?.document;
                      
                    if (!frameDocument) continue;
          
                    const frameElementAtPoint = frameDocument.elementFromPoint(frameX, frameY) as HTMLElement;
                    if (!frameElementAtPoint) continue;
          
                    deepestElement = traverseShadowDOM(frameElementAtPoint);
                    
                    if (frameElementAtPoint.tagName === 'FRAME') {
                      processFrames([frameElementAtPoint as HTMLFrameElement], currentDepth + 1);
                    }
                    
                    break; 
                  } catch (error) {
                    console.warn('Cannot access frame content:', error);
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

          const originalEl = getDeepestElementFromPoint(x, y);
          if (originalEl) {
            let element = originalEl;

            if (element.tagName === 'TD' || element.tagName === 'TH') {
              const tableParent = element.closest('table');
              if (tableParent) {
                element = tableParent;
              }
            }
    
            const ownerDocument = element.ownerDocument;
            const frameElement = ownerDocument?.defaultView?.frameElement;
            const isIframeContent = Boolean(frameElement);
            const isFrameContent = frameElement?.tagName === 'FRAME';

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
              tagName: element?.tagName ?? '',
              isIframeContent,
              isFrameContent,
              isShadowRoot
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
                    currentFrame.getAttribute('name') ||
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
    
              if (element.tagName === 'A') {
                info.url = (element as HTMLAnchorElement).href;
                info.innerText = element.textContent ?? '';
              } else if (element.tagName === 'IMG') {
                info.imageUrl = (element as HTMLImageElement).src;
              } else if (element?.tagName === 'SELECT') {
                const selectElement = element as HTMLSelectElement;
                info.innerText = selectElement.options[selectElement.selectedIndex]?.text ?? '';
                info.attributes = {
                  ...info.attributes,
                  selectedValue: selectElement.value,
                };
              } else if (element?.tagName === 'INPUT' && ((element as HTMLInputElement).type === 'time' || (element as HTMLInputElement).type === 'date')) {
                info.innerText = (element as HTMLInputElement).value;
              } else {
                info.hasOnlyText = element.children.length === 0 && 
                  (element.textContent !== null && 
                   element.textContent.trim().length > 0);
                info.innerText = element.textContent ?? '';
              }
    
              info.innerHTML = element.innerHTML;
              info.outerHTML = element.outerHTML;
            }
    
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

export const getRect = async (page: Page, coordinates: Coordinates, listSelector: string, getList: boolean) => {
  try {
    if (!getList || listSelector !== '') {
      const rect = await page.evaluate(
        async ({ x, y }) => {
          const getDeepestElementFromPoint = (x: number, y: number): HTMLElement | null => {
            let elements = document.elementsFromPoint(x, y) as HTMLElement[];
            if (!elements.length) return null;

            const findDeepestElement = (elements: HTMLElement[]): HTMLElement | null => {
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
                const shadowElement = shadowRoot.elementFromPoint(x, y) as HTMLElement;
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
                if (node.tagName === 'FRAMESET' || node.tagName === 'FRAME') {
                  return true;
                }
                node = node.parentElement;
              }
              return false;
            };
          
            if (deepestElement.tagName === 'IFRAME') {
              let currentIframe = deepestElement as HTMLIFrameElement;
              let depth = 0;
              const MAX_IFRAME_DEPTH = 4;
          
              while (currentIframe && depth < MAX_IFRAME_DEPTH) {
                try {
                  const iframeRect = currentIframe.getBoundingClientRect();
                  const iframeX = x - iframeRect.left;
                  const iframeY = y - iframeRect.top;
          
                  const iframeDocument = currentIframe.contentDocument || currentIframe.contentWindow?.document;
                  if (!iframeDocument) break;
          
                  const iframeElement = iframeDocument.elementFromPoint(iframeX, iframeY) as HTMLElement;
                  if (!iframeElement) break;
          
                  deepestElement = traverseShadowDOM(iframeElement);
          
                  if (iframeElement.tagName === 'IFRAME') {
                    currentIframe = iframeElement as HTMLIFrameElement;
                    depth++;
                  } else {
                    break;
                  }
                } catch (error) {
                  console.warn('Cannot access iframe content:', error);
                  break;
                }
              }
            } 
            else if (deepestElement.tagName === 'FRAME' || isInFrameset()) {
              const framesToCheck = [];
              
              if (deepestElement.tagName === 'FRAME') {
                framesToCheck.push(deepestElement as HTMLFrameElement);
              }
              
              if (isInFrameset()) {
                document.querySelectorAll('frame').forEach(frame => {
                  framesToCheck.push(frame as HTMLFrameElement);
                });
              }
          
              let frameDepth = 0;
              const MAX_FRAME_DEPTH = 4;
              
              const processFrames = (frames: HTMLFrameElement[], currentDepth: number) => {
                if (currentDepth >= MAX_FRAME_DEPTH) return;
                
                for (const frameElement of frames) {
                  try {
                    const frameRect = frameElement.getBoundingClientRect();
                    const frameX = x - frameRect.left;
                    const frameY = y - frameRect.top;
          
                    if (frameX < 0 || frameY < 0 || frameX > frameRect.width || frameY > frameRect.height) {
                      continue;
                    }
          
                    const frameDocument = 
                      frameElement.contentDocument || 
                      frameElement.contentWindow?.document;
                      
                    if (!frameDocument) continue;
          
                    const frameElementAtPoint = frameDocument.elementFromPoint(frameX, frameY) as HTMLElement;
                    if (!frameElementAtPoint) continue;
          
                    deepestElement = traverseShadowDOM(frameElementAtPoint);
                    
                    if (frameElementAtPoint.tagName === 'FRAME') {
                      processFrames([frameElementAtPoint as HTMLFrameElement], currentDepth + 1);
                    }
                    
                    break; 
                  } catch (error) {
                    console.warn('Cannot access frame content:', error);
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

          const el = getDeepestElementFromPoint(x, y);
          if (el) {
            // Prioritize Link (DO NOT REMOVE)
            const { parentElement } = el;
            const element = parentElement?.tagName === 'A' ? parentElement : el;

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
                    left: this.left
                  };
                }
              });

              // For elements inside iframes, adjust coordinates relative to the top window
              let adjustedRect = createRectObject(rectangle);
              let currentWindow = element.ownerDocument.defaultView;
              
              while (currentWindow !== window.top) {
                const frameElement = currentWindow?.frameElement as HTMLIFrameElement;
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
          return null;
        },
        { x: coordinates.x, y: coordinates.y }
      );
      return rect;
    } else {
      const rect = await page.evaluate(
        async ({ x, y }) => {
          const getDeepestElementFromPoint = (x: number, y: number): HTMLElement | null => {
            let elements = document.elementsFromPoint(x, y) as HTMLElement[];
            if (!elements.length) return null;

            const findContainerElement = (elements: HTMLElement[]): HTMLElement | null => {
              if (!elements.length) return null;
              if (elements.length === 1) return elements[0];
              
              for (let i = 0; i < elements.length; i++) {
                const element = elements[i];
                const rect = element.getBoundingClientRect();
                
                if (rect.width >= 30 && rect.height >= 30) {
                  const hasChildrenInList = elements.some((otherElement, j) => 
                    i !== j && element.contains(otherElement)
                  );
                  
                  if (hasChildrenInList) {
                    return element;
                  }
                }
              }
              
              return elements[0];
            };

            let deepestElement = findContainerElement(elements);
            if (!deepestElement) return null;
          
            const traverseShadowDOM = (element: HTMLElement): HTMLElement => {
              let current = element;
              let shadowRoot = current.shadowRoot;
              let deepest = current;
              let depth = 0;
              const MAX_SHADOW_DEPTH = 4;
          
              while (shadowRoot && depth < MAX_SHADOW_DEPTH) {
                const shadowElement = shadowRoot.elementFromPoint(x, y) as HTMLElement;
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
                if (node.tagName === 'FRAMESET' || node.tagName === 'FRAME') {
                  return true;
                }
                node = node.parentElement;
              }
              return false;
            };
          
            if (deepestElement.tagName === 'IFRAME') {
              let currentIframe = deepestElement as HTMLIFrameElement;
              let depth = 0;
              const MAX_IFRAME_DEPTH = 4;
          
              while (currentIframe && depth < MAX_IFRAME_DEPTH) {
                try {
                  const iframeRect = currentIframe.getBoundingClientRect();
                  const iframeX = x - iframeRect.left;
                  const iframeY = y - iframeRect.top;
          
                  const iframeDocument = currentIframe.contentDocument || currentIframe.contentWindow?.document;
                  if (!iframeDocument) break;
          
                  const iframeElement = iframeDocument.elementFromPoint(iframeX, iframeY) as HTMLElement;
                  if (!iframeElement) break;
          
                  deepestElement = traverseShadowDOM(iframeElement);
          
                  if (iframeElement.tagName === 'IFRAME') {
                    currentIframe = iframeElement as HTMLIFrameElement;
                    depth++;
                  } else {
                    break;
                  }
                } catch (error) {
                  console.warn('Cannot access iframe content:', error);
                  break;
                }
              }
            } 
            else if (deepestElement.tagName === 'FRAME' || isInFrameset()) {
              const framesToCheck = [];
              
              if (deepestElement.tagName === 'FRAME') {
                framesToCheck.push(deepestElement as HTMLFrameElement);
              }
              
              if (isInFrameset()) {
                document.querySelectorAll('frame').forEach(frame => {
                  framesToCheck.push(frame as HTMLFrameElement);
                });
              }
          
              let frameDepth = 0;
              const MAX_FRAME_DEPTH = 4;
              
              const processFrames = (frames: HTMLFrameElement[], currentDepth: number) => {
                if (currentDepth >= MAX_FRAME_DEPTH) return;
                
                for (const frameElement of frames) {
                  try {
                    const frameRect = frameElement.getBoundingClientRect();
                    const frameX = x - frameRect.left;
                    const frameY = y - frameRect.top;
          
                    if (frameX < 0 || frameY < 0 || frameX > frameRect.width || frameY > frameRect.height) {
                      continue;
                    }
          
                    const frameDocument = 
                      frameElement.contentDocument || 
                      frameElement.contentWindow?.document;
                      
                    if (!frameDocument) continue;
          
                    const frameElementAtPoint = frameDocument.elementFromPoint(frameX, frameY) as HTMLElement;
                    if (!frameElementAtPoint) continue;
          
                    deepestElement = traverseShadowDOM(frameElementAtPoint);
                    
                    if (frameElementAtPoint.tagName === 'FRAME') {
                      processFrames([frameElementAtPoint as HTMLFrameElement], currentDepth + 1);
                    }
                    
                    break; 
                  } catch (error) {
                    console.warn('Cannot access frame content:', error);
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

          const originalEl = getDeepestElementFromPoint(x, y);
          if (originalEl) {
            let element = originalEl;

            if (element.tagName === 'TD' || element.tagName === 'TH') {
              const tableParent = element.closest('table');
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
                    left: this.left
                  };
                }
              });

              // For elements inside iframes or frames, adjust coordinates relative to the top window
              let adjustedRect = createRectObject(rectangle);
              let currentWindow = element.ownerDocument.defaultView;
              
              while (currentWindow !== window.top) {
                const frameElement = currentWindow?.frameElement;
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
          return null;
        },
        { x: coordinates.x, y: coordinates.y }
      );
      return rect;
    }
  } catch (error) {
    const { message, stack } = error as Error;
    console.error('Error while retrieving selector:', message);
    console.error('Stack:', stack);
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
      
      const getDeepestElementFromPoint = (x: number, y: number): HTMLElement | null => {
        let elements = document.elementsFromPoint(x, y) as HTMLElement[];
        if (!elements.length) return null;

        const findDeepestElement = (elements: HTMLElement[]): HTMLElement | null => {
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
            const shadowElement = shadowRoot.elementFromPoint(x, y) as HTMLElement;
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
            if (node.tagName === 'FRAMESET' || node.tagName === 'FRAME') {
              return true;
            }
            node = node.parentElement;
          }
          return false;
        };
      
        if (deepestElement.tagName === 'IFRAME') {
          let currentIframe = deepestElement as HTMLIFrameElement;
          let depth = 0;
          const MAX_IFRAME_DEPTH = 4;
      
          while (currentIframe && depth < MAX_IFRAME_DEPTH) {
            try {
              const iframeRect = currentIframe.getBoundingClientRect();
              const iframeX = x - iframeRect.left;
              const iframeY = y - iframeRect.top;
      
              const iframeDocument = currentIframe.contentDocument || currentIframe.contentWindow?.document;
              if (!iframeDocument) break;
      
              const iframeElement = iframeDocument.elementFromPoint(iframeX, iframeY) as HTMLElement;
              if (!iframeElement) break;
      
              deepestElement = traverseShadowDOM(iframeElement);
      
              if (iframeElement.tagName === 'IFRAME') {
                currentIframe = iframeElement as HTMLIFrameElement;
                depth++;
              } else {
                break;
              }
            } catch (error) {
              console.warn('Cannot access iframe content:', error);
              break;
            }
          }
        } 
        else if (deepestElement.tagName === 'FRAME' || isInFrameset()) {
          const framesToCheck = [];
          
          if (deepestElement.tagName === 'FRAME') {
            framesToCheck.push(deepestElement as HTMLFrameElement);
          }
          
          if (isInFrameset()) {
            document.querySelectorAll('frame').forEach(frame => {
              framesToCheck.push(frame as HTMLFrameElement);
            });
          }
      
          let frameDepth = 0;
          const MAX_FRAME_DEPTH = 4;
          
          const processFrames = (frames: HTMLFrameElement[], currentDepth: number) => {
            if (currentDepth >= MAX_FRAME_DEPTH) return;
            
            for (const frameElement of frames) {
              try {
                const frameRect = frameElement.getBoundingClientRect();
                const frameX = x - frameRect.left;
                const frameY = y - frameRect.top;
      
                if (frameX < 0 || frameY < 0 || frameX > frameRect.width || frameY > frameRect.height) {
                  continue;
                }
      
                const frameDocument = 
                  frameElement.contentDocument || 
                  frameElement.contentWindow?.document;
                  
                if (!frameDocument) continue;
      
                const frameElementAtPoint = frameDocument.elementFromPoint(frameX, frameY) as HTMLElement;
                if (!frameElementAtPoint) continue;
      
                deepestElement = traverseShadowDOM(frameElementAtPoint);
                
                if (frameElementAtPoint.tagName === 'FRAME') {
                  processFrames([frameElementAtPoint as HTMLFrameElement], currentDepth + 1);
                }
                
                break; 
              } catch (error) {
                console.warn('Cannot access frame content:', error);
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
            
            const frameElement = 
              ownerDocument?.defaultView?.frameElement as HTMLIFrameElement | HTMLFrameElement;
            
            if (frameElement) {
              path.unshift({
                frame: frameElement,
                document: ownerDocument,
                element: current,
                isFrame: frameElement.tagName === 'FRAME'
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
            const frameSelector = context.isFrame ? 
              `frame[name="${context.frame.getAttribute('name')}"]` : 
              finder(context.frame, {
                root: index === 0 ? document.body : 
                      (framePath[index - 1].document.body as Element)
              });
            
            if (index === framePath.length - 1) {
              const elementSelector = finder(element, {
                root: context.document.body as Element
              });
              selectorParts.push(`${frameSelector} :>> ${elementSelector}`);
            } else {
              selectorParts.push(frameSelector);
            }
          });
          
          return {
            fullSelector: selectorParts.join(' :>> '),
            isFrameContent: true
          };
        } catch (e) {
          console.warn('Error generating frame selector:', e);
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
                element: current
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
              root: index === 0 ? document.body : (shadowPath[index - 1].root as unknown as Element)
            });

            // For the last context, get selector for target element
            if (index === shadowPath.length - 1) {
              const elementSelector = finder(element, {
                root: context.root as unknown as Element
              });
              selectorParts.push(`${hostSelector} >> ${elementSelector}`);
            } else {
              selectorParts.push(hostSelector);
            }
          });

          return {
            fullSelector: selectorParts.join(' >> '),
            mode: shadowPath[shadowPath.length - 1].root.mode
          };
        } catch (e) {
          console.warn('Error generating shadow DOM selector:', e);
          return null;
        }
      };

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


        let iframeSelector = null;
        try {
          // Check if element is within frame/iframe
          const isInFrame = element.ownerDocument !== document;
          const isInFrameset = () => {
            let doc = element.ownerDocument;
            return doc.querySelectorAll('frameset').length > 0;
          };
          
          if (isInFrame || isInFrameset()) {
            iframeSelector = genSelectorForFrame(element);
          }
        } catch (e) {
          console.warn('Error detecting frames:', e);
        }

        const shadowSelector = genSelectorForShadowDOM(element);

        const relSelector = genSelectorForAttributes(element, ['rel']);
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
          relSelector,
          iframeSelector: iframeSelector ? {
            full: iframeSelector.fullSelector,
            isIframe: iframeSelector.isFrameContent,
          } : null,
          shadowSelector: shadowSelector ? {
            full: shadowSelector.fullSelector,
            mode: shadowSelector.mode
          } : null
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
          if (attributes.includes('rel') && element.hasAttribute('rel')) {
            const relValue = element.getAttribute('rel');
            return `[rel="${relValue}"]`;
          }

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

      const hoveredElement = getDeepestElementFromPoint(x, y) as HTMLElement;

      if (
        hoveredElement != null &&
        !hoveredElement.closest('#overlay-controls') != null
      ) {
        // Prioritize Link (DO NOT REMOVE)
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

export const getNonUniqueSelectors = async (page: Page, coordinates: Coordinates, listSelector: string): Promise<SelectorResult> => {
  interface DOMContext {
    type: 'iframe' | 'frame' | 'shadow';
    element: HTMLElement;
    container: HTMLIFrameElement | HTMLFrameElement | ShadowRoot;
    host?: HTMLElement;
    document?: Document;
  }

  try {
    if (!listSelector) {
      const selectors = await page.evaluate(({ x, y }: { x: number, y: number }) => {
        const getDeepestElementFromPoint = (x: number, y: number): HTMLElement | null => {
          let elements = document.elementsFromPoint(x, y) as HTMLElement[];
          if (!elements.length) return null;

          const findContainerElement = (elements: HTMLElement[]): HTMLElement | null => {
            if (!elements.length) return null;
            if (elements.length === 1) return elements[0];
            
            for (let i = 0; i < elements.length; i++) {
              const element = elements[i];
              const rect = element.getBoundingClientRect();
              
              if (rect.width >= 30 && rect.height >= 30) {
                const hasChildrenInList = elements.some((otherElement, j) => 
                  i !== j && element.contains(otherElement)
                );
                
                if (hasChildrenInList) {
                  return element;
                }
              }
            }
            
            return elements[0];
          };

          let deepestElement = findContainerElement(elements);
          if (!deepestElement) return null;
        
          const traverseShadowDOM = (element: HTMLElement): HTMLElement => {
            let current = element;
            let shadowRoot = current.shadowRoot;
            let deepest = current;
            let depth = 0;
            const MAX_SHADOW_DEPTH = 4;
        
            while (shadowRoot && depth < MAX_SHADOW_DEPTH) {
              const shadowElement = shadowRoot.elementFromPoint(x, y) as HTMLElement;
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
              if (node.tagName === 'FRAMESET' || node.tagName === 'FRAME') {
                return true;
              }
              node = node.parentElement;
            }
            return false;
          };
        
          if (deepestElement.tagName === 'IFRAME') {
            let currentIframe = deepestElement as HTMLIFrameElement;
            let depth = 0;
            const MAX_IFRAME_DEPTH = 4;
        
            while (currentIframe && depth < MAX_IFRAME_DEPTH) {
              try {
                const iframeRect = currentIframe.getBoundingClientRect();
                const iframeX = x - iframeRect.left;
                const iframeY = y - iframeRect.top;
        
                const iframeDocument = currentIframe.contentDocument || currentIframe.contentWindow?.document;
                if (!iframeDocument) break;
        
                const iframeElement = iframeDocument.elementFromPoint(iframeX, iframeY) as HTMLElement;
                if (!iframeElement) break;
        
                deepestElement = traverseShadowDOM(iframeElement);
        
                if (iframeElement.tagName === 'IFRAME') {
                  currentIframe = iframeElement as HTMLIFrameElement;
                  depth++;
                } else {
                  break;
                }
              } catch (error) {
                console.warn('Cannot access iframe content:', error);
                break;
              }
            }
          } 
          else if (deepestElement.tagName === 'FRAME' || isInFrameset()) {
            const framesToCheck = [];
            
            if (deepestElement.tagName === 'FRAME') {
              framesToCheck.push(deepestElement as HTMLFrameElement);
            }
            
            if (isInFrameset()) {
              document.querySelectorAll('frame').forEach(frame => {
                framesToCheck.push(frame as HTMLFrameElement);
              });
            }
        
            let frameDepth = 0;
            const MAX_FRAME_DEPTH = 4;
            
            const processFrames = (frames: HTMLFrameElement[], currentDepth: number) => {
              if (currentDepth >= MAX_FRAME_DEPTH) return;
              
              for (const frameElement of frames) {
                try {
                  const frameRect = frameElement.getBoundingClientRect();
                  const frameX = x - frameRect.left;
                  const frameY = y - frameRect.top;
        
                  if (frameX < 0 || frameY < 0 || frameX > frameRect.width || frameY > frameRect.height) {
                    continue;
                  }
        
                  const frameDocument = 
                    frameElement.contentDocument || 
                    frameElement.contentWindow?.document;
                    
                  if (!frameDocument) continue;
        
                  const frameElementAtPoint = frameDocument.elementFromPoint(frameX, frameY) as HTMLElement;
                  if (!frameElementAtPoint) continue;
        
                  deepestElement = traverseShadowDOM(frameElementAtPoint);
                  
                  if (frameElementAtPoint.tagName === 'FRAME') {
                    processFrames([frameElementAtPoint as HTMLFrameElement], currentDepth + 1);
                  }
                  
                  break; 
                } catch (error) {
                  console.warn('Cannot access frame content:', error);
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

        function getNonUniqueSelector(element: HTMLElement): string {
          let selector = element.tagName.toLowerCase();
        
          if (selector === 'frame' || selector === 'iframe') {
            let baseSelector = selector;
            
            if (element.className) {
              const classes = element.className.split(/\s+/).filter(Boolean);
              if (classes.length > 0) {
                const validClasses = classes.filter(cls => !cls.startsWith('!') && !cls.includes(':'));
                if (validClasses.length > 0) {
                  baseSelector += '.' + validClasses.map(cls => CSS.escape(cls)).join('.');
                }
              }
            }
            
            if (element.id) {
              return `${selector}#${CSS.escape(element.id)}`;
            }
            
            if (element.getAttribute('name')) {
              return `${selector}[name="${CSS.escape(element.getAttribute('name')!)}"]`;
            }
            
            if (element.parentElement && element.parentElement.tagName === 'FRAMESET') {
              const frameIndex = Array.from(element.parentElement.children)
                .filter(child => child.tagName.toLowerCase() === selector)
                .indexOf(element) + 1;
              
              if (frameIndex > 0) {
                return `${selector}:nth-of-type(${frameIndex})`;
              }
            }
            
            if (element.parentElement) {
              const siblings = Array.from(element.parentElement.children);
            
              const elementClasses = Array.from(element.classList || []);
              
              const similarSiblings = siblings.filter(sibling => {
                if (sibling === element) return false;
                const siblingClasses = Array.from(sibling.classList || []);
                return siblingClasses.some(cls => elementClasses.includes(cls));
              });
              
              if (similarSiblings.length > 0) {
                const position = siblings.indexOf(element) + 1;
                selector += `:nth-child(${position})`;
              }
            }
            
            return baseSelector;
          }
        
          if (selector === 'td' && element.parentElement) {
            const siblings = Array.from(element.parentElement.children);
            const position = siblings.indexOf(element) + 1;
            return `${selector}:nth-child(${position})`;
          }
        
          if (element.className) {
            const classes = element.className.split(/\s+/).filter((cls: string) => Boolean(cls));
            if (classes.length > 0) {
              const validClasses = classes.filter((cls: string) => !cls.startsWith('!') && !cls.includes(':'));
              if (validClasses.length > 0) {
                selector += '.' + validClasses.map(cls => CSS.escape(cls)).join('.');
              }
            }
          }
        
          if (element.parentElement) {
            const siblings = Array.from(element.parentElement.children);
            
            const elementClasses = Array.from(element.classList || []);
            
            const similarSiblings = siblings.filter(sibling => {
              if (sibling === element) return false;
              const siblingClasses = Array.from(sibling.classList || []);
              return siblingClasses.some(cls => elementClasses.includes(cls));
            });
            
            if (similarSiblings.length > 0) {
              const position = siblings.indexOf(element) + 1;
              selector += `:nth-child(${position})`;
            }
          }
        
          return selector;
        }

        function getContextPath(element: HTMLElement): DOMContext[] {
          const path: DOMContext[] = [];
          let current = element;
          let depth = 0;
          const MAX_DEPTH = 4;
          
          while (current && depth < MAX_DEPTH) {
            // Check for shadow DOM
            const rootNode = current.getRootNode();
            if (rootNode instanceof ShadowRoot) {
              path.unshift({
                type: 'shadow',
                element: current,
                container: rootNode,
                host: rootNode.host as HTMLElement
              });
              current = rootNode.host as HTMLElement;
              depth++;
              continue;
            }

            // Check for iframe or frame
            const ownerDocument = current.ownerDocument;
            const frameElement = ownerDocument?.defaultView?.frameElement;
            
            if (frameElement) {
              const isFrame = frameElement.tagName === 'FRAME';
              path.unshift({
                type: isFrame ? 'frame' : 'iframe',
                element: current,
                container: frameElement as (HTMLIFrameElement | HTMLFrameElement),
                document: ownerDocument
              });
              current = frameElement as HTMLElement;
              depth++;
              continue;
            }

            break;
          }
          
          return path;
        }

        function getSelectorPath(element: HTMLElement | null): string {
          if (!element) return '';
          
          // Get the complete context path
          const contextPath = getContextPath(element);
          if (contextPath.length > 0) {
            const selectorParts: string[] = [];
            
            contextPath.forEach((context, index) => {
              const containerSelector = getNonUniqueSelector(
                context.type === 'shadow' ? context.host! : context.container as HTMLElement
              );
              
              if (index === contextPath.length - 1) {
                const elementSelector = getNonUniqueSelector(element);
                const delimiter = context.type === 'shadow' ? ' >> ' : ' :>> ';
                selectorParts.push(`${containerSelector}${delimiter}${elementSelector}`);
              } else {
                selectorParts.push(containerSelector);
              }
            });
            
            return selectorParts.join(contextPath[0].type === 'shadow' ? ' >> ' : ' :>> ');
          }

          // Regular DOM path generation
          const path: string[] = [];
          let currentElement = element;
          const MAX_DEPTH = 2;
          let depth = 0;

          while (currentElement && currentElement !== document.body && depth < MAX_DEPTH) {
            const selector = getNonUniqueSelector(currentElement);
            path.unshift(selector);
            
            if (!currentElement.parentElement) break;
            currentElement = currentElement.parentElement;
            depth++;
          }

          return path.join(' > ');
        }

        // Main logic to get element and generate selector
        const originalEl = getDeepestElementFromPoint(x, y);
        if (!originalEl) return null;

        let element = originalEl;

        if (element.tagName === 'TD' || element.tagName === 'TH') {
          const tableParent = element.closest('table');
          if (tableParent) {
            element = tableParent;
          }
        }

        const generalSelector = getSelectorPath(element);
        return { generalSelector };
      }, coordinates);

      return selectors || { generalSelector: '' };
    } else {
      // When we have a list selector, we need special handling while maintaining shadow DOM and frame support
      const selectors = await page.evaluate(({ x, y }: { x: number, y: number }) => {
        const getDeepestElementFromPoint = (x: number, y: number): HTMLElement | null => {
          let elements = document.elementsFromPoint(x, y) as HTMLElement[];
          if (!elements.length) return null;

          const findDeepestElement = (elements: HTMLElement[]): HTMLElement | null => {
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
              const shadowElement = shadowRoot.elementFromPoint(x, y) as HTMLElement;
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
              if (node.tagName === 'FRAMESET' || node.tagName === 'FRAME') {
                return true;
              }
              node = node.parentElement;
            }
            return false;
          };
        
          if (deepestElement.tagName === 'IFRAME') {
            let currentIframe = deepestElement as HTMLIFrameElement;
            let depth = 0;
            const MAX_IFRAME_DEPTH = 4;
        
            while (currentIframe && depth < MAX_IFRAME_DEPTH) {
              try {
                const iframeRect = currentIframe.getBoundingClientRect();
                const iframeX = x - iframeRect.left;
                const iframeY = y - iframeRect.top;
        
                const iframeDocument = currentIframe.contentDocument || currentIframe.contentWindow?.document;
                if (!iframeDocument) break;
        
                const iframeElement = iframeDocument.elementFromPoint(iframeX, iframeY) as HTMLElement;
                if (!iframeElement) break;
        
                deepestElement = traverseShadowDOM(iframeElement);
        
                if (iframeElement.tagName === 'IFRAME') {
                  currentIframe = iframeElement as HTMLIFrameElement;
                  depth++;
                } else {
                  break;
                }
              } catch (error) {
                console.warn('Cannot access iframe content:', error);
                break;
              }
            }
          } 
          else if (deepestElement.tagName === 'FRAME' || isInFrameset()) {
            const framesToCheck = [];
            
            if (deepestElement.tagName === 'FRAME') {
              framesToCheck.push(deepestElement as HTMLFrameElement);
            }
            
            if (isInFrameset()) {
              document.querySelectorAll('frame').forEach(frame => {
                framesToCheck.push(frame as HTMLFrameElement);
              });
            }
        
            let frameDepth = 0;
            const MAX_FRAME_DEPTH = 4;
            
            const processFrames = (frames: HTMLFrameElement[], currentDepth: number) => {
              if (currentDepth >= MAX_FRAME_DEPTH) return;
              
              for (const frameElement of frames) {
                try {
                  const frameRect = frameElement.getBoundingClientRect();
                  const frameX = x - frameRect.left;
                  const frameY = y - frameRect.top;
        
                  if (frameX < 0 || frameY < 0 || frameX > frameRect.width || frameY > frameRect.height) {
                    continue;
                  }
        
                  const frameDocument = 
                    frameElement.contentDocument || 
                    frameElement.contentWindow?.document;
                    
                  if (!frameDocument) continue;
        
                  const frameElementAtPoint = frameDocument.elementFromPoint(frameX, frameY) as HTMLElement;
                  if (!frameElementAtPoint) continue;
        
                  deepestElement = traverseShadowDOM(frameElementAtPoint);
                  
                  if (frameElementAtPoint.tagName === 'FRAME') {
                    processFrames([frameElementAtPoint as HTMLFrameElement], currentDepth + 1);
                  }
                  
                  break; 
                } catch (error) {
                  console.warn('Cannot access frame content:', error);
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

        function getNonUniqueSelector(element: HTMLElement): string {
          let selector = element.tagName.toLowerCase();
        
          if (selector === 'frame' || selector === 'iframe') {
            let baseSelector = selector;
            
            if (element.className) {
              const classes = element.className.split(/\s+/).filter(Boolean);
              if (classes.length > 0) {
                const validClasses = classes.filter(cls => !cls.startsWith('!') && !cls.includes(':'));
                if (validClasses.length > 0) {
                  baseSelector += '.' + validClasses.map(cls => CSS.escape(cls)).join('.');
                }
              }
            }
            
            if (element.id) {
              return `${selector}#${CSS.escape(element.id)}`;
            }
            
            if (element.getAttribute('name')) {
              return `${selector}[name="${CSS.escape(element.getAttribute('name')!)}"]`;
            }
            
            if (element.parentElement && element.parentElement.tagName === 'FRAMESET') {
              const frameIndex = Array.from(element.parentElement.children)
                .filter(child => child.tagName.toLowerCase() === selector)
                .indexOf(element) + 1;
              
              if (frameIndex > 0) {
                return `${selector}:nth-of-type(${frameIndex})`;
              }
            }
            
            if (element.parentElement) {
              const siblings = Array.from(element.parentElement.children);
              
              const elementClasses = Array.from(element.classList || []);
              
              const similarSiblings = siblings.filter(sibling => {
                if (sibling === element) return false;
                const siblingClasses = Array.from(sibling.classList || []);
                return siblingClasses.some(cls => elementClasses.includes(cls));
              });
              
              if (similarSiblings.length > 0) {
                const position = siblings.indexOf(element) + 1;
                selector += `:nth-child(${position})`;
              }
            }
            
            return baseSelector;
          }
        
          if (selector === 'td' && element.parentElement) {
            const siblings = Array.from(element.parentElement.children);
            const position = siblings.indexOf(element) + 1;
            return `${selector}:nth-child(${position})`;
          }
        
          if (element.className) {
            const classes = element.className.split(/\s+/).filter((cls: string) => Boolean(cls));
            if (classes.length > 0) {
              const validClasses = classes.filter((cls: string) => !cls.startsWith('!') && !cls.includes(':'));
              if (validClasses.length > 0) {
                selector += '.' + validClasses.map(cls => CSS.escape(cls)).join('.');
              }
            }
          }
        
          if (element.parentElement) {
            const siblings = Array.from(element.parentElement.children);
            
            const elementClasses = Array.from(element.classList || []);
            
            const similarSiblings = siblings.filter(sibling => {
              if (sibling === element) return false;
              const siblingClasses = Array.from(sibling.classList || []);
              return siblingClasses.some(cls => elementClasses.includes(cls));
            });
            
            if (similarSiblings.length > 0) {
              const position = siblings.indexOf(element) + 1;
              selector += `:nth-child(${position})`;
            }
          }
        
          return selector;
        }

        // Get complete context path (iframe, frame, and shadow DOM)
        function getContextPath(element: HTMLElement): DOMContext[] {
          const path: DOMContext[] = [];
          let current = element;
          let depth = 0;
          const MAX_DEPTH = 4;
          
          while (current && depth < MAX_DEPTH) {
            // Check for shadow DOM
            const rootNode = current.getRootNode();
            if (rootNode instanceof ShadowRoot) {
              path.unshift({
                type: 'shadow',
                element: current,
                container: rootNode,
                host: rootNode.host as HTMLElement
              });
              current = rootNode.host as HTMLElement;
              depth++;
              continue;
            }

            // Check for iframe or frame
            const ownerDocument = current.ownerDocument;
            const frameElement = ownerDocument?.defaultView?.frameElement;
            
            if (frameElement) {
              const isFrame = frameElement.tagName === 'FRAME';
              path.unshift({
                type: isFrame ? 'frame' : 'iframe',
                element: current,
                container: frameElement as (HTMLIFrameElement | HTMLFrameElement),
                document: ownerDocument
              });
              current = frameElement as HTMLElement;
              depth++;
              continue;
            }

            break;
          }
          
          return path;
        }

        function getSelectorPath(element: HTMLElement | null): string {
          if (!element) return '';
          
          // Get the complete context path
          const contextPath = getContextPath(element);
          if (contextPath.length > 0) {
            const selectorParts: string[] = [];
            
            contextPath.forEach((context, index) => {
              const containerSelector = getNonUniqueSelector(
                context.type === 'shadow' ? context.host! : context.container as HTMLElement
              );
              
              if (index === contextPath.length - 1) {
                const elementSelector = getNonUniqueSelector(element);
                const delimiter = context.type === 'shadow' ? ' >> ' : ' :>> ';
                selectorParts.push(`${containerSelector}${delimiter}${elementSelector}`);
              } else {
                selectorParts.push(containerSelector);
              }
            });
            
            return selectorParts.join(contextPath[0].type === 'shadow' ? ' >> ' : ' :>> ');
          }

          // Regular DOM path generation
          const path: string[] = [];
          let currentElement = element;
          const MAX_DEPTH = 2;
          let depth = 0;

          while (currentElement && currentElement !== document.body && depth < MAX_DEPTH) {
            const selector = getNonUniqueSelector(currentElement);
            path.unshift(selector);
            
            if (!currentElement.parentElement) break;
            currentElement = currentElement.parentElement;
            depth++;
          }

          return path.join(' > ');
        }

        const originalEl = getDeepestElementFromPoint(x, y);
        if (!originalEl) return { generalSelector: '' };

        let element = originalEl;

        const generalSelector = getSelectorPath(element);
        return { generalSelector };
      }, coordinates);

      return selectors || { generalSelector: '' };
    }
  } catch (error) {
    console.error('Error in getNonUniqueSelectors:', error);
    return { generalSelector: '' };
  }
};

export const getChildSelectors = async (page: Page, parentSelector: string): Promise<Array<{ selector: string, info: any }>> => {
  try {
    const childElements = await page.evaluate((containerSelector: string) => {
      function getAllDescendantsWithInfo(container: HTMLElement): Array<{ element: HTMLElement, info: any }> {
        const result: Array<{ element: HTMLElement, info: any }> = [];
        
        function processElement(element: HTMLElement) {
          const rect = element.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) {
            return null;
          }
          
          const info: any = {
            tagName: element.tagName,
            innerText: element.textContent?.trim() || '',
            rect: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
              left: rect.left
            }
          };
          
          if (element.tagName === 'A') {
            info.url = (element as HTMLAnchorElement).href;
          } else if (element.tagName === 'IMG') {
            info.imageUrl = (element as HTMLImageElement).src;
            info.alt = (element as HTMLImageElement).alt;
          } else if (element.tagName === 'INPUT') {
            info.inputType = (element as HTMLInputElement).type;
            info.value = (element as HTMLInputElement).value;
          }
          
          info.attributes = {};
          for (const attr of element.attributes) {
            info.attributes[attr.name] = attr.value;
          }
          
          if (element.shadowRoot) {
            info.isShadowRoot = true;
            info.shadowRootMode = element.shadowRoot.mode;
          }
          
          return { element, info };
        }
        
        function collectDescendants(parent: HTMLElement) {
          const children = Array.from(parent.children) as HTMLElement[];
          
          for (const child of children) {
            const childInfo = processElement(child);
            if (childInfo) {
              result.push(childInfo);
            }
            collectDescendants(child);
          }
          
          if (parent.shadowRoot) {
            const shadowChildren = Array.from(parent.shadowRoot.querySelectorAll('*')) as HTMLElement[];
            for (const shadowChild of shadowChildren) {
              const childInfo = processElement(shadowChild);
              if (childInfo) {
                result.push(childInfo);
              }
            }
          }
          
          const iframes = Array.from(parent.querySelectorAll('iframe')) as HTMLIFrameElement[];
          for (const iframe of iframes) {
            try {
              if (iframe.contentDocument) {
                const frameElements = Array.from(iframe.contentDocument.querySelectorAll('*')) as HTMLElement[];
                for (const frameEl of frameElements) {
                  const childInfo = processElement(frameEl);
                  if (childInfo) {
                    result.push(childInfo);
                  }
                }
              }
            } catch (e) {
              console.warn('Cannot access iframe content', e);
            }
          }
          
          const frames = Array.from(parent.querySelectorAll('frame')) as HTMLFrameElement[];
          for (const frame of frames) {
            try {
              if (frame.contentDocument) {
                const frameElements = Array.from(frame.contentDocument.querySelectorAll('*')) as HTMLElement[];
                for (const frameEl of frameElements) {
                  const childInfo = processElement(frameEl);
                  if (childInfo) {
                    result.push(childInfo);
                  }
                }
              }
            } catch (e) {
              console.warn('Cannot access frame content', e);
            }
          }
        }
        
        collectDescendants(container);
        return result;
      }
      
      function getRelativeSelector(container: HTMLElement, element: HTMLElement): string | null {
        let isDescendant = false;
        let parent: HTMLElement | null = element;
        
        while (parent && parent !== document.documentElement) {
          if (parent === container) {
            isDescendant = true;
            break;
          }
          parent = parent.parentElement;
        }
        
        if (!isDescendant) {
          if (container.shadowRoot) {
            const shadowElements = Array.from(container.shadowRoot.querySelectorAll('*')) as HTMLElement[];
            if (shadowElements.includes(element)) {
              isDescendant = true;
            }
          }
          
          const frames = [
            ...Array.from(container.querySelectorAll('iframe')),
            ...Array.from(container.querySelectorAll('frame'))
          ];
          
          for (const frame of frames) {
            try {
              const frameDoc = (frame as HTMLIFrameElement | HTMLFrameElement).contentDocument;
              if (frameDoc && frameDoc.contains(element)) {
                isDescendant = true;
                break;
              }
            } catch (e) {
              console.warn('Cannot access frame content', e);
            }
          }
          
          if (!isDescendant) {
            return null;
          }
        }
        
        const path: string[] = [];
        let current: Node | null = element;
        
        while (current && current !== container && current !== document.documentElement) {
          if (current.nodeType !== Node.ELEMENT_NODE) {
            current = current.parentNode;
            continue;
          }
          
          const el = current as HTMLElement;
          let selector = el.tagName.toLowerCase();
          
          if (el.id) {
            selector = `#${el.id}`;
          } 
          else if (el.className && typeof el.className === 'string') {
            const classes = el.className.split(/\s+/)
              .filter(c => c && !c.startsWith('!') && !c.includes(':'))
              .map(c => `.${CSS.escape(c)}`)
              .join('');
            
            if (classes) {
              selector += classes;
            }
          }
          
          const parent = el.parentElement;
          if (parent && parent !== container) {
            const siblings = Array.from(parent.children);
            if (siblings.length > 1) {
              const index = siblings.indexOf(el) + 1;
              selector += `:nth-child(${index})`;
            }
          }
          
          path.unshift(selector);
          current = current.parentNode;
          
          if (current instanceof ShadowRoot) {
            current = current.host;
          }
        }
        
        return path.join(' > ');
      }
      
      try {
        let containers: HTMLElement[] = [];
        if (containerSelector.includes('>>')) {
          const parts = containerSelector.split('>>').map(p => p.trim());
          let elements = Array.from(document.querySelectorAll(parts[0])) as HTMLElement[];
          
          for (let i = 1; i < parts.length; i++) {
            const nextElements: HTMLElement[] = [];
            for (const el of elements) {
              if (el.shadowRoot) {
                const shadowEls = Array.from(el.shadowRoot.querySelectorAll(parts[i])) as HTMLElement[];
                nextElements.push(...shadowEls);
              }
            }
            elements = nextElements;
          }
          
          containers = elements;
        } else if (containerSelector.includes(':>>')) {
          const parts = containerSelector.split(':>>').map(p => p.trim());
          let elements = Array.from(document.querySelectorAll(parts[0])) as HTMLElement[];
          
          for (let i = 1; i < parts.length; i++) {
            const nextElements: HTMLElement[] = [];
            for (const el of elements) {
              if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
                try {
                  const frameDoc = (el as HTMLIFrameElement | HTMLFrameElement).contentDocument;
                  if (frameDoc) {
                    const frameEls = Array.from(frameDoc.querySelectorAll(parts[i])) as HTMLElement[];
                    nextElements.push(...frameEls);
                  }
                } catch (e) {
                  console.warn('Cannot access frame content', e);
                }
              }
            }
            elements = nextElements;
          }
          
          containers = elements;
        } else {
          containers = Array.from(document.querySelectorAll(containerSelector)) as HTMLElement[];
        }
        
        if (containers.length === 0) {
          console.warn('No container elements found for selector:', containerSelector);
          return [];
        }
        
        const result: Array<{ selector: string, info: any }> = [];
        
        for (const container of containers) {
          const rect = container.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) {
            continue;
          }
          
          const descendants = getAllDescendantsWithInfo(container);
          
          for (const { element, info } of descendants) {
            const relativeSelector = getRelativeSelector(container, element);
            if (relativeSelector) {
              const fullSelector = `${containerSelector} > ${relativeSelector}`;
              result.push({ 
                selector: fullSelector, 
                info
              });
            }
          }
          
          if (result.length > 0) {
            break;
          }
        }
        
        return result;
      } catch (error) {
        console.error('Error getting child selectors with info:', error);
        return [];
      }
    }, parentSelector);

    return childElements || [];
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