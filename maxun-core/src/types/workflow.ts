import { Page } from 'playwright';
import {
  naryOperators, unaryOperators, operators, meta,
} from './logic';

export type Operator = typeof operators[number];
export type UnaryOperator = typeof unaryOperators[number];
export type NAryOperator = typeof naryOperators[number];

export type Meta = typeof meta[number];

export type SelectorArray = string[];

export type RegexableString = string | { '$regex': string };

type BaseConditions = {
  'url': RegexableString,
  'cookies': Record<string, RegexableString>,
  'selectors': SelectorArray, // (CSS/Playwright) selectors use their own logic, there is no reason (and several technical difficulties) to allow regular expression notation
} & Record<Meta, RegexableString>;

export type Where =
  Partial<{ [key in NAryOperator]: Where[] }> & // either a logic operator (arity N)
  Partial<{ [key in UnaryOperator]: Where }> & // or an unary operator
  Partial<BaseConditions>; // or one of the base conditions

type MethodNames<T> = {
  [K in keyof T]: T[K] extends Function ? K : never;
}[keyof T];

export type CustomFunctions = 'scrape' | 'scrapeSchema' | 'scroll' | 'screenshot' | 'script' | 'enqueueLinks' | 'flag' | 'scrapeList' | 'scrapeListAuto';

export type What = {
  action: MethodNames<Page> | CustomFunctions,
  args?: any[]
};

export type PageState = Partial<BaseConditions>;

export type ParamType = Record<string, any>;

export type MetaData = {
  name?: string,
  desc?: string,
};

export interface WhereWhatPair {
  id?: string
  where: Where
  what: What[]
}

export type Workflow = WhereWhatPair[];

export type WorkflowFile = {
  meta?: MetaData,
  workflow: Workflow
};

interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Lax' | 'Strict' | 'None';
}

interface Origin {
  origin: string;
  localStorage: Record<string, any>[];
}

export interface SessionData {
  cookies: Cookie[];
  origins: Origin[];
}

