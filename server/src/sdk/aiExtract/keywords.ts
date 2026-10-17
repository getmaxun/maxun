/**
 * Prompt keyword matching, used to show the model the most relevant part of
 * a long page first.
 */

const PROMPT_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'from', 'by', 'with', 'into', 'onto',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did', 'can', 'could', 'would',
  'should', 'will', 'shall', 'may', 'might', 'must', 'have', 'has', 'had',
  'i', 'me', 'my', 'we', 'us', 'our', 'you', 'your', 'it', 'its', 'they', 'them', 'their', 'there', 'here',
  'this', 'that', 'these', 'those', 'which', 'what', 'who', 'whom', 'whose', 'where', 'when', 'why', 'how',
  'all', 'any', 'each', 'every', 'some', 'many', 'much', 'more', 'other', 'such', 'only', 'just',
  'please', 'want', 'need', 'like', 'also', 'about', 'than', 'then', 'very',
  'extract', 'scrape', 'get', 'give', 'grab', 'fetch', 'pull', 'collect', 'find', 'show', 'list', 'return',
  'tell', 'see', 'make', 'take', 'information', 'info', 'data', 'details', 'detail', 'content',
  'page', 'pages', 'website', 'site', 'web', 'webpage', 'url', 'link', 'given', 'available', 'current',
  'top', 'first', 'last', 'item', 'items', 'entry', 'entries', 'record', 'records', 'result', 'results',
]);

/** Words whose trailing "s" is not a plural ("news" is not "new"). */
const NON_PLURAL_S = new Set(['news', 'series', 'species', 'status', 'bus', 'gas', 'yes', 'this', 'its', 'plus', 'physics', 'mathematics', 'ethics', 'lens', 'canvas', 'atlas', 'bonus', 'campus', 'virus', 'focus', 'census', 'thesis', 'analysis', 'basis', 'axis']);

/** Light suffix stripping so "tags" matches "tag" and "categories" matches "category". */
export function stemWord(word: string): string {
  let w = word.toLowerCase();
  if (NON_PLURAL_S.has(w)) return w;
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(ches|shes|sses|xes|zes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) w = w.slice(0, -1);
  return w;
}

function tokenize(text: string): string[] {
  return (text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}

/** Content-bearing words of the user's request, stemmed and de-duplicated. */
export function promptKeywordStems(prompt: string): string[] {
  const stems = tokenize(prompt)
    .filter((w) => w.length >= 3 && !PROMPT_STOPWORDS.has(w) && !/^\d+$/.test(w))
    .map(stemWord)
    .filter((w) => w.length >= 3 && !PROMPT_STOPWORDS.has(w));
  return Array.from(new Set(stems));
}

/** Number of distinct prompt stems that occur as words in `text`. */
export function countStemMatches(text: string, stems: string[]): number {
  if (!text || stems.length === 0) return 0;
  const words = new Set(tokenize(text).map(stemWord));
  let matches = 0;
  for (const stem of stems) {
    if (words.has(stem)) {
      matches++;
      continue;
    }
    // Compound and derived forms: "pricing" for "price", "runners" for "runner".
    if (stem.length >= 4) {
      for (const w of words) {
        if (w.startsWith(stem) || (w.length >= 4 && stem.startsWith(w))) {
          matches++;
          break;
        }
      }
    }
  }
  return matches;
}
