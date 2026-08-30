# Xquik X (Twitter) search provider

Use Xquik when a Search Robot needs public X post discovery. The provider calls Xquik's structured X (Twitter) search API instead of loading a search page in Playwright.

Xquik returns each post as a Maxun search result with these fields:

- `url`: the public `x.com` post URL
- `title`: the author name and username, when available
- `description`: the post text
- `position`: the result position

## Configure the API key

Add the key to the backend environment:

```env
X_TWITTER_SCRAPER_API_KEY=your_api_key
```

Restart the Maxun backend after changing the environment. Docker Compose passes the root `.env` file to the backend only. The frontend receives an explicit allowlist of non-secret settings.

Maxun reads this key only when it runs an Xquik search. The key is not stored in the robot workflow or sent to the browser.

See [Xquik authentication](https://docs.xquik.com/api-reference/authentication) for API key setup. The [Search Tweets API](https://docs.xquik.com/api-reference/x/search-tweets) defines the published response and cursor contracts.

## Create a robot

In Maxun:

1. Create a Search Robot.
2. Select **Xquik (Public X Posts)** as the search provider.
3. Enter an X search query and choose a time range.
4. Keep **Discover URLs Only** mode selected.
5. Choose between 1 and 10,000 results.

The Xquik provider supports discovery only. It does not navigate to each X post for browser scraping.

## Create a robot through the SDK API

Send the Xquik provider in the existing Search Robot request:

```json
{
  "name": "Open source agent posts",
  "searchConfig": {
    "query": "open source agents",
    "provider": "xquik",
    "mode": "discover",
    "limit": 50,
    "filters": {
      "timeRange": "week"
    }
  }
}
```

Post this body to `POST /api/sdk/search` with the normal Maxun SDK authentication. Maxun rejects Xquik scrape mode, limits above 10,000, and unsupported time ranges before storing the robot. It follows Xquik cursors when a result page is underfilled.
