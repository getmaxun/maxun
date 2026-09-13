const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const {
  getInterpretationFailureReason,
  hasExpectedRobotOutput,
} = require('../../../server/dist/server/src/utils/output-validation');

describe('getInterpretationFailureReason', () => {
  it('returns the first search or crawl error from interpretation logs', () => {
    const reason = getInterpretationFailureReason(
      [
        'Starting search',
        '  Search execution error: DuckDuckGo returned no result container  ',
        'Search action failed: fallback detail',
      ],
      'Run completed without output'
    );

    assert.equal(reason, 'Search execution error: DuckDuckGo returned no result container');
  });

  it('returns the fallback when logs are missing or do not contain a known marker', () => {
    assert.equal(
      getInterpretationFailureReason('not-an-array', 'Run completed without output'),
      'Run completed without output'
    );

    assert.equal(
      getInterpretationFailureReason(['Run started', 'Run ended'], 'Run completed without output'),
      'Run completed without output'
    );
  });
});

describe('hasExpectedRobotOutput', () => {
  it('accepts default search output when search results exist', () => {
    assert.equal(
      hasExpectedRobotOutput('search', {
        search: {
          'Search Results': {
            results: [{ title: 'Maxun', url: 'https://www.maxun.dev' }],
          },
        },
      }),
      true
    );
  });

  it('rejects search output when requested formats are absent', () => {
    assert.equal(
      hasExpectedRobotOutput(
        'search',
        {
          search: {
            'Search Results': {
              results: [{ title: 'Maxun', url: 'https://www.maxun.dev' }],
            },
          },
        },
        ['markdown']
      ),
      false
    );
  });

  it('accepts search output when a requested serializable format is present', () => {
    assert.equal(
      hasExpectedRobotOutput(
        'search',
        {
          search: {
            'Search Results': {
              results: [{ markdown: '# Maxun', url: 'https://www.maxun.dev' }],
            },
          },
        },
        ['markdown']
      ),
      true
    );
  });

  it('rejects crawl output when every result is an error', () => {
    assert.equal(
      hasExpectedRobotOutput(
        'crawl',
        {
          crawl: {
            'Crawl Results': [{ error: 'Navigation failed' }],
          },
        },
        ['text']
      ),
      false
    );
  });

  it('continues to accept non-search and non-crawl robots', () => {
    assert.equal(hasExpectedRobotOutput('extract', {}), true);
  });
});
