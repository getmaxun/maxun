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

/** 12 products over 3 pages of 4, each page linking to the next through `nextBase`. */
export const PRODUCT_PAGES = 3;
export const productName = (n: number) => `Product ${String(n).padStart(2, '0')}`;

/**
 * Pagination markup styles: "plain" is a bare "Next" link; the others are
 * common markups the generic detector misses ("Next →", page numbers only,
 * an arrow-only rel=next link).
 */
function pagerHtml(pageNumber: number, nextBase: string, style: string): string {
  const href = (n: number) => `${nextBase}?page=${n}`;
  const hasNext = pageNumber < PRODUCT_PAGES;
  if (style === 'arrow') {
    return `<ul class="pagination"><li class="page-item"><a class="page-link" href="${href(Math.max(1, pageNumber - 1))}">← Previous</a></li>` +
      (hasNext ? `<li class="page-item"><a class="page-link" href="${href(pageNumber + 1)}">Next →</a></li>` : '') + '</ul>';
  }
  if (style === 'numbers') {
    const pages = Array.from({ length: PRODUCT_PAGES }, (_, i) => i + 1)
      .map((n) => (n === pageNumber ? `<span aria-current="page">${n}</span>` : `<a href="${href(n)}">${n}</a>`)).join(' ');
    return `<nav class="pagination" aria-label="Pagination">${pages}</nav>`;
  }
  if (style === 'rel') {
    return `<div class="pager">${hasNext ? `<a rel="next" href="${href(pageNumber + 1)}">»</a>` : ''}</div>`;
  }
  return `<nav class="pagination">${hasNext ? `<a class="next" href="${href(pageNumber + 1)}">Next</a>` : ''}</nav>`;
}

function productsPage(pageNumber: number, nextBase: string, style = 'plain'): string {
  const cards = [1, 2, 3, 4].map((i) => {
    const n = (pageNumber - 1) * 4 + i;
    return `<div class="product"><h3 class="name"><a href="/item/${n}">${productName(n)}</a></h3><span class="price">$${n}.00</span><span class="sku">SKU-${1000 + n}</span></div>`;
  }).join('');
  return `<!doctype html><html><head><title>Products page ${pageNumber}</title></head><body>
<h1>Products</h1><div class="products">${cards}</div>
${pagerHtml(pageNumber, nextBase, style)}
<footer><a href="/about">About us</a></footer></body></html>`;
}

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
    const paged = url.match(/^\/(products|offsite-products|products-arrow|products-numbers|products-rel)(?:\?page=(\d+))?$/);
    if (paged) {
      const style = paged[1].replace(/^(offsite-)?products-?/, '') || 'plain';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(productsPage(Number(paged[2] || 1), paged[1] === 'offsite-products' ? `http://localhost:${port}/products` : `/${paged[1]}`, style));
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
