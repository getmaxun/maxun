/**
 * Shared fixtures for the AI Extract tests: a local site that records every
 * request it receives, a Chromium launcher, and a scripted model that answers
 * the pipeline's prompts deterministically.
 */
import './env';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { AddressInfo } from 'net';
import { chromium, Browser } from 'playwright-core';
import type { JsonCallOptions, JsonLLM } from '../../src/sdk/aiExtract/llmClient';

const FIXTURES = path.join(__dirname, 'fixtures');

export interface FixtureSite {
  /** Base URL on 127.0.0.1. */
  origin: string;
  /** The same server under another hostname, i.e. a different site. */
  otherSiteOrigin: string;
  /** Paths requested so far, e.g. "/shoes" or "/shoes?page=2". */
  requests: string[];
  close: () => Promise<void>;
}

const PAGES: Record<string, string> = {
  '/shoes': 'shoes.html',
  '/catalog': 'dynamic.html',
  '/team': 'traps.html',
};

export async function startFixtureSite(): Promise<FixtureSite> {
  const requests: string[] = [];
  let port = 0;
  const server = http.createServer((req, res) => {
    const url = req.url || '/';
    if (url === '/favicon.ico') {
      res.writeHead(404).end();
      return;
    }
    requests.push(url);
    if (url === '/moved') {
      res.writeHead(302, { Location: '/shoes' }).end();
      return;
    }
    if (url === '/offsite') {
      res.writeHead(302, { Location: `http://localhost:${port}/shoes` }).end();
      return;
    }
    const file = PAGES[url];
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    // Any other path is "another page": it exists, so following a link to it
    // would succeed and show up in `requests`.
    res.end(file ? fs.readFileSync(path.join(FIXTURES, file)) : `<html><body><h1>Other page ${url}</h1></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  return {
    origin: `http://127.0.0.1:${port}`,
    otherSiteOrigin: `http://localhost:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** Chromium from CHROMIUM_PATH, the sandbox's pre-installed browser, or Playwright's own download. */
export async function launchChromium(): Promise<Browser | null> {
  const candidates = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium'].filter(Boolean) as string[];
  const executablePath = candidates.find((p) => fs.existsSync(p));
  try {
    return await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  } catch (error: any) {
    console.warn(`Skipping browser tests: could not launch Chromium (${error?.message?.split('\n')[0]})`);
    return null;
  }
}

export interface ScriptedAnswers {
  spec: any;
  /** The extraction answer, or a function of the page content the model was shown. */
  extract: any | ((pageContent: string) => any);
}

export interface ScriptedModel extends JsonLLM {
  calls: JsonCallOptions[];
}

/** A model that answers the spec and extraction prompts from a script, recording what it was asked. */
export function scriptedModel(answers: ScriptedAnswers): ScriptedModel {
  const calls: JsonCallOptions[] = [];
  const model = (async (opts: JsonCallOptions) => {
    calls.push(opts);
    if (opts.label === 'spec') return { json: answers.spec, provider: 'scripted' };
    if (opts.label === 'extract') {
      const json = typeof answers.extract === 'function' ? answers.extract(opts.user) : answers.extract;
      return { json, provider: 'scripted' };
    }
    throw new Error(`Unexpected model call: ${opts.label}`);
  }) as ScriptedModel;
  model.calls = calls;
  return model;
}

/** The id of the snapshot line whose text is exactly `text`, as a model citing ids would answer. */
export function lineId(pageContent: string, text: string): string {
  for (const line of pageContent.split('\n')) {
    const m = line.match(/^\s*(n\d+) [a-z0-9]+ \| (.*?)(?: -> .*)?$/);
    if (m && m[2] === text) return m[1];
  }
  throw new Error(`No snapshot line reads "${text}"`);
}
