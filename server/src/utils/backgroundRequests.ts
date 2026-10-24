/**
 * Requests that never carry page content: analytics beacons, ad auctions,
 * chat-widget long-polls, RUM/error reporting. Page-readiness waits ignore
 * them. Several of these hold a connection open for many seconds (or forever),
 * which used to stall every page on the 8s "pending XHR" deadline.
 *
 * Matching is by host suffix (plus a few path markers for first-party
 * collectors), so a slow first-party API is still waited for.
 */
const BACKGROUND_HOSTS = [
  // analytics / tag managers
  'google-analytics.com', 'analytics.google.com', 'googletagmanager.com', 'stats.g.doubleclick.net',
  'segment.io', 'segment.com', 'mixpanel.com', 'mxpnl.com', 'amplitude.com', 'heap.io', 'heapanalytics.com',
  'hotjar.com', 'hotjar.io', 'clarity.ms', 'fullstory.com', 'mouseflow.com', 'logrocket.io', 'lr-ingest.io',
  'quantserve.com', 'scorecardresearch.com', 'chartbeat.com', 'chartbeat.net', 'parsely.com', 'plausible.io',
  'matomo.cloud', 'cloudflareinsights.com', 'newrelic.com', 'nr-data.net', 'sentry.io', 'browser-intake-datadoghq.com',
  'optimizely.com', 'launchdarkly.com', 'bat.bing.com', 'analytics.tiktok.com', 'tr.snapchat.com',
  'analytics.twitter.com', 'px.ads.linkedin.com', 'snap.licdn.com', 'connect.facebook.net',
  // ads
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'adservice.google.com', 'amazon-adsystem.com',
  'adnxs.com', 'criteo.com', 'criteo.net', 'pubmatic.com', 'rubiconproject.com', 'openx.net', 'casalemedia.com',
  'taboola.com', 'outbrain.com', 'moatads.com', 'adsrvr.org', 'teads.tv',
  // chat / support widgets
  'intercom.io', 'intercomcdn.com', 'drift.com', 'driftt.com', 'crisp.chat', 'tawk.to', 'zopim.com',
  'zdassets.com', 'livechatinc.com', 'hs-analytics.net', 'hubspot.com', 'hsforms.com', 'olark.com', 'tidio.co',
];

/**
 * First-party collector endpoints that are unambiguous (server-side GTM,
 * Cloudflare RUM). Generic words like /events or /track are deliberately not
 * matched: they are often real data APIs.
 */
const BACKGROUND_PATH = /^\/(?:g|j|r)\/collect(?:[/?]|$)|^\/cdn-cgi\/rum(?:[/?]|$)/i;

export function isBackgroundRequest(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  for (const suffix of BACKGROUND_HOSTS) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return true;
  }
  // facebook.com/tr pixel without blocking the rest of facebook.com
  if ((host === 'facebook.com' || host.endsWith('.facebook.com')) && parsed.pathname.startsWith('/tr')) return true;
  return BACKGROUND_PATH.test(parsed.pathname);
}