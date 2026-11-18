type Google = typeof import('googleapis').google;

let instance: Google | undefined;

/**
 * googleapis takes ~0.5s and ~45MB of heap to load, and only the Google Sheets
 * integration needs it, so load it on first use instead of at server start.
 */
export function getGoogle(): Google {
  if (!instance) {
    instance = require('googleapis').google as Google;
  }
  return instance;
}
