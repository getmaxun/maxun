/**
 * Main-content isolation for scraped pages, run on the cheerio DOM before
 * HTML → Markdown conversion.
 *
 * Goal: drop page chrome (menus, share bars, related-story rails, newsletter
 * boxes, comment widgets, ad slots, tracking pixels) without ever dropping the
 * data people scrape for. Listing pages are link-heavy by nature, so nothing
 * here removes content just for being made of links. Removal needs two
 * independent signals:
 *
 *  1. Scope to a content root (article / main / role=main / articleBody) only
 *     when that root clearly holds most of the page's real text.
 *  2. Remove an element only when its class/id names it as chrome AND it is
 *     link-heavy or short, AND it doesn't hold the headline or a large share
 *     of the page's text.
 */
import type { CheerioAPI, Cheerio } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';

/** class/id tokens that name page chrome. Matched as whole words of the class/id. */
const CHROME_HINT = new RegExp(
  '(?:^|[\\s_-])(' +
    [
      'sidebar', 'side-bar', 'sidenav', 'rail', 'right-rail', 'left-rail',
      'share', 'sharing', 'sharebar', 'social', 'socials', 'follow',
      'related', 'recommended', 'recommendations', 'recirc', 'more-stories', 'read-more', 'readmore', 'trending', 'popular', 'most-read', 'mostread',
      'newsletter', 'subscribe', 'subscription', 'signup', 'sign-up', 'optin', 'paywall',
      'promo', 'promoted', 'sponsor', 'sponsored', 'advert', 'advertisement', 'ad', 'ads', 'adslot', 'ad-slot', 'dfp', 'outbrain', 'taboola', 'zergnet',
      'comment', 'comments', 'disqus', 'discussion',
      'cookie', 'cookies', 'consent', 'gdpr',
      'breadcrumb', 'breadcrumbs',
      'masthead', 'navbar', 'nav', 'menu', 'menubar', 'topbar', 'toolbar', 'site-header', 'site-footer', 'footer', 'header-nav',
      'modal', 'popup', 'pop-up', 'overlay', 'lightbox', 'toast', 'banner-ad',
      'widget', 'widgets', 'tags', 'tagcloud', 'author-bio', 'byline-social', 'print', 'skip', 'skiplink', 'skip-link', 'a11y',
    ].join('|') +
    ')(?=$|[\\s_-])',
  'i'
);

/** class/id tokens that name the content itself; never removed on a chrome hint. */
const CONTENT_HINT = /(?:^|[\s_-])(article|post|entry|story|content|main|body|text|product|products|listing|listings|results?|items?|grid|catalog|search-results)(?=$|[\s_-])/i;

const CONTENT_ROOT_SELECTOR = [
  '[itemprop="articleBody"]',
  'article',
  '[role="main"]',
  'main',
  '#main-content', '#maincontent', '#main', '#content',
].join(',');

/** Images that carry no content: tracking pixels, spacers, transparent GIFs. */
const JUNK_IMAGE_SRC = /(?:^|[\/_.-])(spacer|blank|clear|pixel|transparent|1x1|tracking|beacon)(?:[_.-][^/]*)?\.(gif|png)(?:$|\?)/i;

const INLINE_TAGS = new Set(['a', 'span', 'strong', 'b', 'em', 'i', 'u', 'small', 'abbr', 'code', 'sup', 'sub', 'mark', 'time', 'cite', 'q', 'img', 'label']);

const textLen = (s: string) => s.replace(/\s+/g, ' ').trim().length;

interface Measure {
  text: number;
  linkText: number;
}

function measure($: CheerioAPI, el: Cheerio<AnyNode>): Measure {
  const text = textLen(el.text());
  let linkText = 0;
  el.find('a').each((_i, a) => {
    linkText += textLen($(a).text());
  });
  if (el.is('a')) linkText = text;
  return { text, linkText: Math.min(linkText, text) };
}

function hintOf(el: Element): string {
  const attribs = el.attribs || {};
  return `${attribs.class || ''} ${attribs.id || ''} ${attribs['data-component'] || ''} ${attribs['aria-label'] || ''}`.trim();
}

/** Paragraph-like text: the signal articles and listings share and chrome lacks. */
function proseLength($: CheerioAPI, el: Cheerio<AnyNode>): number {
  let total = 0;
  el.find('p, li, td, dd, blockquote, pre, h1, h2, h3').each((_i, node) => {
    const $n = $(node);
    // Count only leaf-ish blocks so nested lists aren't double counted.
    if ($n.find('p, li, td, dd, blockquote, pre').length > 0) return;
    const m = measure($, $n);
    total += Math.max(0, m.text - m.linkText);
  });
  return total;
}

