/**
 * AI Extract end to end in a real browser, against local fixture pages and a
 * scripted model: the robot is built from the user's request for the page
 * they entered, other pages are never loaded, and the saved robot runs in
 * maxun-core's interpreter.
 */
import { FixtureSite, launchChromium, lineId, productName, scriptedModel, startFixtureSite } from './helpers';
import assert from 'assert';
import { after, before, describe, it } from 'node:test';
import { Browser, Page } from 'playwright-core';
import Interpreter from 'maxun-core';
import { generateAiExtractWorkflow } from '../../src/sdk/aiExtract/pipeline';
import { PageScopeGuard } from '../../src/sdk/aiExtract/pageScope';

const FAST_REVEAL = { settleMs: 120, maxScrollSteps: 8 };

const SHOES_PROMPT = "Extract the five men's basketball shoes with their names, prices, ratings, and product URLs.";
const SHOES_SPEC = {
  shape: 'list',
  name: "Men's Basketball Shoes",
  fields: [
    { name: 'Name', type: 'text' },
    { name: 'Price', type: 'price' },
    { name: 'Rating', type: 'text' },
    { name: 'Product URL', type: 'url' },
  ],
  limit: 5,
};

let site: FixtureSite;
let browser: Browser | null;

before(async () => {
  site = await startFixtureSite();
  browser = await launchChromium();
});

after(async () => {
  await browser?.close();
  await site?.close();
});

async function withPage<T>(run: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser!.newContext();
  const page = await context.newPage();
  try {
    return await run(page);
  } finally {
    await context.close();
  }
}

/** Runs a generated workflow in maxun-core's interpreter, as a real robot run does. */
async function runRobot(workflow: any[]): Promise<{ scrapeList: Record<string, any[]>; scrapeSchema: Record<string, any[]> }> {
  return withPage(async (page) => {
    let output: any = {};
    const interpreter = new Interpreter({ workflow } as any, {
      maxRepeats: 1,
      maxConcurrency: 1,
      serializableCallback: (data: any) => { output = data; },
      binaryCallback: () => undefined,
    });
    await interpreter.run(page);
    return { scrapeList: output.scrapeList || {}, scrapeSchema: output.scrapeSchema || {} };
  });
}

const otherPagesRequested = (requests: string[], allowed: string[]) => requests.filter((r) => !allowed.includes(r));

