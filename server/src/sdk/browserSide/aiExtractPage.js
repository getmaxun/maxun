/**
 * Browser-side half of the AI Extract pipeline.
 *
 *   snapshot()      – the visible page as short lines, each tagged with an id
 *                     (data-mx-aid) the LLM cites as the source of a value.
 *   compileList()   – turns a few grounded example rows into a scrapeList
 *                     config: an item selector plus one selector per field.
 *   compileSchema() – turns grounded single values into scrapeSchema fields
 *                     (CSS selectors, which is what scrapeSchema evaluates).
 *
 * Requires pageAnalyzer.js to be loaded first (field detection and
 * __mxBuildFieldXPath).
 */
(function () {
  const ATTR = 'data-mx-aid';
  const collapse = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const norm = (s) => collapse(s).toLowerCase();

  const SKIP_TAGS = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|PATH|IFRAME|OBJECT|CANVAS|HEAD|META|LINK|BR|HR|INPUT|SELECT|OPTION|TEXTAREA)$/;
  const INLINE_TAGS = new Set(['A', 'ABBR', 'B', 'BDI', 'BDO', 'BIG', 'CITE', 'CODE', 'DATA', 'DFN', 'EM', 'FONT', 'I', 'KBD', 'LABEL', 'MARK', 'Q', 'S', 'SAMP', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'TT', 'U', 'VAR', 'BR']);
  const UTILITY_CLASSES = new Set([
    'flex', 'items-center', 'justify-start', 'justify-center', 'relative', 'w-full',
    'h-full', 'hidden', 'block', 'static', 'absolute', 'fixed', 'overflow-hidden',
    'transition', 'duration-200', 'ease-in-out', 'cursor-pointer', 'select-none',
  ]);

  const MAX_LINES = 4000;
  const MAX_TEXT = 220;

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    // display:contents boxes have no size of their own but render their children.
    if (style.display === 'contents') return true;
    const rect = el.getBoundingClientRect();
    return !(rect.width === 0 && rect.height === 0);
  }

  function hasBlockChildWithText(el) {
    for (const child of el.children) {
      if (!INLINE_TAGS.has(child.tagName) && collapse(child.textContent)) return true;
    }
    return false;
  }

  function directText(el) {
    const parts = [];
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = collapse(node.textContent);
        if (t) parts.push(t);
      }
    }
    return parts.join(' … ');
  }

  function absoluteUrl(value) {
    if (!value) return '';
    try { return new URL(value, document.baseURI).href; } catch (e) { return value; }
  }

  /**
   * One line per element that carries text of its own, plus links and
   * images. An element whose children are all inline (<li><b>Name</b> text)
   * gets its full text, so a value never has to be stitched from two lines.
   */
  function snapshot() {
    document.querySelectorAll(`[${ATTR}]`).forEach((el) => el.removeAttribute(ATTR));
    const lines = [];
    let counter = 0;

    const visit = (el, depth) => {
      if (lines.length >= MAX_LINES) return;
      // SVG tag names are lowercase and plain XPath cannot select them, so skip the whole drawing.
      if (el instanceof SVGElement || SKIP_TAGS.test(el.tagName.toUpperCase()) || !isVisible(el)) return;

      const tag = el.tagName.toLowerCase();
      let text = '';
      let record = false;
      if (tag === 'img') {
        record = !!(el.getAttribute('src') || el.getAttribute('data-src'));
        text = collapse(el.getAttribute('alt') || '');
      } else {
        const own = directText(el);
        if (own) {
          record = true;
          text = hasBlockChildWithText(el) ? own : collapse(el.innerText || el.textContent);
        } else if (tag === 'a' && el.getAttribute('href') && collapse(el.textContent)) {
          record = true;
          text = collapse(el.innerText || el.textContent);
        } else if (el.children.length >= 2 && Array.from(el.children).every((c) => INLINE_TAGS.has(c.tagName))) {
          // Short runs split across inline elements ("<span>$16</span><span>/month</span>")
          // also get one combined line, so the whole value can be quoted.
          const combined = collapse(el.innerText || el.textContent);
          if (combined && combined.length <= 80) {
            record = true;
            text = combined;
          }
        }
      }

      if (record) {
        const id = `n${++counter}`;
        el.setAttribute(ATTR, id);
        const line = { id, tag, depth, text: text.substring(0, MAX_TEXT) };
        if (tag === 'a') line.href = absoluteUrl(el.getAttribute('href'));
        if (tag === 'img') line.src = absoluteUrl(el.getAttribute('src') || el.getAttribute('data-src'));
        lines.push(line);
      }
      for (const child of el.children) visit(child, depth + 1);
    };

    if (document.body) visit(document.body, 0);
    return { title: document.title || '', url: location.href, lines, truncated: lines.length >= MAX_LINES };
  }

  const byAid = (aid) => (aid ? document.querySelector(`[${ATTR}="${CSS.escape(aid)}"]`) : null);

  /** Element whose value a field of `type` should read: the link for urls, the image for images. */
  function resolveFieldElement(el, type) {
    if (!el) return null;
    if (type === 'url') return el.closest('a[href]') || el.querySelector('a[href]') || el;
    if (type === 'image') return el.tagName === 'IMG' ? el : (el.querySelector('img') || el.closest('figure, picture')?.querySelector('img') || el);
    return el;
  }

  /** "Features", "Tags", "Amenities": a field that holds several values. */
  function isPluralName(name) {
    const last = String(name || '').trim().split(/\s+/).pop().toLowerCase();
    return /[a-z]{3,}s$/.test(last) && !/(ss|us|is|news|status)$/.test(last);
  }

  /**
   * A plural field cited at one bullet of a list ("500 searches…" among a
   * plan's features) reads the whole list, so the robot returns every
   * feature, not just the first.
   */
  function widenToList(el, fieldName) {
    if (!el || !isPluralName(fieldName)) return el;
    const li = el.closest('li');
    const list = li && li.parentElement;
    if (!list || !/^(UL|OL)$/.test(list.tagName)) return el;
    const items = Array.from(list.children).filter((c) => c.tagName === 'LI' && collapse(c.textContent));
    return items.length >= 2 ? list : el;
  }

  function attributeFor(el, type) {
    if (type === 'url' && el.tagName === 'A') return 'href';
    if (type === 'image' && el.tagName === 'IMG') return 'src';
    return 'innerText';
  }

  function readValue(el, attribute) {
    if (!el) return null;
    if (attribute === 'href' || attribute === 'src') return absoluteUrl(el.getAttribute(attribute));
    return collapse(el.innerText !== undefined ? el.innerText : el.textContent);
  }

  /** 1 = same value, 0.75 = read value contains the example, 0.5 = the reverse, 0 = unrelated. */
  function matchScore(actual, expected) {
    if (actual == null || expected == null) return 0;
    const a = norm(actual);
    const e = norm(expected);
    if (!a || !e) return 0;
    if (a === e) return 1;
    if (a.includes(e)) return 0.75;
    if (e.includes(a) && a.length >= 2) return 0.5;
    return 0;
  }

  function lowestCommonAncestor(els) {
    let anc = els[0];
    while (anc && !els.every((e) => anc.contains(e))) anc = anc.parentElement;
    return anc;
  }

  const depthOf = (el) => { let d = 0; for (let n = el; n; n = n.parentElement) d++; return d; };

  /**
   * Drops values cited from a neighbouring item (a model copying "Billed
   * yearly" from the card next door). A value sitting closer to another
   * row's values than to its own row's is mis-cited; keeping it would make
   * the row span two items and the item selector far too broad. Items made
   * of siblings (<dt> + <dd>) are unaffected: their values are equally close
   * to every row.
   */
  function dropMisplacedCells(rows) {
    const elsOf = (cells) => Object.values(cells).map((c) => c.el);
    return rows.map((cells, i) => {
      const names = Object.keys(cells);
      if (names.length < 3) return cells;
      const others = rows.filter((_, j) => j !== i).flatMap(elsOf);
      if (others.length === 0) return cells;
      const kept = {};
      for (const name of names) {
        const el = cells[name].el;
        const own = names.filter((n) => n !== name).map((n) => cells[n].el);
        const ownDepth = depthOf(lowestCommonAncestor([el, ...own]));
        const nearestOther = Math.max(...others.map((o) => depthOf(lowestCommonAncestor([el, o]))));
        if (nearestOther > ownDepth) continue;
        kept[name] = cells[name];
      }
      return kept;
    });
  }

  // ---- selector helpers (XPath for lists, CSS for scrapeSchema) ----

  const safeToken = (s) => !!s && !/['"\\]/.test(s) && !/\d{4,}/.test(s) && s.length <= 60;
  const goodClasses = (el) => Array.from(el.classList).filter((c) => safeToken(c) && !UTILITY_CLASSES.has(c));

  function xpathAll(xpath) {
    try {
      const snap = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      const out = [];
      for (let i = 0; i < snap.snapshotLength; i++) out.push(snap.snapshotItem(i));
      return out;
    } catch (e) {
      return null;
    }
  }

  function xpathAnchor(el) {
    const tag = el.tagName.toLowerCase();
    if (el.id && safeToken(el.id)) {
      const x = `//${tag}[@id='${el.id}']`;
      const m = xpathAll(x);
      if (m && m.length === 1 && m[0] === el) return x;
    }
    const classes = goodClasses(el);
    for (let n = 1; n <= Math.min(3, classes.length); n++) {
      const x = `//${tag}[${classes.slice(0, n).map((c) => `contains(@class, '${c}')`).join(' and ')}]`;
      const m = xpathAll(x);
      if (m && m.length === 1 && m[0] === el) return x;
    }
    return null;
  }

  /** Exact XPath for `el`: its own id/classes, else child positions from the nearest anchored ancestor or <body>. */
  function uniqueXPath(el) {
    const own = xpathAnchor(el);
    if (own) return own;
    const steps = [];
    let cur = el;
    let prefix = null;
    for (let depth = 0; cur && depth < 15; depth++) {
      if (cur === document.body) { prefix = '//body'; break; }
      if (cur !== el) {
        const anchor = xpathAnchor(cur);
        if (anchor) { prefix = anchor; break; }
      }
      const parent = cur.parentElement;
      if (!parent) return null;
      let position = 1;
      for (let sib = cur.previousElementSibling; sib; sib = sib.previousElementSibling) {
        if (sib.tagName === cur.tagName) position++;
      }
      steps.unshift(`${cur.tagName.toLowerCase()}[${position}]`);
      cur = parent;
    }
    if (!prefix) return null;
    const path = `${prefix}/${steps.join('/')}`;
    const m = xpathAll(path);
    return m && m.length === 1 && m[0] === el ? path : null;
  }

  function uniqueCss(el) {
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id) && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
      return `#${CSS.escape(el.id)}`;
    }
    const tag = el.tagName.toLowerCase();
    const classes = goodClasses(el);
    for (let n = 1; n <= Math.min(3, classes.length); n++) {
      const sel = `${tag}${classes.slice(0, n).map((c) => `.${CSS.escape(c)}`).join('')}`;
      const m = document.querySelectorAll(sel);
      if (m.length === 1 && m[0] === el) return sel;
    }
    const parts = [];
    let cur = el;
    for (let depth = 0; cur && depth < 20; depth++) {
      if (cur === document.body) { parts.unshift('body'); break; }
      if (cur !== el && cur.id && /^[A-Za-z][\w-]*$/.test(cur.id) && document.querySelectorAll(`#${CSS.escape(cur.id)}`).length === 1) {
        parts.unshift(`#${CSS.escape(cur.id)}`);
        break;
      }
      // An ancestor with distinguishing classes is a steadier anchor than <body>.
      if (cur !== el) {
        const tag = cur.tagName.toLowerCase();
        const classes = goodClasses(cur);
        let anchored = false;
        for (let n = 1; n <= Math.min(3, classes.length) && !anchored; n++) {
          const sel = `${tag}${classes.slice(0, n).map((c) => `.${CSS.escape(c)}`).join('')}`;
          const m = document.querySelectorAll(sel);
          if (m.length === 1 && m[0] === cur) { parts.unshift(sel); anchored = true; }
        }
        if (anchored) break;
      }
      const parent = cur.parentElement;
      if (!parent) break;
      let position = 1;
      for (let sib = cur.previousElementSibling; sib; sib = sib.previousElementSibling) {
        if (sib.tagName === cur.tagName) position++;
      }
      parts.unshift(`${cur.tagName.toLowerCase()}:nth-of-type(${position})`);
      cur = parent;
    }
    const sel = parts.join(' > ');
    try {
      const m = document.querySelectorAll(sel);
      return m.length === 1 && m[0] === el ? sel : null;
    } catch (e) {
      return null;
    }
  }

  // ---- list compilation ----

  /**
   * The element that holds one example row: climb from the row's values
   * while the ancestor contains no other row's values. When a row's values
   * share an ancestor with other rows (<dt> + <dd>, a story row + its score
   * row), the row is anchored on its first value's top-level element and the
   * rest are reached as following siblings.
   */
  const kindOf = (el) => `${el.tagName}.${el.className}`;

  const repeatsAmongSiblings = (el) => !!el.parentElement &&
    Array.from(el.parentElement.children).filter((c) => kindOf(c) === kindOf(el)).length >= 2;

  /**
   * With a single example there are no other rows to bound the climb, so
   * stop at the first element that repeats among its siblings: the card,
   * row or <li> it belongs to. When the example's values sit in different
   * repeated children (<dt> + <dd>, a story row + its score row), anchor on
   * the child holding the first value.
   */
  function nearestRepeatingUnit(els, lowest) {
    const spanned = Array.from(lowest.children).filter((child) => els.some((v) => child.contains(v)));
    // Cells of one row are the same kind (td, td); an item made of siblings
    // mixes kinds (dt + dd, story row + score row).
    const mixedKinds = new Set(spanned.map(kindOf)).size >= 2;
    if (spanned.length >= 2 && mixedKinds && spanned.some(repeatsAmongSiblings)) {
      return spanned.find((child) => child.contains(els[0])) || spanned[0];
    }
    for (let el = lowest; el && el !== document.body; el = el.parentElement) {
      if (repeatsAmongSiblings(el)) return el;
    }
    return lowest;
  }

  function findItemRoots(rowElements) {
    const roots = rowElements.map((els, i) => {
      if (els.length === 0) return null;
      const others = rowElements.filter((_, j) => j !== i).flat();
      const holdsOther = (node) => others.some((o) => node.contains(o));
      let root = lowestCommonAncestor(els);
      if (!root) return null;
      if (holdsOther(root)) {
        let anchor = els[0];
        while (anchor.parentElement && anchor.parentElement !== root) anchor = anchor.parentElement;
        return anchor;
      }
      if (others.length === 0) return nearestRepeatingUnit(els, root);
      while (root.parentElement && root.parentElement !== document.body && !holdsOther(root.parentElement)) {
        root = root.parentElement;
      }
      return root;
    });

    // An example alone in its own section (the one sidebar story among main
    // stories) climbs past its card to the whole section. Re-anchor such
    // roots on the element kind most other examples resolved to.
    const counts = new Map();
    roots.forEach((r) => { if (r) counts.set(kindOf(r), (counts.get(kindOf(r)) || 0) + 1); });
    let majority = null;
    counts.forEach((n, kind) => { if (!majority || n > counts.get(majority)) majority = kind; });
    if (!majority || counts.get(majority) < 2) return roots;
    return roots.map((root, i) => {
      if (!root || kindOf(root) === majority) return root;
      const lowest = lowestCommonAncestor(rowElements[i]);
      for (let el = lowest; el && el !== root.parentElement; el = el.parentElement) {
        if (kindOf(el) === majority) return el;
      }
      const inside = Array.from(root.querySelectorAll('*')).filter((el) => kindOf(el) === majority && rowElements[i].every((v) => el.contains(v)));
      return inside[0] || root;
    });
  }

  /**
   * Widens the examples' container across consecutive wrappers of the same
   * kind (grid rows), which together are one list. Stops at anything with
   * text between them, such as a heading that starts a different list.
   */
  function widenAcrossSameKindWrappers(container) {
    let current = container;
    for (let depth = 0; depth < 4 && current && current.parentElement && current.parentElement !== document.body; depth++) {
      const parent = current.parentElement;
      const siblings = Array.from(parent.childNodes);
      const sameKind = siblings.filter((n) => n.nodeType === 1 && kindOf(n) === kindOf(current));
      if (sameKind.length < 2) break;
      const first = siblings.indexOf(sameKind[0]);
      const last = siblings.indexOf(sameKind[sameKind.length - 1]);
      const interrupted = siblings.slice(first, last + 1).some((n) => !sameKind.includes(n) && collapse(n.textContent));
      if (interrupted) break;
      current = parent;
    }
    return current;
  }

  function listSelectorCandidates(roots) {
    const tag = roots[0].tagName.toLowerCase();
    if (!roots.every((r) => r.tagName === roots[0].tagName)) return [];
    const shared = goodClasses(roots[0]).filter((c) => roots.every((r) => r.classList.contains(c))).slice(0, 3);
    let step = tag + (shared.length ? `[${shared.map((c) => `contains(@class, '${c}')`).join(' and ')}]` : '');
    // Header rows hold <th>, not <td>: keep them out of the item list.
    if (tag === 'tr' && roots.every((r) => r.querySelector('td'))) step = shared.length ? step.replace(/\]$/, ' and td]') : 'tr[td]';

    const candidates = [];
    const examplesContainer = roots.length > 1 ? lowestCommonAncestor(roots) : roots[0].parentElement;
    const container = examplesContainer && widenAcrossSameKindWrappers(examplesContainer);
    if (container && container !== document.documentElement) {
      const containerXPath = uniqueXPath(container);
      if (containerXPath) {
        const direct = roots.every((r) => r.parentElement === container);
        candidates.push(`${containerXPath}${direct ? '/' : '//'}${step}`);
      }
    }
    candidates.push(`//${step}`);

    const seen = new Set();
    return candidates.filter((x) => {
      if (seen.has(x)) return false;
      seen.add(x);
      const matches = xpathAll(x);
      return !!matches && roots.every((r) => matches.includes(r));
    });
  }

  /** Value of `field` for item `index` (1-based), resolved exactly as the scrapeList runtime does. */
  function fieldValueAt(listSelector, field, index) {
    const suffix = field.selector === listSelector ? '' : field.selector.slice(listSelector.length);
    const nodes = xpathAll(`(${listSelector})[${index}]${suffix}`);
    return nodes && nodes[0] ? readValue(nodes[0], field.attribute) : null;
  }

  /**
   * Input: { fields: [{name, type}], rows: [{ <field name>: {aid, value?} }] }
   * Output: ranked candidates, each a full scrapeList config for the fields
   * plus how well it reproduces the examples.
   */
  function compileList(input) {
    const specFields = input.fields || [];
    const rows = (input.rows || []).map((row) => {
      const cells = {};
      for (const f of specFields) {
        const cell = row[f.name];
        const raw = cell && byAid(cell.aid);
        const el = widenToList(resolveFieldElement(raw, f.type), f.name);
        if (!el) continue;
        const attribute = attributeFor(el, f.type);
        const actual = readValue(el, attribute);
        const expected = attribute === 'innerText' && cell.value && norm(actual).includes(norm(cell.value)) ? cell.value : actual;
        cells[f.name] = { el, attribute, expected };
      }
      return cells;
    }).filter((cells) => Object.keys(cells).length > 0);

    if (rows.length === 0) return { candidates: [], error: 'No example values could be located on the page' };

    const cleanRows = dropMisplacedCells(rows);
    const roots = findItemRoots(cleanRows.map((cells) => Object.values(cells).map((c) => c.el)));
    const usable = cleanRows.map((cells, i) => ({ cells, root: roots[i] })).filter((r) => r.root);
    if (usable.length === 0) return { candidates: [], error: 'Could not find the elements that hold each item' };

    const results = [];
    for (const listSelector of listSelectorCandidates(usable.map((r) => r.root))) {
      const items = xpathAll(listSelector) || [];
      const detected = window.getChildSelectors(listSelector, { enhanced: true }) || {};
      const detectedFields = Object.values(detected);
      const indexOf = (root) => items.indexOf(root) + 1;

      const fields = {};
      const unmatched = [];
      const usedSelectors = new Set();
      let total = 0;

      for (const f of specFields) {
        const examples = usable.filter((r) => r.cells[f.name]);
        if (examples.length === 0) { unmatched.push(f.name); continue; }

        const score = (field) => examples.reduce((sum, r) => sum + matchScore(fieldValueAt(listSelector, field, indexOf(r.root)), r.cells[f.name].expected), 0) / examples.length;

        let best = null;
        for (const candidate of detectedFields) {
          // A link field must read href and an image field src; text fields read neither.
          if ((f.type === 'url') !== (candidate.attribute === 'href')) continue;
          if ((f.type === 'image') !== (candidate.attribute === 'src')) continue;
          const s = score(candidate) - (usedSelectors.has(`${candidate.selector}::${candidate.attribute}`) ? 0.3 : 0);
          if (!best || s > best.s) best = { s, field: candidate };
        }

        // No detected field matches: build the path to the cited element directly.
        if (!best || best.s < 0.6) {
          const first = examples[0];
          const others = usable.filter((r) => r !== first).map((r) => r.root);
          const built = window.__mxBuildFieldXPath(first.cells[f.name].el, listSelector, first.root, others);
          if (built && built.primary) {
            const direct = { selector: built.primary, attribute: first.cells[f.name].attribute, tag: first.cells[f.name].el.tagName, isShadow: false };
            const s = score(direct);
            if (!best || s > best.s) best = { s, field: direct };
          }
        }

        if (best && best.s >= 0.6) {
          fields[f.name] = { selector: best.field.selector, attribute: best.field.attribute, tag: best.field.tag, isShadow: !!best.field.isShadow };
          usedSelectors.add(`${best.field.selector}::${best.field.attribute}`);
          total += best.s;
        } else {
          unmatched.push(f.name);
        }
      }

      results.push({
        listSelector,
        fields,
        unmatched,
        itemCount: items.length,
        exampleCount: usable.length,
        score: specFields.length ? total / specFields.length : 0,
      });
    }

    results.sort((a, b) => b.score - a.score || a.itemCount - b.itemCount);
    const examples = usable.map((r) => Object.fromEntries(Object.entries(r.cells).map(([name, c]) => [name, c.expected])));
    return { candidates: results, examples, error: results.length ? null : 'No item selector matched every example' };
  }

  /** Input: { fields: [{name, type}], values: { <field name>: {aid, value?} } } */
  function compileSchema(input) {
    const fields = {};
    const expected = {};
    const unmatched = [];
    for (const f of input.fields || []) {
      const cell = (input.values || {})[f.name];
      const el = widenToList(resolveFieldElement(cell && byAid(cell.aid), f.type), f.name);
      const selector = el && uniqueCss(el);
      if (!selector) { unmatched.push(f.name); continue; }
      const attribute = attributeFor(el, f.type);
      fields[f.name] = { selector, fallbackSelector: null, tag: el.tagName, attribute, isShadow: false };
      const actual = readValue(el, attribute);
      expected[f.name] = attribute === 'innerText' && cell.value && norm(actual).includes(norm(cell.value)) ? cell.value : actual;
    }
    return { fields, expected, unmatched };
  }

  // ---- next-page control ----

  const NEXT_LABEL = /^(next|next page|next results|older|older posts|older entries|more results|weiter|nächste|siguiente|suivant|suivante|próximo|volgende|avanti)$/i;
  const LOAD_MORE_LABEL = /^(load more|show more|view more|see more|more results|load more results)$/i;
  const ARROWS = /[›»→>⟩❯▶▸⇨⟶➔➜➝➞]/g;

  function labelOf(el) {
    return collapse(el.innerText || el.textContent || '') || collapse(el.getAttribute('aria-label') || '') || collapse(el.getAttribute('title') || '');
  }

  function isUsableControl(el) {
    if (!el || !isVisible(el)) return false;
    if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return false;
    if (/\bdisabled\b/i.test(typeof el.className === 'string' ? el.className : '')) return false;
    const li = el.closest('li');
    if (li && /\bdisabled\b/i.test(li.className)) return false;
    return true;
  }

  const inPager = (el) => !!el.closest('nav, .pagination, .pager, [class*="paginat"], [class*="pager"], [aria-label*="paginat" i], [role="navigation"]');

  // Comma-free selectors only: the runtime splits the selector chain on commas.
  const commaFree = (sel) => !!sel && !sel.includes(',');

  /** Selectors that should find the same control on the next page as well. */
  function controlSelectors(el, label) {
    const tag = el.tagName.toLowerCase();
    const out = [];
    const rel = el.getAttribute('rel');
    if (rel && /\bnext\b/i.test(rel)) out.push(`${tag}[rel~="next"]`);
    const aria = el.getAttribute('aria-label');
    if (aria && !/["\\]/.test(aria)) out.push(`${tag}[aria-label="${aria}"]`);
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) out.push(`#${el.id}`);
    const text = collapse(el.innerText || el.textContent || '');
    if (text && text.length <= 40 && !/['"]/.test(text)) out.push(`//${tag}[normalize-space()='${text}']`);
    const classes = goodClasses(el).filter((c) => !/\b(active|current|disabled)\b/i.test(c));
    if (classes.length) out.push(`${tag}.${classes.map((c) => CSS.escape(c)).join('.')}`);
    return out.filter(commaFree);
  }

  /** The selector chain only if its first match is `el` (as the runtime would click). */
  function verifiedChain(el, selectors) {
    const good = selectors.filter((sel) => {
      const m = sel.startsWith('//') ? xpathAll(sel) : (() => { try { return Array.from(document.querySelectorAll(sel)); } catch (e) { return null; } })();
      return !!m && m.length > 0 && m[0] === el;
    });
    return good.length ? good.join(',') : null;
  }

  /**
   * The page's own control for the next page of the list at `listSelector`:
   * a rel=next link, a "Next" / "Load more" control (arrows ignored), or the
   * link after the current page number. Returns { type, selector, how } or
   * { reason } explaining why none was found.
   */
  function findNextPageControl(listSelector) {
    const items = xpathAll(listSelector) || [];
    const insideItem = (el) => items.some((item) => item.contains(el));
    const clickables = Array.from(document.querySelectorAll('a[href], button, [role="button"], input[type="button"], input[type="submit"]'))
      .filter((el) => !insideItem(el) && isUsableControl(el));

    const pick = (candidates, type, how) => {
      // Controls inside a pagination container first.
      candidates.sort((a, b) => Number(inPager(b)) - Number(inPager(a)));
      for (const el of candidates) {
        const selector = verifiedChain(el, controlSelectors(el, labelOf(el)));
        if (selector) return { type, selector, how, label: labelOf(el).slice(0, 40) };
      }
      return null;
    };

    const rel = pick(clickables.filter((el) => /\bnext\b/i.test(el.getAttribute('rel') || '')), 'clickNext', 'rel=next link');
    if (rel) return rel;

    const stripped = (el) => labelOf(el).replace(ARROWS, ' ').replace(/\s+/g, ' ').trim();
    const arrowOnly = (el) => { const l = labelOf(el); return !!l && l.length <= 3 && l.replace(ARROWS, '').trim() === ''; };

    // A "Load more" link with a real address loads the next page like "Next" does.
    const navigates = (el) => el.tagName === 'A' && !/^(#|javascript:)/i.test(el.getAttribute('href') || '');

    const next = pick(clickables.filter((el) =>
      NEXT_LABEL.test(stripped(el)) || (arrowOnly(el) && inPager(el)) || (navigates(el) && LOAD_MORE_LABEL.test(stripped(el)))), 'clickNext', 'next control');
    if (next) return next;

    const more = pick(clickables.filter((el) => !navigates(el) && LOAD_MORE_LABEL.test(stripped(el))), 'clickLoadMore', 'load-more control');
    if (more) return more;

    // Numbered pages: the link right after the current page marker.
    const markers = [
      ['//*[@aria-current=\'page\']', document.querySelector('[aria-current="page"]')],
      ...['active', 'current', 'selected'].map((cls) => [`//*[@class='${cls}']`, document.querySelector(`[class="${cls}"]`)]),
    ];
    for (const [markerXPath, marker] of markers) {
      if (!marker || !inPager(marker) || !/^\d+$/.test(labelOf(marker))) continue;
      const selector = `${markerXPath}/following::a[1]`;
      const link = (xpathAll(selector) || [])[0];
      if (link && isUsableControl(link) && /^\d+$/.test(labelOf(link)) && Number(labelOf(link)) === Number(labelOf(marker)) + 1) {
        return { type: 'clickNext', selector, how: 'link after the current page number', label: labelOf(link) };
      }
    }

    const pagerLabels = clickables.filter(inPager).map(labelOf).filter(Boolean).slice(0, 12);
    return { reason: pagerLabels.length ? `no next control among pagination links: ${pagerLabels.map((l) => JSON.stringify(l)).join(' ')}` : 'no pagination links near the list' };
  }

  window.__mxAiExtract = { snapshot, compileList, compileSchema, matchScore, findNextPageControl };
})();