/**
 * If one content root clearly dominates the page, return it. A root qualifies
 * when it holds most of the page's non-link prose and has real paragraphs.
 */
function findDominantRoot($: CheerioAPI, body: Cheerio<AnyNode>): Cheerio<AnyNode> | null {
  const pageProse = proseLength($, body);
  if (pageProse < 400) return null;

  let best: Cheerio<AnyNode> | null = null;
  let bestProse = 0;
  $(CONTENT_ROOT_SELECTOR).each((_i, node) => {
    const $n = $(node);
    const prose = proseLength($, $n);
    // Prefer the smallest root that still holds most of the content: an
    // articleBody inside <main> beats <main> when it carries nearly all of it.
    if (prose >= pageProse * 0.6 && (!best || prose >= bestProse * 0.9)) {
      if (!best || $n.find('*').length < best.find('*').length || prose > bestProse * 1.1) {
        best = $n;
        bestProse = prose;
      }
    }
  });
  if (!best) return null;

  // Multiple sibling <article> elements = a listing (feed, search results);
  // keep the whole page so every item survives.
  let root: Cheerio<AnyNode> = best;
  if (root.is('article') && $('article').length > 3) return null;

  // An articleBody often excludes the story's own header: lead image, caption,
  // standfirst. Widen to the enclosing <article> when that adds little prose.
  if (!root.is('article')) {
    const article = root.parents('article').first();
    if (article.length && $('article').length <= 3 && proseLength($, article) <= bestProse * 1.35) {
      root = article;
    }
  }

  return root;
}

function removeJunkImages($: CheerioAPI) {
  $('img').each((_i, node) => {
    const $img = $(node);
    const src = ($img.attr('src') || '').trim();
    const width = parseInt($img.attr('width') || '', 10);
    const height = parseInt($img.attr('height') || '', 10);
    const tiny = (!Number.isNaN(width) && width <= 3) || (!Number.isNaN(height) && height <= 3);
    if (!src || src.startsWith('data:') || tiny || JUNK_IMAGE_SRC.test(src)) {
      $img.remove();
    }
  });
}

/**
 * Remove elements that name themselves as chrome and look like chrome.
 * Guards keep anything holding the headline or a sizeable part of the text.
 */
function removeHintedChrome($: CheerioAPI, scope: Cheerio<AnyNode>, pageText: number) {
  const candidates: Cheerio<Element>[] = [];
  scope.find('*').each((_i, node) => {
    const el = node as Element;
    if (!el.attribs) return;
    // Inline elements (a.popup, span.share-icon) inside running text are part
    // of the sentence; chrome is always a block container.
    if (INLINE_TAGS.has(el.name)) return;
    const hint = hintOf(el);
    if (!hint || !CHROME_HINT.test(hint) || CONTENT_HINT.test(hint)) return;
    if ($(el).parent().closest('p, li, td, h1, h2, h3, h4, h5, h6, blockquote, figcaption').length) return;
    candidates.push($(el));
  });

  for (const $el of candidates) {
    if (!$el.parent().length) continue; // already removed with an ancestor
    if ($el.is('body, html, main, article, [role="main"], [itemprop="articleBody"]')) continue;
    if ($el.find('h1, [itemprop="articleBody"], article, main').length > 0) continue;

    const m = measure($, $el);
    const nonLink = m.text - m.linkText;
    const linkDensity = m.text ? m.linkText / m.text : 0;

    // Never drop a large share of the page on a class name alone.
    if (nonLink > Math.max(600, pageText * 0.15)) continue;

    const looksLikeChrome = m.text === 0 || linkDensity >= 0.5 || nonLink < 300;
    if (looksLikeChrome) $el.remove();
  }
}

/**
 * Narrows `$('body')` to the page's main content in place. Returns the element
 * whose HTML should be converted (the body, or a dominant content root).
 */
export function isolateMainContent($: CheerioAPI): Cheerio<AnyNode> {
  const body = $('body').length ? $('body') : $.root();
  removeJunkImages($);

  const root = findDominantRoot($, body);
  const scope = root ?? body;
  const pageText = textLen(scope.text());
  removeHintedChrome($, scope, pageText);
  return scope;
}