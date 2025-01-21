import { KafkaManager } from '../utils/kafka-manager';

async function setupKafka() {
    const manager = new KafkaManager();
    
    try {
        console.log('Initializing Kafka manager...');
        await manager.initialize();
        console.log('Kafka setup completed successfully');
        
        // Keep monitoring for a while to verify setup
        setTimeout(async () => {
            await manager.cleanup();
            process.exit(0);
        }, 10000);
        
    } catch (error) {
        console.error('Failed to setup Kafka:', error);
        process.exit(1);
    }
}

setupKafka().catch(console.error);