import { WorkflowFile } from "maxun-core";
import { Locator } from "playwright-core";

export type Workflow = WorkflowFile["workflow"];

export interface ScreenshotSettings {
  animations?: "disabled" | "allow";
  caret?: "hide" | "initial";
  clip?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  fullPage?: boolean;
  mask?: Locator[];
  omitBackground?: boolean;
  // is this still needed? - maxun-core outputs to a binary output
  path?: string;
  quality?: number;
  scale?: "css" | "device";
  timeout?: number;
  type?: "jpeg" | "png";
};

export declare type CustomActions = 'scrape' | 'scrapeSchema' | 'scroll' | 'screenshot' | 'script' | 'enqueueLinks' | 'flag' | 'scrapeList' | 'scrapeListAuto'; 
