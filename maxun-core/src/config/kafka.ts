export const kafkaConfig = {
    clientId: 'maxun-scraper',
    brokers: ['localhost:29092'],
    topics: {
      SCRAPING_TASKS: 'scraping-tasks',
      SCRAPING_RESULTS: 'scraping-results',
      SCRAPING_DLQ: 'scraping-dlq'
    },
    consumerGroup: 'scraping-group'
};