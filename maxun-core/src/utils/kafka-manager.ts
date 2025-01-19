import { Kafka, Consumer, Producer } from 'kafkajs';
import { kafkaConfig } from '../config/kafka';
import { EventEmitter } from 'events';

export class KafkaManager extends EventEmitter {
  private kafka: Kafka;
  private producer: Producer;
  private consumer: Consumer;
  private metricsInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.kafka = new Kafka({
      clientId: kafkaConfig.clientId,
      brokers: kafkaConfig.brokers
    });

    this.producer = this.kafka.producer();
    this.consumer = this.kafka.consumer({ 
      groupId: kafkaConfig.consumerGroup,
      sessionTimeout: 30000
    });
  }

  async initialize() {
    await this.producer.connect();
    await this.consumer.connect();
    await this.createTopics();
    this.startMetricsReporting();
  }

  private async createTopics() {
    const admin = this.kafka.admin();
    await admin.createTopics({
      topics: [
        { topic: kafkaConfig.topics.SCRAPING_TASKS, numPartitions: 10 },
        { topic: kafkaConfig.topics.SCRAPING_RESULTS, numPartitions: 10 },
        { topic: kafkaConfig.topics.SCRAPING_DLQ, numPartitions: 1 }
      ]
    });
    await admin.disconnect();
  }

  private startMetricsReporting() {
    this.metricsInterval = setInterval(async () => {
      const admin = this.kafka.admin();
      const metrics = await admin.fetchTopicMetadata({
        topics: [
          kafkaConfig.topics.SCRAPING_TASKS,
          kafkaConfig.topics.SCRAPING_RESULTS
        ]
      });
      
      this.emit('metrics', metrics);
      await admin.disconnect();
    }, 5000);
  }

  async cleanup() {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
    await this.producer.disconnect();
    await this.consumer.disconnect();
  }
}