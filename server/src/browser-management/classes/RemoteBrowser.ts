import {
    Page,
    Browser,
    CDPSession,
    BrowserContext,
} from 'playwright';
import { Socket } from "socket.io";
import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import { PlaywrightBlocker } from '@cliqz/adblocker-playwright';
import fetch from 'cross-fetch';
import sharp from 'sharp';
import logger from '../../logger';
import { InterpreterSettings } from "../../types";
import { WorkflowGenerator } from "../../workflow-management/classes/Generator";
import { WorkflowInterpreter } from "../../workflow-management/classes/Interpreter";
import { getDecryptedProxyConfig } from '../../routes/proxy';
import { getInjectableScript } from 'idcac-playwright';

declare global {
  interface Window {
    rrwebSnapshot?: any;
  }
}

interface RRWebSnapshot {
  type: number;
  childNodes?: RRWebSnapshot[];
  tagName?: string;
  attributes?: Record<string, string>;
  textContent?: string;
  id: number;
  [key: string]: any;
}

interface ProcessedSnapshot {
  snapshot: RRWebSnapshot;
  resources: {
    stylesheets: Array<{
      href: string;
      content: string;
      media?: string;
    }>;
    images: Array<{
      src: string;
      dataUrl: string;
      alt?: string;
    }>;
    fonts: Array<{
      url: string;
      dataUrl: string;
      format?: string;
    }>;
    scripts: Array<{
      src: string;
      content: string;
      type?: string;
    }>;
    media: Array<{
      src: string;
      dataUrl: string;
      type: string;
    }>;
  };
  baseUrl: string;
  viewport: { width: number; height: number };
  timestamp: number;
  processingStats: {
    discoveredResources: {
      images: number;
      stylesheets: number;
      scripts: number;
      fonts: number;
      media: number;
    };
    cachedResources: {
      stylesheets: number;
      images: number;
      fonts: number;
      scripts: number;
      media: number;
    };
    totalCacheSize: number;
  };
}

chromium.use(stealthPlugin());

const MEMORY_CONFIG = {
    gcInterval: 20000, // Check memory more frequently (20s instead of 60s)
    maxHeapSize: 1536 * 1024 * 1024, // 1.5GB
    heapUsageThreshold: 0.7 // 70% (reduced threshold to react earlier)
};

const DEFAULT_VIEWPORT = {
  width: 1280,
  height: 720, 
  deviceScaleFactor: 1,
  mobile: false
};

const SCREENCAST_CONFIG: {
    format: "jpeg" | "png";
    maxWidth: number;
    maxHeight: number;
    targetFPS: number;
    compressionQuality: number;
    maxQueueSize: number;
    skipFrameThreshold: number, 
    enableAdaptiveQuality: boolean, 
} = {
    format: 'jpeg', 
    maxWidth: DEFAULT_VIEWPORT.width,
    maxHeight: DEFAULT_VIEWPORT.height,
    targetFPS: 30, 
    compressionQuality: 0.8, 
    maxQueueSize: 2,
    skipFrameThreshold: 100, 
    enableAdaptiveQuality: true,  
};

/**
 * This class represents a remote browser instance.
 * It is used to allow a variety of interaction with the Playwright's browser instance.
 * Every remote browser holds an instance of a generator and interpreter classes with
 * the purpose of generating and interpreting workflows.
 * @category BrowserManagement
 */
export class RemoteBrowser {

    /**
     * Playwright's [browser](https://playwright.dev/docs/api/class-browser) instance.
     * @private
     */
    private browser: Browser | null = null;

    private context: BrowserContext | null = null;

    /**
     * The Playwright's [CDPSession](https://playwright.dev/docs/api/class-cdpsession) instance,
     * used to talk raw Chrome Devtools Protocol.
     * @private
     */
    private client: CDPSession | null | undefined = null;

    /**
     * Socket.io socket instance enabling communication with the client (frontend) side.
     * @private
     */
    private socket: Socket;

    /**
     * The Playwright's [Page](https://playwright.dev/docs/api/class-page) instance
     * as current interactive remote browser's page.
     * @private
     */
    private currentPage: Page | null | undefined = null;

    /**
     * Interpreter settings for any started interpretation.
     * @private
     */
    private interpreterSettings: InterpreterSettings = {
        debug: false,
        maxConcurrency: 1,
        maxRepeats: 1,
    };

    /**
     * The user ID that owns this browser instance
     * @private
     */
    private userId: string;

    private lastEmittedUrl: string | null = null;

    /**
     * {@link WorkflowGenerator} instance specific to the remote browser.
     */
    public generator: WorkflowGenerator;

    /**
     * {@link WorkflowInterpreter} instance specific to the remote browser.
     */
    public interpreter: WorkflowInterpreter;


    private screenshotQueue: Buffer[] = [];
    private isProcessingScreenshot = false;
    private screencastInterval: NodeJS.Timeout | null = null
    private isScreencastActive: boolean = false;

    private isDOMStreamingActive: boolean = false;
    private domUpdateInterval: NodeJS.Timeout | null = null;
    private renderingMode: "screenshot" | "dom" = "screenshot";

    private lastScrollPosition = { x: 0, y: 0 };
    private scrollThreshold = 200; // pixels
    private snapshotDebounceTimeout: NodeJS.Timeout | null = null;
    private isScrollTriggeredSnapshot = false;

    /**
     * Cache for network resources captured via CDP
     * @private
     */
    private networkResourceCache: Map<
      string,
      {
        url: string;
        content: string;
        mimeType: string;
        base64Encoded: boolean;
        timestamp: number;
        resourceType?: string;
        statusCode?: number;
        headers?: Record<string, any>;
      }
    > = new Map();

    /**
     * Set to track active network requests
     * @private
     */
    private activeRequests: Set<string> = new Set();

    /**
     * Flag to indicate if network monitoring is active
     * @private
     */
    private isNetworkMonitoringActive: boolean = false;

    /**
     * Initializes a new instances of the {@link Generator} and {@link WorkflowInterpreter} classes and
     * assigns the socket instance everywhere.
     * @param socket socket.io socket instance used to communicate with the client side
     * @constructor
     */
    public constructor(socket: Socket, userId: string, poolId: string) {
        this.socket = socket;
        this.userId = userId;
        this.interpreter = new WorkflowInterpreter(socket);
        this.generator = new WorkflowGenerator(socket, poolId);
    }

    private cleanupMemory(): void {
      if (this.screenshotQueue.length > 10) {
          this.screenshotQueue = this.screenshotQueue.slice(-3); // Keep only last 3
      }
    }

    private setupMemoryCleanup(): void {
      setInterval(() => {
          this.cleanupMemory();
      }, 30000); // Every 30 seconds
    }

