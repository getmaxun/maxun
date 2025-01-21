import { ScrapingConsumer } from '../utils/scraping-consumer';

async function main() {
    const consumer = new ScrapingConsumer();
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('Shutting down consumer...');
        process.exit(0);
    });

    try {
        console.log('Starting scraping consumer...');
        await consumer.start();
        console.log('Consumer is running and waiting for tasks...');
    } catch (error) {
        console.error('Failed to start consumer:', error);
        process.exit(1);
    }
}

main().catch(console.error);