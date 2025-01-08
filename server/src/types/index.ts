import {BrowserType, LaunchOptions} from "playwright";

/**
 * Interpreter settings properties including recording parameters.
 * @category Types
 */
export interface InterpreterSettings {
    maxConcurrency: number;
    maxRepeats: number;
    debug: boolean;
    params?: any;
}

/**
 * Useful coordinates interface holding the x and y coordinates of a point.
 * @category Types
 */
export interface Coordinates {
    x: number;
    y: number;
}

/**
 * interface to handle date picker events.
 * @category Types
 */
export interface DatePickerEventData {
    coordinates: Coordinates;
    selector: string;
    value: string;
}

/**
 * Holds the deltas of a wheel/scroll event.
 * @category Types
 */
export interface ScrollDeltas {
    deltaX: number;
    deltaY: number;
}

/**
 * Options for the {@link BrowserManagement.launch} method.
 * Wraps the Playwright's launchOptions and adds an extra browser option.
 * The browser option determines which browser to launch as Playwright
 * supports multiple browsers. (chromium, firefox, webkit)
 *  -- Possible expansion for the future of the browser recorder --
 * @category Types
 */
export interface RemoteBrowserOptions {
    browser: BrowserType
    launchOptions: LaunchOptions
};

/**
 * Pairs a pressed key value with the coordinates of the key press.
 * @category Types
 */
export interface KeyboardInput {
    key: string;
    coordinates: Coordinates;
}


/**
 * Contains index in the current workflow and result for over-shadowing check of a pair.
 * @category Types
 */
export type PossibleOverShadow = {
    index: number;
    isOverShadowing: boolean;
}
/**
 * An object representing he coordinates, width, height and corner points of the element.
 * @category Types
 */
export interface Rectangle extends Coordinates {
    width: number;
    height: number;
    top: number;
    right: number;
    bottom: number;
    left: number;
}

/**
 * Helpful enum used for determining the type of action currently executed by the user.
 * @enum {string}
 * @category Types
 */
export enum ActionType {
    AwaitText = 'awaitText',
    Click = 'click',
    DragAndDrop = 'dragAndDrop',
    Screenshot = 'screenshot',
    Hover = 'hover',
    Input = 'input',
    Keydown = 'keydown',
    Load = 'load',
    Navigate = 'navigate',
    Scroll = 'scroll',
}

/**
 * Useful enum for determining the element's tag name.
 * @enum {string}
 * @category Types
 */
export enum TagName {
    A = 'A',
    B = 'B',
    Cite = 'CITE',
    EM = 'EM',
    Input = 'INPUT',
    Select = 'SELECT',
    Span = 'SPAN',
    Strong = 'STRONG',
    TextArea = 'TEXTAREA',
}

/**
 * @category Types
 */
export interface BaseActionInfo {
    tagName: string;
    /**
     * If the element only has text content inside (hint to use text selector)
     */
    hasOnlyText: boolean;
}


interface IframeSelector {
    full: string;
    isIframe: boolean;
}

interface ShadowSelector {
    full: string;
    mode: string;
}

/**
 * Holds all the possible css selectors that has been found for an element.
 * @category Types
 */
export interface Selectors {
    id: string|null;
    generalSelector: string|null;
    attrSelector: string|null;
    testIdSelector: string|null;
    text: string|null;
    href: string|null;
    hrefSelector: string|null;
    accessibilitySelector: string|null;
    formSelector: string|null;
    iframeSelector: IframeSelector|null;
    shadowSelector: ShadowSelector|null;
}

/**
 * Base type for all actions.
 * Action types are used to determine the best selector for the user action.
 * They store valuable information, specific to the action.
 * @category Types
 */
export interface BaseAction extends BaseActionInfo{
    type: ActionType;
    associatedActions: ActionType[];
    inputType: string | undefined;
    value: string | undefined;
    selectors: Selectors;
    timestamp: number;
    isPassword: boolean;
    /**
     * Overrides the {@link BaseActionInfo} type of tagName for the action.
     */
    tagName: TagName;
}

/**
 * Action type for pressing on a keyboard.
 * @category Types
 */
interface KeydownAction extends BaseAction {
    type: ActionType.Keydown;
    key: string;
}

/**
 * Action type for typing into an input field.
 * @category Types
 */
interface InputAction extends BaseAction {
    type: ActionType.Input;
}

/**
 * Action type for clicking on an element.
 * @category Types
 */
interface ClickAction extends BaseAction {
    type: ActionType.Click;
}

/**
 * Action type for drag and dropping an element.
 * @category Types
 */
interface DragAndDropAction extends BaseAction {
    type: ActionType.DragAndDrop;
    sourceX: number;
    sourceY: number;
    targetX: number;
    targetY: number;
}

/**
 * Action type for hovering over an element.
 * @category Types
 */
interface HoverAction extends BaseAction {
    type: ActionType.Hover;
}

/**
 * Action type for waiting on load.
 * @category Types
 */
interface LoadAction extends BaseAction {
    type: ActionType.Load;
    url: string;
}

/**
 * Action type for page navigation.
 * @category Types
 */
interface NavigateAction extends BaseAction {
    type: ActionType.Navigate;
    url: string;
    source: string;
}

/**
 * Action type for scrolling.
 * @category Types
 */
interface WheelAction extends BaseAction {
    type: ActionType.Scroll;
    deltaX: number;
    deltaY: number;
    pageXOffset: number;
    pageYOffset: number;
}

/**
 * Action type for taking a screenshot.
 * @category Types
 */
interface FullScreenshotAction extends BaseAction {
    type: ActionType.Screenshot;
}

/**
 * Action type for waiting on the filling of text input.
 * @category Types
 */
interface AwaitTextAction extends BaseAction {
    type: ActionType.AwaitText;
    text: string;
}

/**
 * Definition of the Action type.
 * @category Types
 */
export type Action =
  | KeydownAction
  | InputAction
  | ClickAction
  | DragAndDropAction
  | HoverAction
  | LoadAction
  | NavigateAction
  | WheelAction
  | FullScreenshotAction
  | AwaitTextAction;