describe('AI Extract in a browser', () => {
  it('builds a robot for the requested fields from the specified page only', async (t) => {
    if (!browser) return t.skip('Chromium not available');
    site.requests.length = 0;
    const url = `${site.origin}/shoes`;
    const llm = scriptedModel({
      spec: SHOES_SPEC,
      // A capable model's answer, citing line ids for the first two items.
      extract: (content: string) => ({ items: [
        { Name: { value: 'Air Court Pro', id: lineId(content, 'Air Court Pro') }, Price: { value: '$129.99', id: lineId(content, '$129.99') }, Rating: { value: '4.6 out of 5', id: lineId(content, '4.6 out of 5') }, 'Product URL': { value: `${site.origin}/p/air-court` } },
        { Name: { value: 'Hoop Elite 3', id: lineId(content, 'Hoop Elite 3') }, Price: { value: '$149.00', id: lineId(content, '$149.00') }, Rating: { value: '4.8 out of 5', id: lineId(content, '4.8 out of 5') }, 'Product URL': { value: `${site.origin}/p/hoop-elite` } },
      ] }),
    });

    const result = await withPage((page) => generateAiExtractWorkflow({ page, url, prompt: SHOES_PROMPT, llm, revealOptions: FAST_REVEAL }));
    assert.strictEqual(result.success, true, result.reason);

    // Intent first: the first model call is about the request, before any page structure.
    assert.strictEqual(llm.calls[0].label, 'spec');
    assert.ok(llm.calls[0].user.includes(SHOES_PROMPT));
    assert.ok(llm.calls[1].user.includes(SHOES_PROMPT));

    const steps = result.workflow![0].what;
    assert.deepStrictEqual(steps.filter((s: any) => s.action === 'goto').map((s: any) => s.args[0]), [url]);
    const list = steps.find((s: any) => s.action === 'scrapeList');
    assert.strictEqual(list.name, "Men's Basketball Shoes");
    assert.deepStrictEqual(Object.keys(list.args[0].fields), ['Name', 'Price', 'Rating', 'Product URL']);
    assert.strictEqual(list.args[0].limit, 5);
    assert.deepStrictEqual(list.args[0].pagination, { type: 'none', selector: '' });

    assert.deepStrictEqual(result.aiExtract!.missingFields, []);
    assert.deepStrictEqual(result.aiExtract!.samples[0], {
      Name: 'Air Court Pro', Price: '$129.99', Rating: '4.6 out of 5', 'Product URL': `${site.origin}/p/air-court`,
    });

    // Pagination, product, canonical and sidebar links were never loaded.
    assert.deepStrictEqual(otherPagesRequested(site.requests, ['/shoes']), []);

    // The saved robot runs in maxun-core and returns the five requested shoes.
    site.requests.length = 0;
    const run = await runRobot(result.workflow!);
    const rows = run.scrapeList["Men's Basketball Shoes"];
    assert.strictEqual(rows.length, 5);
    assert.deepStrictEqual(rows.map((r: any) => r.Name), ['Air Court Pro', 'Hoop Elite 3', 'Rim Runner', 'Fast Break Low', 'Slam Dunk Max']);
    assert.strictEqual(rows[4].Price, '$179.95');
    assert.strictEqual(rows[2]['Product URL'], `${site.origin}/p/rim-runner`);
    assert.deepStrictEqual(otherPagesRequested(site.requests, ['/shoes']), []);
  });

  it('extracts what the prompt asks for, not the most prominent list', async (t) => {
    if (!browser) return t.skip('Chromium not available');
    const url = `${site.origin}/shoes`;
    const llm = scriptedModel({
      spec: { shape: 'list', name: 'Store News', fields: [{ name: 'Headline', type: 'text' }], limit: null },
      // A small model's answer: plain values, no ids.
      extract: { items: [{ headline: 'Summer sale starts Friday' }, { headline: 'Free returns all year' }] },
    });
    const result = await withPage((page) => generateAiExtractWorkflow({ page, url, prompt: 'Get the store news headlines from the sidebar', llm, revealOptions: FAST_REVEAL }));
    assert.strictEqual(result.success, true, result.reason);
    const list = result.workflow![0].what.find((s: any) => s.action === 'scrapeList');
    assert.deepStrictEqual(Object.keys(list.args[0].fields), ['Headline']);

    const run = await runRobot(result.workflow!);
    assert.deepStrictEqual(run.scrapeList['Store News'].map((r: any) => r.Headline), [
      'Summer sale starts Friday', 'New store opening downtown', 'Free returns all year',
    ]);
  });

  it('extracts a single value as a schema field', async (t) => {
    if (!browser) return t.skip('Chromium not available');
    const llm = scriptedModel({
      spec: { shape: 'single', name: 'Contact', fields: [{ name: 'Email', type: 'email' }], limit: null },
      extract: { values: { Email: 'help@example.com' } },
    });
    const result = await withPage((page) => generateAiExtractWorkflow({ page, url: `${site.origin}/shoes`, prompt: 'What is the store contact email?', llm, revealOptions: FAST_REVEAL }));
    assert.strictEqual(result.success, true, result.reason);
    const schema = result.workflow![0].what.find((s: any) => s.action === 'scrapeSchema');
    assert.ok(schema.args[0].Email);
    const run = await runRobot(result.workflow!);
    assert.strictEqual(run.scrapeSchema.Contact[0].Email, 'help@example.com');
  });

  it('reports requested fields the page does not have and still returns the rest', async (t) => {
    if (!browser) return t.skip('Chromium not available');
    site.requests.length = 0;
    const llm = scriptedModel({
      spec: { shape: 'list', name: 'Shoes', fields: [{ name: 'Name', type: 'text' }, { name: 'Price', type: 'price' }, { name: 'Color', type: 'text' }], limit: null },
      extract: { items: [{ Name: 'Air Court Pro', Price: '$129.99', Color: null }, { Name: 'Hoop Elite 3', Price: '$149.00', Color: 'Red' }] },
    });
    const result = await withPage((page) => generateAiExtractWorkflow({ page, url: `${site.origin}/shoes`, prompt: 'Extract shoe names, prices and colors', llm, revealOptions: FAST_REVEAL }));
    assert.strictEqual(result.success, true, result.reason);
    assert.deepStrictEqual(result.aiExtract!.missingFields, ['Color']);
    assert.deepStrictEqual(otherPagesRequested(site.requests, ['/shoes']), []);
  });

  it('fails with a clear reason when the data is not on the page, without browsing elsewhere', async (t) => {
    if (!browser) return t.skip('Chromium not available');
    site.requests.length = 0;
    const url = `${site.origin}/shoes`;
    const llm = scriptedModel({
      spec: { shape: 'list', name: 'Opening Hours', fields: [{ name: 'Day', type: 'text' }, { name: 'Hours', type: 'text' }], limit: null },
      // Values a model might invent: none of them are on the page.
      extract: { items: [{ Day: 'Monday', Hours: '9am - 5pm' }] },
    });
    const result = await withPage((page) => generateAiExtractWorkflow({ page, url, prompt: 'Extract the store opening hours for each day', llm, revealOptions: FAST_REVEAL }));
    assert.strictEqual(result.success, false);
    assert.match(result.reason!, /requested data \(Day, Hours\) was not found on .*\/shoes/);
    assert.match(result.reason!, /does not visit other pages/);
    assert.deepStrictEqual(otherPagesRequested(site.requests, ['/shoes']), []);
  });

  it('scrolls, closes overlays and expands sections on the same page', async (t) => {
    if (!browser) return t.skip('Chromium not available');
    site.requests.length = 0;
    const url = `${site.origin}/catalog`;

    // Courses that only render after scrolling.
    const courses = scriptedModel({
      spec: { shape: 'list', name: 'Courses', fields: [{ name: 'Title', type: 'text' }, { name: 'Credits', type: 'text' }], limit: null },
      extract: (content: string) => {
        assert.ok(content.includes('Machine Learning'), 'lazy-loaded courses are shown to the model');
        return { items: [{ Title: 'Intro to Databases', Credits: '4 credits' }, { Title: 'Compilers', Credits: '4 credits' }] };
      },
    });
    const list = await withPage((page) => generateAiExtractWorkflow({ page, url, prompt: 'Extract every course title with its credits', llm: courses, revealOptions: FAST_REVEAL }));
    assert.strictEqual(list.success, true, list.reason);
    const action = list.workflow![0].what.find((s: any) => s.action === 'scrapeList');
    // Items load as the page scrolls, so the robot scrolls too; it never follows links.
    assert.deepStrictEqual(action.args[0].pagination, { type: 'scrollDown', selector: '' });
    assert.strictEqual(list.aiExtract!.samples.length, 5);
    const courseRun = await runRobot(list.workflow!);
    assert.deepStrictEqual(courseRun.scrapeList.Courses.map((r: any) => r.Title), [
      'Intro to Databases', 'Operating Systems', 'Computer Networks', 'Compilers', 'Machine Learning', 'Computer Graphics',
    ]);

    // Content behind an accordion button and a <details> element.
    const details = scriptedModel({
      spec: { shape: 'single', name: 'Program', fields: [{ name: 'Tuition', type: 'price' }, { name: 'Application Deadline', type: 'date' }], limit: null },
      extract: (content: string) => {
        assert.ok(!content.includes('We use cookies'), 'the cookie banner was closed');
        return { values: { Tuition: '$12,400 per year', 'Application Deadline': 'March 15, 2027' } };
      },
    });
    const single = await withPage((page) => generateAiExtractWorkflow({ page, url, prompt: 'Extract the tuition and the application deadline', llm: details, revealOptions: FAST_REVEAL }));
    assert.strictEqual(single.success, true, single.reason);
    assert.deepStrictEqual(single.aiExtract!.samples[0], { Tuition: '$12,400 per year', 'Application Deadline': 'March 15, 2027' });
    assert.deepStrictEqual(otherPagesRequested(site.requests, ['/catalog']), []);
  });

  it('blocks clicks, scripts and popups that would navigate to another URL', async (t) => {
    if (!browser) return t.skip('Chromium not available');
    site.requests.length = 0;
    const url = `${site.origin}/team`;
    const llm = scriptedModel({
      spec: { shape: 'list', name: 'Team', fields: [{ name: 'Name', type: 'text' }, { name: 'Role', type: 'text' }], limit: null },
      extract: { items: [{ Name: 'Ada Lovelace', Role: 'Engineering lead' }, { Name: 'Grace Hopper', Role: 'Compiler engineer' }] },
    });
    const { result, finalUrl } = await withPage(async (page) => {
      const r = await generateAiExtractWorkflow({ page, url, prompt: 'Extract the names and roles of the team members', llm, revealOptions: FAST_REVEAL });
      return { result: r, finalUrl: page.url() };
    });
    assert.strictEqual(result.success, true, result.reason);
    assert.strictEqual(finalUrl, url);
    // The location change was aborted before any request; the pushState route change was undone.
    assert.ok(result.blockedNavigations!.some((u) => u.endsWith('/team/page-2')), JSON.stringify(result.blockedNavigations));
    assert.ok(result.blockedNavigations!.some((u) => u.endsWith('/team/alumni')), JSON.stringify(result.blockedNavigations));
    // Only the team page itself was ever requested (again when undoing the route change).
    assert.deepStrictEqual(otherPagesRequested(site.requests, ['/team']), []);
    assert.deepStrictEqual(result.aiExtract!.samples.map((r) => r.Name), ['Ada Lovelace', 'Grace Hopper', 'Alan Turing']);
  });

  it('aborts a pagination link click on the extraction page', async (t) => {
    if (!browser) return t.skip('Chromium not available');
    site.requests.length = 0;
    const url = `${site.origin}/shoes`;
    await withPage(async (page) => {
      const guard = new PageScopeGuard(page, url);
      await guard.open();
      await page.click('a.next', { noWaitAfter: true });
      await page.waitForTimeout(300);
      assert.strictEqual(page.url(), url);
      assert.strictEqual(await guard.ensureInScope(), true);
      assert.deepStrictEqual(guard.blocked, [`${site.origin}/shoes?page=2`]);
      await guard.dispose();
    });
    assert.deepStrictEqual(otherPagesRequested(site.requests, ['/shoes']), []);
  });

  it('uses the next-page control only when a count beyond the first page is requested', async (t) => {
    if (!browser) return t.skip('Chromium not available');
    const spec = (limit: number | null) => ({
      shape: 'list', name: 'Products', limit,
      fields: [{ name: 'Name', type: 'text' }, { name: 'Price', type: 'price' }, { name: 'ID', type: 'text' }],
    });
    const extract = { items: [{ Name: 'Product 01', Price: '$1.00', ID: 'SKU-1001' }, { Name: 'Product 02', Price: '$2.00', ID: 'SKU-1002' }] };
    const url = `${site.origin}/products`;

    // "Extract 6 products": 4 on the page, so the robot pages on.
    site.requests.length = 0;
    const result = await withPage((page) => generateAiExtractWorkflow({ page, url, prompt: 'Extract 6 products with their name, price and id', llm: scriptedModel({ spec: spec(6), extract }), revealOptions: FAST_REVEAL }));
    assert.strictEqual(result.success, true, result.reason);
    const list = result.workflow![0].what.find((s: any) => s.action === 'scrapeList');
    assert.strictEqual(list.args[0].pagination.type, 'clickNext');
    assert.strictEqual(list.args[0].limit, 6);
    // Creating the robot still read only the first page.
    assert.deepStrictEqual(otherPagesRequested(site.requests, ['/products']), []);

    // The robot reads page 1 and 2, stops at 6 items, and opens nothing else.
    site.requests.length = 0;
    const run = await runRobot(result.workflow!);
    assert.deepStrictEqual(run.scrapeList.Products.map((r: any) => r.Name), [1, 2, 3, 4, 5, 6].map(productName));
    assert.strictEqual(run.scrapeList.Products[5].ID, 'SKU-1006');
    assert.deepStrictEqual(otherPagesRequested(site.requests, ['/products', '/products?page=2']), []);

    // No count, or a count the page already satisfies: no pagination.
    for (const limit of [null, 3]) {
      const r = await withPage((page) => generateAiExtractWorkflow({ page, url, prompt: 'Extract the products with their name, price and id', llm: scriptedModel({ spec: spec(limit), extract }), revealOptions: FAST_REVEAL }));
      assert.strictEqual(r.success, true, r.reason);
      assert.strictEqual(r.workflow![0].what.find((s: any) => s.action === 'scrapeList').args[0].pagination.type, 'none', `limit ${limit}`);
    }

    // A next link to another site is not used.
    const offsite = await withPage((page) => generateAiExtractWorkflow({ page, url: `${site.origin}/offsite-products`, prompt: 'Extract 6 products with their name, price and id', llm: scriptedModel({ spec: spec(6), extract }), revealOptions: FAST_REVEAL }));
    assert.strictEqual(offsite.success, true, offsite.reason);
    assert.strictEqual(offsite.workflow![0].what.find((s: any) => s.action === 'scrapeList').args[0].pagination.type, 'none');
  });

  it('follows a same-site redirect but refuses one to another site', async (t) => {
    if (!browser) return t.skip('Chromium not available');
    const answers = {
      spec: SHOES_SPEC,
      extract: { items: [{ Name: 'Air Court Pro', Price: '$129.99', Rating: '4.6 out of 5' }, { Name: 'Hoop Elite 3', Price: '$149.00', Rating: '4.8 out of 5' }] },
    };
    const moved = await withPage((page) => generateAiExtractWorkflow({ page, url: `${site.origin}/moved`, prompt: SHOES_PROMPT, llm: scriptedModel(answers), revealOptions: FAST_REVEAL }));
    assert.strictEqual(moved.success, true, moved.reason);
    assert.strictEqual(moved.aiExtract!.resolvedUrl, `${site.origin}/shoes`);
    // The robot keeps the address the user entered.
    assert.strictEqual(moved.workflow![0].what[0].args[0], `${site.origin}/moved`);

    const llm = scriptedModel(answers);
    const offsite = await withPage((page) => generateAiExtractWorkflow({ page, url: `${site.origin}/offsite`, prompt: SHOES_PROMPT, llm, revealOptions: FAST_REVEAL }));
    assert.strictEqual(offsite.success, false);
    assert.match(offsite.reason!, /redirected to http:\/\/localhost:\d+\/shoes, which is on a different site/);
    assert.strictEqual(llm.calls.length, 0, 'nothing is extracted from the other site');
  });
});