    private processCSS(
      cssContent: string,
      cssUrl: string,
      baseUrl: string,
      resources?: any
    ): string {
      try {
        let processedContent = cssContent;

        logger.debug(`Processing CSS from: ${cssUrl}`);

        // Process @font-face declarations and collect font resources
        processedContent = processedContent.replace(
          /@font-face\s*\{([^}]*)\}/gi,
          (fontFaceMatch, fontFaceContent) => {
            let newFontFaceContent = fontFaceContent;

            logger.debug(
              `Processing @font-face block: ${fontFaceContent.substring(
                0,
                100
              )}...`
            );

            newFontFaceContent = newFontFaceContent.replace(
              /src\s*:\s*([^;}]+)[;}]/gi,
              (srcMatch: any, srcValue: any) => {
                let newSrcValue = srcValue;

                newSrcValue = newSrcValue.replace(
                  /url\s*\(\s*['"]?([^'")]+)['"]?\s*\)(\s*format\s*\(\s*['"]?[^'")]*['"]?\s*\))?/gi,
                  (urlMatch: any, url: string, formatPart: any) => {
                    const originalUrl = url.trim();

                    logger.debug(`Found font URL in @font-face: ${originalUrl}`);

                    if (
                      originalUrl.startsWith("data:") ||
                      originalUrl.startsWith("blob:")
                    ) {
                      return urlMatch;
                    }

                    try {
                      let absoluteUrl: string;
                      try {
                        absoluteUrl = new URL(originalUrl).href;
                      } catch (e) {
                        absoluteUrl = new URL(originalUrl, cssUrl || baseUrl)
                          .href;
                      }

                      const cachedResource =
                        this.networkResourceCache.get(absoluteUrl);
                      if (cachedResource && resources) {
                        const dataUrl = cachedResource.base64Encoded
                          ? `data:${cachedResource.mimeType};base64,${cachedResource.content}`
                          : `data:${cachedResource.mimeType};base64,${Buffer.from(
                              cachedResource.content,
                              "utf-8"
                            ).toString("base64")}`;

                        resources.fonts.push({
                          url: absoluteUrl,
                          dataUrl,
                          format: originalUrl.split(".").pop()?.split("?")[0],
                        });
                      }

                      // Keep original URL in CSS
                      return urlMatch;
                    } catch (e) {
                      logger.warn(
                        "Failed to process font URL in @font-face:",
                        originalUrl,
                        e
                      );
                      return urlMatch;
                    }
                  }
                );

                return `src: ${newSrcValue};`;
              }
            );

            return `@font-face {${newFontFaceContent}}`;
          }
        );

        // Process other url() references and collect resources
        processedContent = processedContent.replace(
          /url\s*\(\s*['"]?([^'")]+)['"]?\s*\)/gi,
          (match, url) => {
            const originalUrl = url.trim();

            if (
              originalUrl.startsWith("data:") ||
              originalUrl.startsWith("blob:")
            ) {
              return match;
            }

            try {
              let absoluteUrl: string;
              try {
                absoluteUrl = new URL(originalUrl).href;
              } catch (e) {
                absoluteUrl = new URL(originalUrl, cssUrl || baseUrl).href;
              }

              const cachedResource = this.networkResourceCache.get(absoluteUrl);
              if (cachedResource && resources) {
                const lowerMimeType = cachedResource.mimeType.toLowerCase();

                if (lowerMimeType.includes("image/")) {
                  const dataUrl = cachedResource.base64Encoded
                    ? `data:${cachedResource.mimeType};base64,${cachedResource.content}`
                    : `data:${cachedResource.mimeType};base64,${Buffer.from(
                        cachedResource.content,
                        "utf-8"
                      ).toString("base64")}`;

                  resources.images.push({
                    src: absoluteUrl,
                    dataUrl,
                    alt: "",
                  });
                } else if (
                  lowerMimeType.includes("font/") ||
                  lowerMimeType.includes("application/font")
                ) {
                  const dataUrl = cachedResource.base64Encoded
                    ? `data:${cachedResource.mimeType};base64,${cachedResource.content}`
                    : `data:${cachedResource.mimeType};base64,${Buffer.from(
                        cachedResource.content,
                        "utf-8"
                      ).toString("base64")}`;

                  resources.fonts.push({
                    url: absoluteUrl,
                    dataUrl,
                    format: originalUrl.split(".").pop()?.split("?")[0],
                  });
                }
              }

              // Keep original URL in CSS
              return match;
            } catch (e) {
              logger.warn(`Failed to process CSS URL: ${originalUrl}`, e);
              return match;
            }
          }
        );

        // Process @import statements and collect stylesheets
        processedContent = processedContent.replace(
          /@import\s+(?:url\s*\(\s*)?['"]?([^'")]+)['"]?\s*\)?([^;]*);?/gi,
          (match, url, mediaQuery) => {
            const originalUrl = url.trim();

            if (
              originalUrl.startsWith("data:") ||
              originalUrl.startsWith("blob:")
            ) {
              return match;
            }

            try {
              let absoluteUrl: string;
              try {
                absoluteUrl = new URL(originalUrl).href;
              } catch (e) {
                absoluteUrl = new URL(originalUrl, cssUrl || baseUrl).href;
              }

              const cachedResource = this.networkResourceCache.get(absoluteUrl);
              if (
                cachedResource &&
                resources &&
                cachedResource.mimeType.includes("css")
              ) {
                const content = cachedResource.base64Encoded
                  ? Buffer.from(cachedResource.content, "base64").toString(
                      "utf-8"
                    )
                  : cachedResource.content;

                resources.stylesheets.push({
                  href: absoluteUrl,
                  content: this.processCSS(
                    content,
                    absoluteUrl,
                    baseUrl,
                    resources
                  ),
                  media: mediaQuery ? mediaQuery.trim() : "all",
                });
              }

              // Keep original @import
              return match;
            } catch (e) {
              logger.warn(`Failed to process CSS @import: ${originalUrl}`, e);
              return match;
            }
          }
        );

        logger.debug(`CSS processing completed for: ${cssUrl}`);
        return processedContent;
      } catch (error) {
        logger.error("Failed to process CSS content:", error);
        return cssContent; // Return original content if processing fails
      }
    }

    private async processRRWebSnapshot(
      snapshot: RRWebSnapshot
    ): Promise<ProcessedSnapshot> {
      const baseUrl = this.currentPage?.url() || "";

      const resources = {
        stylesheets: [] as Array<{
          href: string;
          content: string;
          media?: string;
        }>,
        images: [] as Array<{ src: string; dataUrl: string; alt?: string }>,
        fonts: [] as Array<{ url: string; dataUrl: string; format?: string }>,
        scripts: [] as Array<{ src: string; content: string; type?: string }>,
        media: [] as Array<{ src: string; dataUrl: string; type: string }>,
      };

      const processNode = (node: RRWebSnapshot): RRWebSnapshot => {
        const processedNode = { ...node };

        // Process attributes if they exist
        if (node.attributes) {
          const newAttributes = { ...node.attributes };

          // Process common attributes that contain URLs
          const urlAttributes = ["src", "href", "data", "poster", "background"];

          for (const attr of urlAttributes) {
            if (newAttributes[attr]) {
              const originalUrl = newAttributes[attr];

              // Categorize and collect the resource instead of proxying
              const lowerAttr = attr.toLowerCase();
              const lowerUrl = originalUrl.toLowerCase();

              if (lowerAttr === "src" && node.tagName?.toLowerCase() === "img") {
                const cachedResource = this.networkResourceCache.get(originalUrl);
                if (
                  cachedResource &&
                  cachedResource.mimeType.includes("image/")
                ) {
                  const dataUrl = cachedResource.base64Encoded
                    ? `data:${cachedResource.mimeType};base64,${cachedResource.content}`
                    : `data:${cachedResource.mimeType};base64,${Buffer.from(
                        cachedResource.content,
                        "utf-8"
                      ).toString("base64")}`;

                  resources.images.push({
                    src: originalUrl,
                    dataUrl,
                    alt: newAttributes.alt,
                  });
                }
              } else if (
                lowerAttr === "href" &&
                node.tagName?.toLowerCase() === "link"
              ) {
                const rel = newAttributes.rel?.toLowerCase() || "";

                if (rel.includes("stylesheet")) {
                  const cachedResource =
                    this.networkResourceCache.get(originalUrl);
                  if (cachedResource && cachedResource.mimeType.includes("css")) {
                    let content = cachedResource.base64Encoded
                      ? Buffer.from(cachedResource.content, "base64").toString(
                          "utf-8"
                        )
                      : cachedResource.content;

                    // Process CSS to collect embedded resources
                    content = this.processCSS(
                      content,
                      originalUrl,
                      baseUrl,
                      resources
                    );

                    resources.stylesheets.push({
                      href: originalUrl,
                      content,
                      media: newAttributes.media || "all",
                    });
                  }
                } else if (
                  rel.includes("font") ||
                  lowerUrl.match(/\.(woff2?|ttf|otf|eot)(\?.*)?$/i)
                ) {
                  const cachedResource =
                    this.networkResourceCache.get(originalUrl);
                  if (cachedResource) {
                    const dataUrl = cachedResource.base64Encoded
                      ? `data:${cachedResource.mimeType};base64,${cachedResource.content}`
                      : `data:${cachedResource.mimeType};base64,${Buffer.from(
                          cachedResource.content,
                          "utf-8"
                        ).toString("base64")}`;

                    resources.fonts.push({
                      url: originalUrl,
                      dataUrl,
                      format: lowerUrl.split(".").pop()?.split("?")[0],
                    });
                  }
                }
              }
            }
          }

          // Process srcset attribute - collect resources but keep original URLs
          if (newAttributes.srcset) {
            const originalSrcset = newAttributes.srcset;
            originalSrcset.split(",").forEach((srcsetItem) => {
              const parts = srcsetItem.trim().split(/\s+/);
              const url = parts[0];

              if (url && !url.startsWith("data:") && !url.startsWith("blob:")) {
                const cachedResource = this.networkResourceCache.get(url);
                if (
                  cachedResource &&
                  cachedResource.mimeType.includes("image/")
                ) {
                  const dataUrl = cachedResource.base64Encoded
                    ? `data:${cachedResource.mimeType};base64,${cachedResource.content}`
                    : `data:${cachedResource.mimeType};base64,${Buffer.from(
                        cachedResource.content,
                        "utf-8"
                      ).toString("base64")}`;

                  resources.images.push({
                    src: url,
                    dataUrl,
                    alt: newAttributes.alt,
                  });
                }
              }
            });
          }

          processedNode.attributes = newAttributes;
        }

        // Process text content for style elements
        if (node.tagName?.toLowerCase() === "style" && node.textContent) {
          let content = node.textContent;

          // Process CSS content to collect embedded resources
          content = this.processCSS(content, "", baseUrl, resources);
          processedNode.textContent = content;
        }

        // Recursively process child nodes
        if (node.childNodes) {
          processedNode.childNodes = node.childNodes.map(processNode);
        }

        return processedNode;
      };

      const processedSnapshot = processNode(snapshot);

      // Add cached scripts and media
      for (const [url, resource] of this.networkResourceCache.entries()) {
        if (resource.mimeType.toLowerCase().includes("javascript")) {
          const content = resource.base64Encoded
            ? Buffer.from(resource.content, "base64").toString("utf-8")
            : resource.content;

          resources.scripts.push({
            src: url,
            content,
            type: "text/javascript",
          });
        } else if (
          resource.mimeType.toLowerCase().includes("video/") ||
          resource.mimeType.toLowerCase().includes("audio/")
        ) {
          const dataUrl = resource.base64Encoded
            ? `data:${resource.mimeType};base64,${resource.content}`
            : `data:${resource.mimeType};base64,${Buffer.from(
                resource.content,
                "utf-8"
              ).toString("base64")}`;

          resources.media.push({
            src: url,
            dataUrl,
            type: resource.mimeType,
          });
        }
      }

      const viewport = (await this.currentPage?.viewportSize()) || {
        width: 1280,
        height: 720,
      };

      return {
        snapshot: snapshot,
        resources,
        baseUrl,
        viewport,
        timestamp: Date.now(),
        processingStats: {
          discoveredResources: {
            images: resources.images.length,
            stylesheets: resources.stylesheets.length,
            scripts: resources.scripts.length,
            fonts: resources.fonts.length,
            media: resources.media.length,
          },
          cachedResources: {
            stylesheets: resources.stylesheets.length,
            images: resources.images.length,
            fonts: resources.fonts.length,
            scripts: resources.scripts.length,
            media: resources.media.length,
          },
          totalCacheSize: this.networkResourceCache.size,
        },
      };
    }

    /**
     * Check if a resource should be cached based on its MIME type and URL
     * @private
     */
    private shouldCacheResource(mimeType: string, url: string): boolean {
      const lowerMimeType = mimeType.toLowerCase();
      const lowerUrl = url.toLowerCase();

      // CSS Resources
      if (
        lowerMimeType.includes("text/css") ||
        lowerMimeType.includes("application/css") ||
        lowerUrl.endsWith(".css")
      ) {
        return true;
      }

      // Font Resources
      if (
        lowerMimeType.includes("font/") ||
        lowerMimeType.includes("application/font") ||
        lowerMimeType.includes("application/x-font") ||
        lowerUrl.match(/\.(woff2?|ttf|otf|eot)(\?.*)?$/)
      ) {
        return true;
      }

      // Image Resources
      if (
        lowerMimeType.includes("image/") ||
        lowerUrl.match(/\.(jpg|jpeg|png|gif|webp|svg|ico|bmp|tiff|avif)(\?.*)?$/)
      ) {
        return true;
      }

      // JavaScript Resources
      if (
        lowerMimeType.includes("javascript") ||
        lowerMimeType.includes("text/js") ||
        lowerMimeType.includes("application/js") ||
        lowerUrl.match(/\.js(\?.*)?$/)
      ) {
        return true;
      }

      // Media Resources
      if (
        lowerMimeType.includes("video/") ||
        lowerMimeType.includes("audio/") ||
        lowerUrl.match(
          /\.(mp4|webm|ogg|avi|mov|wmv|flv|mp3|wav|m4a|aac|flac)(\?.*)?$/
        )
      ) {
        return true;
      }

      // Document Resources
      if (
        lowerMimeType.includes("application/pdf") ||
        lowerMimeType.includes("application/msword") ||
        lowerMimeType.includes("application/vnd.ms-") ||
        lowerMimeType.includes("application/vnd.openxmlformats-") ||
        lowerUrl.match(/\.(pdf|doc|docx|xls|xlsx|ppt|pptx)(\?.*)?$/)
      ) {
        return true;
      }

      // Manifest and Icon Resources
      if (
        lowerMimeType.includes("application/manifest+json") ||
        lowerUrl.includes("manifest.json") ||
        lowerUrl.includes("browserconfig.xml")
      ) {
        return true;
      }

      // SVG Resources (can be images or fonts)
      if (lowerMimeType.includes("image/svg+xml") || lowerUrl.endsWith(".svg")) {
        return true;
      }

      // Other common web resources
      if (
        lowerMimeType.includes("application/octet-stream") &&
        lowerUrl.match(/\.(woff2?|ttf|otf|eot|css|js)(\?.*)?$/)
      ) {
        return true;
      }

      return false;
    }

    /**
     * Clean up old cached resources to prevent memory leaks
     * @private
     */
    private cleanupResourceCache(): void {
      const now = Date.now();
      const maxAge = 5 * 60 * 1000; // 5 minutes

      for (const [url, resource] of this.networkResourceCache.entries()) {
        if (now - resource.timestamp > maxAge) {
          this.networkResourceCache.delete(url);
        }
      }

      if (this.networkResourceCache.size > 200) {
        const entries = Array.from(this.networkResourceCache.entries());
        entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

        for (let i = 0; i < 50; i++) {
          this.networkResourceCache.delete(entries[i][0]);
        }
      }

      logger.debug(
        `Resource cache cleaned up. Current size: ${this.networkResourceCache.size}`
      );
    }

    /**
     * Initialize network monitoring via CDP to capture all resources
     * @private
     */
    private async initializeNetworkMonitoring(): Promise<void> {
      if (!this.client || this.isNetworkMonitoringActive) {
        return;
      }

      try {
        await this.client.send("Network.enable");
        await this.client.send("Runtime.enable");
        await this.client.send("Page.enable");

        await this.client.send("Network.setRequestInterception", {
          patterns: [
            { urlPattern: "*", resourceType: "Stylesheet" },
            { urlPattern: "*", resourceType: "Image" },
            { urlPattern: "*", resourceType: "Font" },
            { urlPattern: "*", resourceType: "Script" },
            { urlPattern: "*", resourceType: "Media" },
            { urlPattern: "*", resourceType: "Document" },
            { urlPattern: "*", resourceType: "Manifest" },
            { urlPattern: "*", resourceType: "Other" },
          ],
        });

        this.isNetworkMonitoringActive = true;
        logger.info("Enhanced network monitoring enabled via CDP");

        this.client.on(
          "Network.responseReceived",
          async ({ requestId, response, type }) => {
            const mimeType = response.mimeType?.toLowerCase() || "";
            const url = response.url;
            const resourceType = type;

            logger.debug(
              `Resource received: ${resourceType} - ${mimeType} - ${url}`
            );

            if (this.shouldCacheResource(mimeType, url)) {
              this.activeRequests.add(requestId);

              try {
                const { body, base64Encoded } = await this.client!.send(
                  "Network.getResponseBody",
                  { requestId }
                );

                this.networkResourceCache.set(url, {
                  url,
                  content: body,
                  mimeType: response.mimeType || "application/octet-stream",
                  base64Encoded,
                  timestamp: Date.now(),
                  resourceType,
                  statusCode: response.status,
                  headers: response.headers,
                });

                logger.debug(
                  `Cached ${resourceType} resource: ${url} (${mimeType})`
                );
              } catch (error) {
                logger.warn(
                  `Failed to capture ${resourceType} resource body for ${url}:`,
                  error
                );
              } finally {
                this.activeRequests.delete(requestId);
              }
            }
          }
        );

        this.client.on(
          "Network.requestIntercepted",
          async ({ interceptionId, request }) => {
            try {
              await this.client!.send("Network.continueInterceptedRequest", {
                interceptionId,
              });
              logger.debug(`Request intercepted and continued: ${request.url}`);
            } catch (error) {
              logger.warn(
                `Failed to continue intercepted request for ${request.url}:`,
                error
              );
            }
          }
        );

        this.client.on(
          "Network.loadingFailed",
          ({ requestId, errorText, type }) => {
            this.activeRequests.delete(requestId);
            logger.debug(`Network request failed (${type}): ${errorText}`);
          }
        );

        this.client.on("Network.loadingFinished", ({ requestId }) => {
          this.activeRequests.delete(requestId);
        });

        // Clean up cache periodically
        setInterval(() => {
          this.cleanupResourceCache();
        }, 60000);
      } catch (error) {
        logger.error("Failed to initialize enhanced network monitoring:", error);
        this.isNetworkMonitoringActive = false;
      }
    }

    private initializeMemoryManagement(): void {
        setInterval(() => {
            const memoryUsage = process.memoryUsage();
            const heapUsageRatio = memoryUsage.heapUsed / MEMORY_CONFIG.maxHeapSize;
            
            if (heapUsageRatio > MEMORY_CONFIG.heapUsageThreshold * 1.2) {
                logger.warn('Critical memory pressure detected, triggering emergency cleanup');
                this.performMemoryCleanup();
            } else if (heapUsageRatio > MEMORY_CONFIG.heapUsageThreshold) {
                logger.warn('High memory usage detected, triggering cleanup');
                
                if (this.screenshotQueue.length > 0) {
                    this.screenshotQueue = [];
                    logger.info('Screenshot queue cleared due to memory pressure');
                }
                
                if (global.gc && heapUsageRatio > MEMORY_CONFIG.heapUsageThreshold * 1.1) {
                    global.gc();
                }
            }
            
            if (this.screenshotQueue.length > SCREENCAST_CONFIG.maxQueueSize) {
                this.screenshotQueue = this.screenshotQueue.slice(-SCREENCAST_CONFIG.maxQueueSize);
            }
        }, MEMORY_CONFIG.gcInterval);
    }

    private async performMemoryCleanup(): Promise<void> {
        this.screenshotQueue = [];
        this.isProcessingScreenshot = false;
        
        if (global.gc) {
            try {
                global.gc();
                logger.info('Garbage collection requested');
            } catch (error) {
                logger.error('Error during garbage collection:', error);
            }
        }
        
        if (this.client) {
            try {
                await this.stopScreencast();
                
                await new Promise(resolve => setTimeout(resolve, 500));
                
                this.client = null;
                if (this.currentPage) {
                    this.client = await this.currentPage.context().newCDPSession(this.currentPage);
                    await this.startScreencast();
                    logger.info('CDP session reset completed');
                }
            } catch (error) {
                logger.error('Error resetting CDP session:', error);
            }
        }
        
        this.socket.emit('memory-cleanup', {
            userId: this.userId,
            timestamp: Date.now()
        });
    }

    /**
     * Normalizes URLs to prevent navigation loops while maintaining consistent format
     */
    private normalizeUrl(url: string): string {
        try {
            const parsedUrl = new URL(url);
            // Remove trailing slashes except for root path
            parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/';
            // Ensure consistent protocol handling
            parsedUrl.protocol = parsedUrl.protocol.toLowerCase();
            return parsedUrl.toString();
        } catch {
            return url;
        }
    }

    /**
     * Determines if a URL change is significant enough to emit
     */
    private shouldEmitUrlChange(newUrl: string): boolean {
        if (!this.lastEmittedUrl) {
            return true;
        }
        const normalizedNew = this.normalizeUrl(newUrl);
        const normalizedLast = this.normalizeUrl(this.lastEmittedUrl);
        return normalizedNew !== normalizedLast;
    }

    /**
     * Setup scroll event listener to track user scrolling
     */
    private setupScrollEventListener(): void {
      this.socket.on(
        "dom:scroll",
        async (data: { deltaX: number; deltaY: number }) => {
          if (!this.isDOMStreamingActive || !this.currentPage) return;

          try {
            logger.debug(
              `Received scroll event: deltaX=${data.deltaX}, deltaY=${data.deltaY}`
            );

            await this.currentPage.mouse.wheel(data.deltaX, data.deltaY);

            const scrollInfo = await this.currentPage.evaluate(() => ({
              x: window.scrollX,
              y: window.scrollY,
              maxX: Math.max(
                0,
                document.documentElement.scrollWidth - window.innerWidth
              ),
              maxY: Math.max(
                0,
                document.documentElement.scrollHeight - window.innerHeight
              ),
              documentHeight: document.documentElement.scrollHeight,
              viewportHeight: window.innerHeight,
            }));

            const scrollDelta =
              Math.abs(scrollInfo.y - this.lastScrollPosition.y) +
              Math.abs(scrollInfo.x - this.lastScrollPosition.x);

            logger.debug(
              `Scroll delta: ${scrollDelta}, threshold: ${this.scrollThreshold}`
            );

            if (scrollDelta > this.scrollThreshold) {
              this.lastScrollPosition = { x: scrollInfo.x, y: scrollInfo.y };
              this.isScrollTriggeredSnapshot = true;

              if (this.snapshotDebounceTimeout) {
                clearTimeout(this.snapshotDebounceTimeout);
              }

              this.snapshotDebounceTimeout = setTimeout(async () => {
                logger.info(
                  `Triggering snapshot due to scroll. Position: ${scrollInfo.y}/${scrollInfo.maxY}`
                );

                await this.makeAndEmitDOMSnapshot();
              }, 300);
            }
          } catch (error) {
            logger.error("Error handling scroll event:", error);
          }
        }
      );
    }

    private setupPageChangeListeners(): void {
      if (!this.currentPage) return;

      this.currentPage.on("domcontentloaded", async () => {
        logger.info("DOM content loaded - triggering snapshot");
        await this.makeAndEmitDOMSnapshot();
      });

      this.currentPage.on("response", async (response) => {
        const url = response.url();
        if (
          response.request().resourceType() === "document" ||
          url.includes("api/") ||
          url.includes("ajax")
        ) {
          setTimeout(async () => {
            await this.makeAndEmitDOMSnapshot();
          }, 800);
        }
      });
    }

    private async setupPageEventListeners(page: Page) {
        page.on('framenavigated', async (frame) => {
            if (frame === page.mainFrame()) {
                const currentUrl = page.url();
                if (this.shouldEmitUrlChange(currentUrl)) {
                    this.lastEmittedUrl = currentUrl;
                    this.socket.emit('urlChanged', {url: currentUrl, userId: this.userId});
                }
            }
        });

        // Handle page load events with retry mechanism
        page.on('load', async () => {
            const injectScript = async (): Promise<boolean> => {
                try {
                    await page.waitForLoadState('networkidle', { timeout: 5000 });

                    await page.evaluate(getInjectableScript());
                    return true;
                } catch (error: any) {
                    logger.log('warn', `Script injection attempt failed: ${error.message}`);
                    return false;
                }
            };

            const success = await injectScript();
            console.log("Script injection result:", success);
        });
    }

    private getUserAgent() {
        const userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.5845.140 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:117.0) Gecko/20100101 Firefox/117.0',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.1938.81 Safari/537.36 Edg/116.0.1938.81',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.5845.96 Safari/537.36 OPR/101.0.4843.25',
            'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.5938.62 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:118.0) Gecko/20100101 Firefox/118.0',
        ];

        return userAgents[Math.floor(Math.random() * userAgents.length)];
    }

    /**
     * An asynchronous constructor for asynchronously initialized properties.
     * Must be called right after creating an instance of RemoteBrowser class.
     * @param options remote browser options to be used when launching the browser
     * @returns {Promise<void>}
     */
    public initialize = async (userId: string): Promise<void> => {
        const MAX_RETRIES = 3;
        let retryCount = 0;
        let success = false;
    
        while (!success && retryCount < MAX_RETRIES) {
            try {
                this.browser = <Browser>(await chromium.launch({
                    headless: true,
                    args: [
                        "--disable-blink-features=AutomationControlled",
                        "--disable-web-security",
                        "--disable-features=IsolateOrigins,site-per-process",
                        "--disable-site-isolation-trials",
                        "--disable-extensions",
                        "--no-sandbox",
                        "--disable-dev-shm-usage",
                        "--force-color-profile=srgb",
                        "--force-device-scale-factor=2",
                        "--ignore-certificate-errors"
                    ],
                }));
                
                if (!this.browser || this.browser.isConnected() === false) {
                    throw new Error('Browser failed to launch or is not connected');
                }
                
                const proxyConfig = await getDecryptedProxyConfig(userId);
                let proxyOptions: { server: string, username?: string, password?: string } = { server: '' };
                
                if (proxyConfig.proxy_url) {
                    proxyOptions = {
                        server: proxyConfig.proxy_url,
                        ...(proxyConfig.proxy_username && proxyConfig.proxy_password && {
                            username: proxyConfig.proxy_username,
                            password: proxyConfig.proxy_password,
                        }),
                    };
                }
                
                const contextOptions: any = {
                    // viewport: { height: 400, width: 900 },
                    // recordVideo: { dir: 'videos/' }
                    // Force reduced motion to prevent animation issues
                    reducedMotion: 'reduce',
                    // Force JavaScript to be enabled
                    javaScriptEnabled: true,
                    // Set a reasonable timeout
                    timeout: 50000,
                    // Disable hardware acceleration
                    forcedColors: 'none',
                    isMobile: false,
                    hasTouch: false,
                    userAgent: this.getUserAgent(),
                };
    
                if (proxyOptions.server) {
                    contextOptions.proxy = {
                        server: proxyOptions.server,
                        username: proxyOptions.username ? proxyOptions.username : undefined,
                        password: proxyOptions.password ? proxyOptions.password : undefined,
                    };
                }
    
                await new Promise(resolve => setTimeout(resolve, 500));
                
                const contextPromise = this.browser.newContext(contextOptions);
                this.context = await Promise.race([
                    contextPromise,
                    new Promise<never>((_, reject) => {
                        setTimeout(() => reject(new Error('Context creation timed out after 15s')), 15000);
                    })
                ]) as BrowserContext;
                
                await this.context.addInitScript(
                    `const defaultGetter = Object.getOwnPropertyDescriptor(
                      Navigator.prototype,
                      "webdriver"
                    ).get;
                    defaultGetter.apply(navigator);
                    defaultGetter.toString();
                    Object.defineProperty(Navigator.prototype, "webdriver", {
                      set: undefined,
                      enumerable: true,
                      configurable: true,
                      get: new Proxy(defaultGetter, {
                        apply: (target, thisArg, args) => {
                          Reflect.apply(target, thisArg, args);
                          return false;
                        },
                      }),
                    });
                    const patchedGetter = Object.getOwnPropertyDescriptor(
                      Navigator.prototype,
                      "webdriver"
                    ).get;
                    patchedGetter.apply(navigator);
                    patchedGetter.toString();`
                );

                await this.currentPage.addInitScript({ path: './server/src/browser-management/classes/rrweb-bundle.js' });

                this.currentPage = await this.context.newPage();

                await this.setupPageEventListeners(this.currentPage);
    
                const viewportSize = await this.currentPage.viewportSize();
                if (viewportSize) {
                    this.socket.emit('viewportInfo', {
                        width: viewportSize.width,
                        height: viewportSize.height,
                        userId: this.userId
                    });
                }
    
                try {
                    const blocker = await PlaywrightBlocker.fromLists(fetch, ['https://easylist.to/easylist/easylist.txt']);
                    await blocker.enableBlockingInPage(this.currentPage);
                    this.client = await this.currentPage.context().newCDPSession(this.currentPage);
                    await blocker.disableBlockingInPage(this.currentPage);
                    console.log('Adblocker initialized');

                    if (this.client) {
                      await this.initializeNetworkMonitoring();
                      logger.info("Network monitoring initialized successfully");
                    }
                } catch (error: any) {
                    console.warn('Failed to initialize adblocker, continuing without it:', error.message);
                    // Still need to set up the CDP session even if blocker fails
                    this.client = await this.currentPage.context().newCDPSession(this.currentPage);

                    if (this.client) {
                      await this.initializeNetworkMonitoring();
                      logger.info("Network monitoring initialized successfully");
                    } 
                }
                
                success = true;
                logger.log('debug', `Browser initialized successfully for user ${userId}`);
            } catch (error: any) {
                retryCount++;
                logger.log('error', `Browser initialization failed (attempt ${retryCount}/${MAX_RETRIES}): ${error.message}`);
                
                if (this.browser) {
                    try {
                        await this.browser.close();
                    } catch (closeError) {
                        logger.log('warn', `Failed to close browser during cleanup: ${closeError}`);
                    }
                    this.browser = null;
                }
                
                if (retryCount >= MAX_RETRIES) {
                    throw new Error(`Failed to initialize browser after ${MAX_RETRIES} attempts: ${error.message}`);
                }
                
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        this.setupMemoryCleanup();
        // this.initializeMemoryManagement();
    };

    public updateViewportInfo = async (): Promise<void> => {
        if (this.currentPage) {
            const viewportSize = await this.currentPage.viewportSize();
            if (viewportSize) {
                this.socket.emit('viewportInfo', {
                    width: viewportSize.width,
                    height: viewportSize.height,
                    userId: this.userId
                });
            }
        }
    };

    /**
       * Extract data from a list of elements on a page
       * @param page - Playwright Page object
       * @param listSelector - CSS selector for the list container
       * @param fields - Record of field configurations
       * @param limit - Maximum number of items to extract (default: 5)
       * @returns Promise<Array<Record<string, string>>> - Array of extracted data objects
       */
      private async extractListData(
        page: Page, 
        listSelector: string, 
        fields: Record<string, {
          label: string;
          selectorObj: {
            selector: string;
            attribute: string;
          };
        }>,
        limit: number = 5
      ): Promise<Array<Record<string, string>>> {
        return await page.evaluate(
          async ({ listSelector, fields, limit }: { 
            listSelector: string;
            fields: Record<string, {
              label: string;
              selectorObj: {
                selector: string;
                attribute: string;
              };
            }>;
            limit: number;
          }) => {
            const convertedFields: Record<string, { 
              selector: string; 
              attribute: string;
            }> = {};
            
            for (const [key, field] of Object.entries(fields)) {
              convertedFields[field.label] = {
                selector: field.selectorObj.selector,
                attribute: field.selectorObj.attribute
              };
            }
            
            const queryElement = (rootElement: Element | Document, selector: string): Element | null => {
              if (!selector.includes('>>') && !selector.includes(':>>')) {
                return rootElement.querySelector(selector);
              }
    
              const parts = selector.split(/(?:>>|:>>)/).map(part => part.trim());
              let currentElement: Element | Document | null = rootElement;
    
              for (let i = 0; i < parts.length; i++) {
                if (!currentElement) return null;
    
                if ((currentElement as Element).tagName === 'IFRAME' || (currentElement as Element).tagName === 'FRAME') {
                  try {
                    const frameElement = currentElement as HTMLIFrameElement | HTMLFrameElement;
                    const frameDoc = frameElement.contentDocument || frameElement.contentWindow?.document;
                    if (!frameDoc) return null;
                    currentElement = frameDoc.querySelector(parts[i]);
                    continue;
                  } catch (e) {
                    console.warn(`Cannot access ${(currentElement as Element).tagName.toLowerCase()} content:`, e);
                    return null;
                  }
                }
    
                let nextElement: Element | null = null;
                
                if ('querySelector' in currentElement) {
                  nextElement = currentElement.querySelector(parts[i]);
                }
    
                if (!nextElement && 'shadowRoot' in currentElement && (currentElement as Element).shadowRoot) {
                  nextElement = (currentElement as Element).shadowRoot!.querySelector(parts[i]);
                }
    
                if (!nextElement && 'children' in currentElement) {
                  const children: any = Array.from((currentElement as Element).children || []);
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
    
            const queryElementAll = (rootElement: Element | Document, selector: string): Element[] => {
              if (!selector.includes('>>') && !selector.includes(':>>')) {
                return Array.from(rootElement.querySelectorAll(selector));
              }
    
              const parts = selector.split(/(?:>>|:>>)/).map(part => part.trim());
              let currentElements: (Element | Document)[] = [rootElement];
    
              for (const part of parts) {
                const nextElements: Element[] = [];
    
                for (const element of currentElements) {
                  if ((element as Element).tagName === 'IFRAME' || (element as Element).tagName === 'FRAME') {
                    try {
                      const frameElement = element as HTMLIFrameElement | HTMLFrameElement;
                      const frameDoc = frameElement.contentDocument || frameElement.contentWindow?.document;
                      if (frameDoc) {
                        nextElements.push(...Array.from(frameDoc.querySelectorAll(part)));
                      }
                    } catch (e) {
                      console.warn(`Cannot access ${(element as Element).tagName.toLowerCase()} content:`, e);
                      continue;
                    }
                  } else {
                    if ('querySelectorAll' in element) {
                      nextElements.push(...Array.from(element.querySelectorAll(part)));
                    }
                    
                    if ('shadowRoot' in element && (element as Element).shadowRoot) {
                      nextElements.push(...Array.from((element as Element).shadowRoot!.querySelectorAll(part)));
                    }
                    
                    if ('children' in element) {
                      const children = Array.from((element as Element).children || []);
                      for (const child of children) {
                        if (child.shadowRoot) {
                          nextElements.push(...Array.from(child.shadowRoot.querySelectorAll(part)));
                        }
                      }
                    }
                  }
                }
    
                currentElements = nextElements;
              }
    
              return currentElements as Element[];
            };
    
            function extractValue(element: Element, attribute: string): string | null {
              if (!element) return null;
              
              const baseURL = element.ownerDocument?.location?.href || window.location.origin;
              
              if (element.shadowRoot) {
                const shadowContent = element.shadowRoot.textContent;
                if (shadowContent?.trim()) {
                  return shadowContent.trim();
                }
              }
              
              if (attribute === 'innerText') {
                return (element as HTMLElement).innerText.trim();
              } else if (attribute === 'innerHTML') {
                return element.innerHTML.trim();
              } else if (attribute === 'src' || attribute === 'href') {
                if (attribute === 'href' && element.tagName !== 'A') {
                  const parentElement = element.parentElement;
                  if (parentElement && parentElement.tagName === 'A') {
                    const parentHref = parentElement.getAttribute('href');
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
                const dataAttr = attrValue || element.getAttribute('data-' + attribute);
                
                if (!dataAttr || dataAttr.trim() === '') {
                  if (attribute === 'src') {
                    const style = window.getComputedStyle(element);
                    const bgImage = style.backgroundImage;
                    if (bgImage && bgImage !== 'none') {
                      const matches = bgImage.match(/url\(['"]?([^'")]+)['"]?\)/);
                      return matches ? new URL(matches[1], baseURL).href : null;
                    }
                  }
                  return null;
                }
                
                try {
                  return new URL(dataAttr, baseURL).href;
                } catch (e) {
                  console.warn('Error creating URL from', dataAttr, e);
                  return dataAttr; // Return the original value if URL construction fails
                }
              }
              return element.getAttribute(attribute);
            }
    
            function findTableAncestor(element: Element): { type: string; element: Element } | null {
              let currentElement: Element | null = element;
              const MAX_DEPTH = 5;
              let depth = 0;
              
              while (currentElement && depth < MAX_DEPTH) {
                if (currentElement.getRootNode() instanceof ShadowRoot) {
                  currentElement = (currentElement.getRootNode() as ShadowRoot).host;
                  continue;
                }
                
                if (currentElement.tagName === 'TD') {
                  return { type: 'TD', element: currentElement };
                } else if (currentElement.tagName === 'TR') {
                  return { type: 'TR', element: currentElement };
                }
                
                if (currentElement.tagName === 'IFRAME' || currentElement.tagName === 'FRAME') {
                  try {
                    const frameElement = currentElement as HTMLIFrameElement | HTMLFrameElement;
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
            }
    
            function getCellIndex(td: Element): number {
              if (td.getRootNode() instanceof ShadowRoot) {
                const shadowRoot = td.getRootNode() as ShadowRoot;
                const allCells = Array.from(shadowRoot.querySelectorAll('td'));
                return allCells.indexOf(td as HTMLTableCellElement);
              }
              
              let index = 0;
              let sibling = td;
              while (sibling = sibling.previousElementSibling as Element) {
                index++;
              }
              return index;
            }
    
            function hasThElement(row: Element, tableFields: Record<string, { selector: string; attribute: string }>): boolean {
              for (const [_, { selector }] of Object.entries(tableFields)) {
                const element = queryElement(row, selector);
                if (element) {
                  let current: Element | ShadowRoot | Document | null = element;
                  while (current && current !== row) {
                    if (current.getRootNode() instanceof ShadowRoot) {
                      current = (current.getRootNode() as ShadowRoot).host;
                      continue;
                    }
                    
                    if ((current as Element).tagName === 'TH') return true;
                    
                    if ((current as Element).tagName === 'IFRAME' || (current as Element).tagName === 'FRAME') {
                      try {
                        const frameElement = current as HTMLIFrameElement | HTMLFrameElement;
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
            }
    
            function filterRowsBasedOnTag(rows: Element[], tableFields: Record<string, { selector: string; attribute: string }>): Element[] {
              for (const row of rows) {
                if (hasThElement(row, tableFields)) {
                  return rows;
                }
              }
              return rows.filter(row => {
                const directTH = row.getElementsByTagName('TH').length === 0;
                const shadowTH = row.shadowRoot ? 
                  row.shadowRoot.querySelector('th') === null : true;
                return directTH && shadowTH;
              });
            }
    
            function calculateClassSimilarity(classList1: string[], classList2: string[]): number {
              const set1 = new Set(classList1);
              const set2 = new Set(classList2);
              const intersection = new Set([...set1].filter(x => set2.has(x)));
              const union = new Set([...set1, ...set2]);
              return intersection.size / union.size;
            }
    
            function findSimilarElements(baseElement: Element, similarityThreshold: number = 0.7): Element[] {
              const baseClasses = Array.from(baseElement.classList);
              if (baseClasses.length === 0) return [];
    
              const allElements: Element[] = [];
              
              allElements.push(...Array.from(document.getElementsByTagName(baseElement.tagName)));
              
              if (baseElement.getRootNode() instanceof ShadowRoot) {
                const shadowHost = (baseElement.getRootNode() as ShadowRoot).host;
                allElements.push(...Array.from(shadowHost.getElementsByTagName(baseElement.tagName)));
              }
              
              const frames = [
                ...Array.from(document.getElementsByTagName('iframe')),
                ...Array.from(document.getElementsByTagName('frame'))
              ];
              
              for (const frame of frames) {
                try {
                  const frameElement = frame as HTMLIFrameElement | HTMLFrameElement;
                  const frameDoc = frameElement.contentDocument || frameElement.contentWindow?.document;
                  if (frameDoc) {
                    allElements.push(...Array.from(frameDoc.getElementsByTagName(baseElement.tagName)));
                  }
                } catch (e) {
                  console.warn(`Cannot access ${frame.tagName.toLowerCase()} content:`, e);
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
    
            let containers = queryElementAll(document, listSelector);
            
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
              tableFields: {} as Record<string, { 
                selector: string; 
                attribute: string;
                tableContext?: string;
                cellIndex?: number;
              }>,
              nonTableFields: {} as Record<string, { 
                selector: string; 
                attribute: string; 
              }>
            }));
    
            containers.forEach((container, containerIndex) => {
              for (const [label, field] of Object.entries(convertedFields)) {
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
    
            const tableData: Array<Record<string, string>> = [];
            const nonTableData: Array<Record<string, string>> = [];
    
            for (let containerIndex = 0; containerIndex < containers.length; containerIndex++) {
              const container = containers[containerIndex];
              const { tableFields } = containerFields[containerIndex];
    
              if (Object.keys(tableFields).length > 0) {
                const firstField = Object.values(tableFields)[0];
                const firstElement = queryElement(container, firstField.selector);
                let tableContext: Element | null = firstElement;
                
                while (tableContext && tableContext.tagName !== 'TABLE' && tableContext !== container) {
                  if (tableContext.getRootNode() instanceof ShadowRoot) {
                    tableContext = (tableContext.getRootNode() as ShadowRoot).host;
                    continue;
                  }
                  
                  if (tableContext.tagName === 'IFRAME' || tableContext.tagName === 'FRAME') {
                    try {
                      const frameElement = tableContext as HTMLIFrameElement | HTMLFrameElement;
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
                  
                  rows.push(...Array.from(tableContext.getElementsByTagName('TR')));
                  
                  if (tableContext.tagName === 'IFRAME' || tableContext.tagName === 'FRAME') {
                    try {
                      const frameElement = tableContext as HTMLIFrameElement | HTMLFrameElement;
                      const frameDoc = frameElement.contentDocument || frameElement.contentWindow?.document;
                      if (frameDoc) {
                        rows.push(...Array.from(frameDoc.getElementsByTagName('TR')));
                      }
                    } catch (e) {
                      console.warn(`Cannot access ${tableContext.tagName.toLowerCase()} rows:`, e);
                    }
                  }
                  
                  const processedRows = filterRowsBasedOnTag(rows, tableFields);
                  
                  for (let rowIndex = 0; rowIndex < Math.min(processedRows.length, limit); rowIndex++) {
                    const record: Record<string, string> = {};
                    const currentRow = processedRows[rowIndex];
                    
                    for (const [label, { selector, attribute, cellIndex }] of Object.entries(tableFields)) {
                      let element: Element | null = null;
                      
                      if (cellIndex !== undefined && cellIndex >= 0) {
                        let td: Element | null = currentRow.children[cellIndex] || null;
                        
                        if (!td && currentRow.shadowRoot) {
                          const shadowCells = currentRow.shadowRoot.children;
                          if (shadowCells && shadowCells.length > cellIndex) {
                            td = shadowCells[cellIndex];
                          }
                        }
                        
                        if (td) {
                          element = queryElement(td, selector);
                          
                          if (!element && selector.split(/(?:>>|:>>)/).pop()?.includes('td:nth-child')) {
                            element = td;
                          }
    
                          if (!element) {
                            const tagOnlySelector = selector.split('.')[0];
                            element = queryElement(td, tagOnlySelector);
                          }
                          
                          if (!element) {
                            let currentElement: Element | null = td;
                            while (currentElement && currentElement.children.length > 0) {
                              let foundContentChild = false;
                              for (const child of Array.from(currentElement.children)) {
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
                        const value = extractValue(element, attribute);
                        if (value !== null) {
                          record[label] = value;
                        }
                      }
                    }
    
                    if (Object.keys(record).length > 0) {
                      tableData.push(record);
                    }
                  }
                }
              }
            }
    
            for (let containerIndex = 0; containerIndex < containers.length; containerIndex++) {
              if (nonTableData.length >= limit) break;
    
              const container = containers[containerIndex];
              const { nonTableFields } = containerFields[containerIndex];
    
              if (Object.keys(nonTableFields).length > 0) {
                const record: Record<string, string> = {};
    
                for (const [label, { selector, attribute }] of Object.entries(nonTableFields)) {
                  const relativeSelector = selector.split(/(?:>>|:>>)/).slice(-1)[0];
                  const element = queryElement(container, relativeSelector);
                  
                  if (element) {
                    const value = extractValue(element, attribute);
                    if (value !== null) {
                      record[label] = value;
                    }
                  }
                }
                    
                if (Object.keys(record).length > 0) {
                  nonTableData.push(record);
                }
              }  
            }
              
            const scrapedData = [...tableData, ...nonTableData].slice(0, limit);
            return scrapedData;
          }, 
          { listSelector, fields, limit }
        ) as Array<Record<string, string>>;
    }

    /**
     * Captures a screenshot directly without running the workflow interpreter
     * @param settings Screenshot settings containing fullPage, type, etc.
     * @returns Promise<void>
     */
    public captureDirectScreenshot = async (settings: {
      fullPage: boolean;
      type: 'png' | 'jpeg';
      timeout?: number;
      animations?: 'disabled' | 'allow';
      caret?: 'hide' | 'initial';
      scale?: 'css' | 'device';
    }): Promise<void> => {
      if (!this.currentPage) {
        logger.error("No current page available for screenshot");
        this.socket.emit('screenshotError', {
          userId: this.userId,
          error: 'No active page available'
        });
        return;
      }

      try {
        this.socket.emit('screenshotCaptureStarted', {
          userId: this.userId,
          fullPage: settings.fullPage
        });

        const screenshotBuffer = await this.currentPage.screenshot({
          fullPage: settings.fullPage,
          type: settings.type || 'png',
          timeout: settings.timeout || 30000,
          animations: settings.animations || 'allow',
          caret: settings.caret || 'hide',
          scale: settings.scale || 'device'
        });

        const base64Data = screenshotBuffer.toString('base64');
        const mimeType = `image/${settings.type || 'png'}`;
        const dataUrl = `data:${mimeType};base64,${base64Data}`;

        this.socket.emit('directScreenshotCaptured', {
          userId: this.userId,
          screenshot: dataUrl,
          mimeType: mimeType,
          fullPage: settings.fullPage,
          timestamp: Date.now()
        });
      } catch (error) {
        logger.error('Failed to capture direct screenshot:', error);
        this.socket.emit('screenshotError', {
          userId: this.userId,
          error: error instanceof Error ? error.message : 'Unknown error occurred'
        });
      }
    };

    /**
     * Registers all event listeners needed for the recording editor session.
     * Should be called only once after the full initialization of the remote browser.
     * @returns void
     */
    public registerEditorEvents = (): void => {
        // For each event, include userId to make sure events are handled for the correct browser
        logger.log('debug', `Registering editor events for user: ${this.userId}`);

        this.socket.on(`captureDirectScreenshot:${this.userId}`, async (settings) => {
          logger.debug(`Direct screenshot capture requested for user ${this.userId}`);
          await this.captureDirectScreenshot(settings);
        });

        // For backward compatibility
        this.socket.on('captureDirectScreenshot', async (settings) => {
          await this.captureDirectScreenshot(settings);
        });
        
        // Listen for specific events for this user
        this.socket.on(`rerender:${this.userId}`, async () => {
            logger.debug(`Rerender event received for user ${this.userId}`);
            await this.makeAndEmitScreenshot();
        });
        
        // For backward compatibility, also listen to the general event
        this.socket.on('rerender', async () => {
            logger.debug(`General rerender event received, checking if for user ${this.userId}`);
            await this.makeAndEmitScreenshot();
        });
        
        this.socket.on(`settings:${this.userId}`, (settings) => {
            this.interpreterSettings = settings;
            logger.debug(`Settings updated for user ${this.userId}`);
        });
        
        this.socket.on(`changeTab:${this.userId}`, async (tabIndex) => {
            logger.debug(`Tab change to ${tabIndex} requested for user ${this.userId}`);
            await this.changeTab(tabIndex);
        });
        
        this.socket.on(`addTab:${this.userId}`, async () => {
            logger.debug(`New tab requested for user ${this.userId}`);
            await this.currentPage?.context().newPage();
            const lastTabIndex = this.currentPage ? this.currentPage.context().pages().length - 1 : 0;
            await this.changeTab(lastTabIndex);
        });
        
        this.socket.on(`closeTab:${this.userId}`, async (tabInfo) => {
            logger.debug(`Close tab ${tabInfo.index} requested for user ${this.userId}`);
            const page = this.currentPage?.context().pages()[tabInfo.index];
            if (page) {
                if (tabInfo.isCurrent) {
                    if (this.currentPage?.context().pages()[tabInfo.index + 1]) {
                        // next tab
                        await this.changeTab(tabInfo.index + 1);
                    } else {
                        //previous tab
                        await this.changeTab(tabInfo.index - 1);
                    }
                }
                await page.close();
                logger.log(
                    'debug',
                    `Tab ${tabInfo.index} was closed for user ${this.userId}, new tab count: ${this.currentPage?.context().pages().length}`
                );
            } else {
                logger.log('error', `Tab index ${tabInfo.index} out of range for user ${this.userId}`);
            }
        });
        
        this.socket.on(`setViewportSize:${this.userId}`, async (data: { width: number, height: number }) => {
            const { width, height } = data;
            logger.log('debug', `Viewport size change to width=${width}, height=${height} requested for user ${this.userId}`);

            // Update the browser context's viewport dynamically
            if (this.context && this.browser) {
                this.context = await this.browser.newContext({ viewport: { width, height } });
                logger.log('debug', `Viewport size updated to width=${width}, height=${height} for user ${this.userId}`);
            }
        });
        
        // For backward compatibility, also register the standard events
        this.socket.on('settings', (settings) => this.interpreterSettings = settings);
        this.socket.on('changeTab', async (tabIndex) => await this.changeTab(tabIndex));
        this.socket.on('addTab', async () => {
            await this.currentPage?.context().newPage();
            const lastTabIndex = this.currentPage ? this.currentPage.context().pages().length - 1 : 0;
            await this.changeTab(lastTabIndex);
        });
        this.socket.on('closeTab', async (tabInfo) => {
            const page = this.currentPage?.context().pages()[tabInfo.index];
            if (page) {
                if (tabInfo.isCurrent) {
                    if (this.currentPage?.context().pages()[tabInfo.index + 1]) {
                        await this.changeTab(tabInfo.index + 1);
                    } else {
                        await this.changeTab(tabInfo.index - 1);
                    }
                }
                await page.close();
            }
        });
        this.socket.on('setViewportSize', async (data: { width: number, height: number }) => {
            const { width, height } = data;
            if (this.context && this.browser) {
                this.context = await this.browser.newContext({ viewport: { width, height } });
            }
        });

        this.socket.on('extractListData', async (data: { 
            listSelector: string, 
            fields: Record<string, any>,
            currentListId: number, 
            pagination: any 
        }) => {
            if (this.currentPage) {
                const extractedData = await this.extractListData(
                    this.currentPage, 
                    data.listSelector, 
                    data.fields
                );
                
                this.socket.emit('listDataExtracted', {
                    currentListId: data.currentListId,
                    data: extractedData
                });
            }
        });
    };
    /**
     * Subscribes the remote browser for a screencast session
     * on [CDP](https://chromedevtools.github.io/devtools-protocol/) level,
     * where screenshot is being sent through the socket
     * every time the browser's active page updates.
     * @returns {Promise<void>}
     */
    public subscribeToScreencast = async (): Promise<void> => {
        logger.log('debug', `Starting screencast for user: ${this.userId}`);
        await this.startScreencast();
        if (!this.client) {
            logger.log('warn', 'client is not initialized');
            return;
        }
        // Set flag to indicate screencast is active
        this.isScreencastActive = true;

        await this.updateViewportInfo();

        this.client.on('Page.screencastFrame', ({ data: base64, sessionId }) => {
            // Only process if screencast is still active for this user
            if (!this.isScreencastActive) {
                return;
            }
            this.emitScreenshot(Buffer.from(base64, 'base64'))
            setTimeout(async () => {
                try {
                    if (!this.client || !this.isScreencastActive) {
                        logger.log('warn', 'client is not initialized');
                        return;
                    }
                    await this.client.send('Page.screencastFrameAck', { sessionId: sessionId });
                } catch (e: any) {
                    logger.log('error', `Screencast error: ${e}`);
                }
            }, 100);
        });
    };

    /**
     * Subscribe to DOM streaming - simplified version following screenshot pattern
     */
    public async subscribeToDOM(): Promise<void> {
      if (!this.client) {
        logger.warn("DOM streaming requires scraping browser with CDP client");
        return;
      }

      try {
        // Enable required CDP domains
        await this.client.send("DOM.enable");
        await this.client.send("CSS.enable");

        this.isDOMStreamingActive = true;
        logger.info("DOM streaming started successfully");

        // Initial DOM snapshot
        await this.makeAndEmitDOMSnapshot();

        this.setupScrollEventListener();
        this.setupPageChangeListeners();
      } catch (error) {
        logger.error("Failed to start DOM streaming:", error);
        this.isDOMStreamingActive = false;
      }
    }

    /**
     * Wait for network requests to become idle
     * @private
     */
    private async waitForNetworkIdle(timeout: number = 2000): Promise<void> {
      const startTime = Date.now();

      while (this.activeRequests.size > 0 && Date.now() - startTime < timeout) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (this.activeRequests.size > 0) {
        logger.debug(
          `Network idle timeout reached with ${this.activeRequests.size} pending requests`
        );
      }
    }

    /**
     * Stop network monitoring
     * @private
     */
    private async stopNetworkMonitoring(): Promise<void> {
      if (!this.client || !this.isNetworkMonitoringActive) {
        return;
      }

      try {
        await this.client.send("Network.disable");
        this.isNetworkMonitoringActive = false;
        this.networkResourceCache.clear();
        this.activeRequests.clear();
        logger.info("Network monitoring stopped");
      } catch (error) {
        logger.error("Error stopping network monitoring:", error);
      }
    }

    /**
     * CDP-based DOM snapshot creation using captured network resources
     */
    public async makeAndEmitDOMSnapshot(): Promise<void> {
      if (
        !this.currentPage ||
        !this.isDOMStreamingActive
      ) {
        return;
      }

      try {
        // Check if page is still valid and not closed
        if (this.currentPage.isClosed()) {
          logger.debug("Skipping DOM snapshot - page is closed");
          return;
        }

        // Wait for network to become idle
        await this.waitForNetworkIdle();

        // Double-check page state after network wait
        if (this.currentPage.isClosed()) {
          logger.debug("Skipping DOM snapshot - page closed during network wait");
          return;
        }

        // Get current scroll position
        const currentScrollInfo = await this.currentPage.evaluate(() => ({
          x: window.scrollX,
          y: window.scrollY,
          maxX: Math.max(
            0,
            document.documentElement.scrollWidth - window.innerWidth
          ),
          maxY: Math.max(
            0,
            document.documentElement.scrollHeight - window.innerHeight
          ),
          documentHeight: document.documentElement.scrollHeight,
        }));

        logger.info(
          `Creating rrweb snapshot at scroll position: ${currentScrollInfo.y}/${currentScrollInfo.maxY}`
        );

        // Update our tracked scroll position
        this.lastScrollPosition = {
          x: currentScrollInfo.x,
          y: currentScrollInfo.y,
        };

        // Final check before snapshot
        if (this.currentPage.isClosed()) {
          logger.debug("Skipping DOM snapshot - page closed before snapshot");
          return;
        }

        // Capture snapshot using rrweb
        const rawSnapshot = await this.currentPage.evaluate(() => {
          if (typeof window.rrwebSnapshot === "undefined") {
            throw new Error("rrweb-snapshot library not available");
          }
        return window.rrwebSnapshot.snapshot(document, {
          inlineImages: true,
          collectFonts: true,
        });
        });

        // Process the snapshot to proxy resources
        const processedSnapshot = await this.processRRWebSnapshot(rawSnapshot);

        // Add scroll position information
        const enhancedSnapshot = {
          ...processedSnapshot,
          scrollPosition: currentScrollInfo,
          captureTime: Date.now(),
        };

        // Emit the processed snapshot
        this.emitRRWebSnapshot(enhancedSnapshot);
      } catch (error) {
        // Handle navigation context destruction gracefully
        if (error instanceof Error && 
            (error.message.includes("Execution context was destroyed") || 
            error.message.includes("most likely because of a navigation") ||
            error.message.includes("Target closed"))) {
          logger.debug("DOM snapshot skipped due to page navigation or closure");
          return; // Don't emit error for navigation - this is expected
        }

        logger.error("Failed to create rrweb snapshot:", error);
        this.socket.emit("dom-mode-error", {
          userId: this.userId,
          message: "Failed to create rrweb snapshot",
          error: error instanceof Error ? error.message : String(error),
          timestamp: Date.now(),
        });
      }
    }

    /**
     * Emit DOM snapshot to client - following screenshot pattern
     */
    private emitRRWebSnapshot(processedSnapshot: ProcessedSnapshot): void {
      this.socket.emit("domcast", {
        snapshotData: processedSnapshot,
        userId: this.userId,
        timestamp: Date.now(),
      });
    }

    /**
     * Stop DOM streaming - following screencast pattern
     */
    private async stopDOM(): Promise<void> {
      this.isDOMStreamingActive = false;

      if (this.domUpdateInterval) {
        clearInterval(this.domUpdateInterval);
        this.domUpdateInterval = null;
      }

      if (this.client) {
        try {
          await this.client.send("DOM.disable");
          await this.client.send("CSS.disable");
        } catch (error) {
          logger.warn("Error stopping DOM stream:", error);
        }
      }

      logger.info("DOM streaming stopped successfully");
    }

    /**
     * Terminates the screencast session and closes the remote browser.
     * If an interpretation was running it will be stopped.
     * @returns {Promise<void>}
     */
    public async switchOff(): Promise<void> {
        try {
            this.isScreencastActive = false;
            this.isDOMStreamingActive = false;

            await this.interpreter.stopInterpretation();

            if (this.screencastInterval) {
                clearInterval(this.screencastInterval);
            }

            if (this.client) {
                await this.stopScreencast();
                await this.stopDOM();
                await this.stopNetworkMonitoring();
            }

            if (this.browser) {
                await this.browser.close();
            }

            this.screenshotQueue = [];
            //this.performanceMonitor.reset();

        } catch (error) {
            logger.error('Error during browser shutdown:', error);
        }
    }

    private async optimizeScreenshot(screenshot: Buffer): Promise<Buffer> {
        try {
            return await sharp(screenshot)
                .png({
                    quality: Math.round(SCREENCAST_CONFIG.compressionQuality * 100),                
                    compressionLevel: 6,        
                    adaptiveFiltering: true,    
                    force: true                 
                })
                .resize({
                    width: SCREENCAST_CONFIG.maxWidth,
                    height: SCREENCAST_CONFIG.maxHeight,
                    fit: 'inside',
                    withoutEnlargement: true,
                    kernel: 'lanczos3' 
                })
                .toBuffer();
        } catch (error) {
            logger.error('Screenshot optimization failed:', error);            
            return screenshot;
        }
    }
    

    /**
     * Makes and emits a single screenshot to the client side.
     * @returns {Promise<void>}
     */
    public makeAndEmitScreenshot = async (): Promise<void> => {
        try {
            const screenshot = await this.currentPage?.screenshot();
            if (screenshot) {
                this.emitScreenshot(screenshot);
            }
        } catch (e) {
            const { message } = e as Error;
            logger.log('error', `Screenshot error: ${message}`);
        }
    };

    /**
     * Updates the active socket instance.
     * This will update all registered events for the socket and
     * all the properties using the socket.
     * @param socket socket.io socket instance used to communicate with the client side
     * @returns void
     */
    public updateSocket = (socket: Socket): void => {
        this.socket = socket;
        this.registerEditorEvents();
        this.generator?.updateSocket(socket);
        this.interpreter?.updateSocket(socket);
    };

    /**
     * Starts the interpretation of the currently generated workflow.
     * @returns {Promise<void>}
     */
    public interpretCurrentRecording = async (): Promise<void> => {
        logger.log('debug', 'Starting interpretation in the editor');
        if (this.generator) {
            const workflow = this.generator.AddGeneratedFlags(this.generator.getWorkflowFile());
            await this.initializeNewPage();
            if (this.currentPage) {
                // this.currentPage.setViewportSize({ height: 400, width: 900 });
                const params = this.generator.getParams();
                if (params) {
                    this.interpreterSettings.params = params.reduce((acc, param) => {
                        if (this.interpreterSettings.params && Object.keys(this.interpreterSettings.params).includes(param)) {
                            return { ...acc, [param]: this.interpreterSettings.params[param] };
                        } else {
                            return { ...acc, [param]: '', }
                        }
                    }, {})
                }
                logger.log('debug', `Starting interpretation with settings: ${JSON.stringify(this.interpreterSettings, null, 2)}`);
                await this.interpreter.interpretRecordingInEditor(
                    workflow, this.currentPage,
                    (newPage: Page) => this.currentPage = newPage,
                    this.interpreterSettings
                );
                // clear the active index from generator
                this.generator.clearLastIndex();
            } else {
                logger.log('error', 'Could not get a new page, returned undefined');
            }
        } else {
            logger.log('error', 'Generator is not initialized');
        }
    };

    /**
     * Stops the workflow interpretation and initializes a new page.
     * @returns {Promise<void>}
     */
    public stopCurrentInterpretation = async (): Promise<void> => {
        await this.interpreter.stopInterpretation();
        await this.initializeNewPage();
    };

    /**
     * Returns the current page instance.
     * @returns {Page | null | undefined}
     */
    public getCurrentPage = (): Page | null | undefined => {
        return this.currentPage;
    };

    /**
     * Changes the active page to the page instance on the given index
     * available in pages array on the {@link BrowserContext}.
     * Automatically stops the screencast session on the previous page and starts the new one.
     * @param tabIndex index of the page in the pages array on the {@link BrowserContext}
     * @returns {Promise<void>}
     */
    private changeTab = async (tabIndex: number): Promise<void> => {
        const page = this.currentPage?.context().pages()[tabIndex];
        if (page) {
            await this.stopScreencast();
            this.currentPage = page;

            await this.currentPage.addInitScript({ path: './server/src/browser-management/classes/rrweb-bundle.js' });

            await this.setupPageEventListeners(this.currentPage);

            //await this.currentPage.setViewportSize({ height: 400, width: 900 })
            this.client = await this.currentPage.context().newCDPSession(this.currentPage);
           // Include userId in the URL change event
            this.socket.emit('urlChanged', { 
                url: this.currentPage.url(),
                userId: this.userId
            });
            await this.makeAndEmitScreenshot();
            await this.subscribeToScreencast();
        } else {
            logger.log('error', `${tabIndex} index out of range of pages`)
        }
    }

    /**
     * Internal method for a new page initialization. Subscribes this page to the screencast.
     * @param options optional page options to be used when creating a new page
     * @returns {Promise<void>}
     */
    private initializeNewPage = async (options?: Object): Promise<void> => {
        await this.stopScreencast();
        const newPage = options ? await this.browser?.newPage(options)
            : await this.browser?.newPage();
        await newPage?.setExtraHTTPHeaders({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3'
        });

        await this.currentPage?.close();
        this.currentPage = newPage;
        if (this.currentPage) {
            await this.setupPageEventListeners(this.currentPage);

            this.client = await this.currentPage.context().newCDPSession(this.currentPage);
            if (this.renderingMode === "dom") {
              await this.subscribeToDOM();
            } else {
              await this.subscribeToScreencast();
            }
        } else {
            logger.log('error', 'Could not get a new page, returned undefined');
        }
    };

    /**
     * Initiates screencast of the remote browser through socket,
     * registers listener for rerender event and emits the loaded event.
     * Should be called only once after the browser is fully initialized.
     * @returns {Promise<void>}
     */
    private async startScreencast(): Promise<void> {
        if (!this.client) {
            logger.warn('Client is not initialized');
            return;
        }

        try {
            await this.client.send('Page.startScreencast', {
                format: SCREENCAST_CONFIG.format,
                quality: Math.round(SCREENCAST_CONFIG.compressionQuality * 100),
                maxWidth: SCREENCAST_CONFIG.maxWidth,
                maxHeight: SCREENCAST_CONFIG.maxHeight,
                everyNthFrame: 1 
            });
            
            this.isScreencastActive = true;
    
            this.client.on('Page.screencastFrame', async ({ data, sessionId }) => {
                try {
                    if (this.screenshotQueue.length >= SCREENCAST_CONFIG.maxQueueSize && this.isProcessingScreenshot) {
                        await this.client?.send('Page.screencastFrameAck', { sessionId });
                        return;
                    }
                    
                    const buffer = Buffer.from(data, 'base64');
                    this.emitScreenshot(buffer);
                    
                    setTimeout(async () => {
                        try {
                            if (this.client) {
                                await this.client.send('Page.screencastFrameAck', { sessionId });
                            }
                        } catch (e) {
                            logger.error('Error acknowledging screencast frame:', e);
                        }
                    }, 10); 
                } catch (error) {
                    logger.error('Screencast frame processing failed:', error);
                    
                    try {
                        await this.client?.send('Page.screencastFrameAck', { sessionId });
                    } catch (ackError) {
                        logger.error('Failed to acknowledge screencast frame:', ackError);
                    }
                }
            });
            logger.info('Screencast started successfully');
        } catch (error) {
            logger.error('Failed to start screencast:', error);
        }
    }

    private async stopScreencast(): Promise<void> {
        if (!this.client) {
            logger.error('Client is not initialized');
            return;
        }

        try {
            // Set flag to indicate screencast is active
            this.isScreencastActive = false;
            await this.client.send('Page.stopScreencast');
            this.screenshotQueue = [];
            this.isProcessingScreenshot = false;
            logger.info('Screencast stopped successfully');
        } catch (error) {
            logger.error('Failed to stop screencast:', error);
        }
    }


    /**
     * Helper for emitting the screenshot of browser's active page through websocket.
     * @param payload the screenshot binary data
     * @returns void
     */
    private emitScreenshot = async (payload: Buffer, viewportSize?: { width: number, height: number }): Promise<void> => {
        if (this.screenshotQueue.length > SCREENCAST_CONFIG.maxQueueSize) {
          this.screenshotQueue = this.screenshotQueue.slice(-1);
        }
        
        if (this.isProcessingScreenshot) {
            if (this.screenshotQueue.length < SCREENCAST_CONFIG.maxQueueSize) {
                this.screenshotQueue.push(payload);
            }
            return;
        }
        
        this.isProcessingScreenshot = true;
        
        try {
            const optimizationPromise = this.optimizeScreenshot(payload);
            const timeoutPromise = new Promise<Buffer>((resolve) => {
                setTimeout(() => resolve(payload), 100);
            });
            
            const optimizedScreenshot = await Promise.race([optimizationPromise, timeoutPromise]);
            const base64Data = optimizedScreenshot.toString('base64');
            const dataWithMimeType = `data:image/${SCREENCAST_CONFIG.format};base64,${base64Data}`;
            
            payload = null as any;
            
            setImmediate(async () => {
              this.socket.emit('screencast', {
                image: dataWithMimeType,
                userId: this.userId,
                viewport: viewportSize || await this.currentPage?.viewportSize() || null
              });
            });
        } catch (error) {
            logger.error('Screenshot emission failed:', error);
            try {
                const base64Data = payload.toString('base64');
                const dataWithMimeType = `data:image/png;base64,${base64Data}`;
                
                setImmediate(async () => {
                  this.socket.emit('screencast', {
                      image: dataWithMimeType,
                      userId: this.userId,
                      viewport: viewportSize || await this.currentPage?.viewportSize() || null
                  });
                });
            } catch (e) {
                logger.error('Fallback screenshot emission also failed:', e);
            }
        } finally {
            this.isProcessingScreenshot = false;
        
            if (this.screenshotQueue.length > 0) {
              const nextScreenshot = this.screenshotQueue.shift();
              if (nextScreenshot) {
                const delay = this.screenshotQueue.length > 0 ? 16 : 33;
                setTimeout(() => {
                  this.emitScreenshot(nextScreenshot);
                }, delay);
              }
            }
        }
    };

}
