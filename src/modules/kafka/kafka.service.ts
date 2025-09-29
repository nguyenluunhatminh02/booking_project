import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Consumer, Producer } from 'kafkajs';
import { createKafkaConfig } from './kafka.config';

@Injectable()
export class KafkaService implements OnModuleDestroy {
  private readonly logger = new Logger(KafkaService.name);
  private kafka: Kafka;
  private consumer: Consumer;
  private producer: Producer;

  constructor(private configService: ConfigService) {
    this.kafka = new Kafka(createKafkaConfig(configService));
    this.initializeConsumer();
    this.initializeProducer();
  }

  private initializeConsumer() {
    this.consumer = this.kafka.consumer({
      groupId: this.configService.get('KAFKA_CONSUMER_GROUP')!,
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
      maxWaitTimeInMs: 100,
      retry: {
        initialRetryTime: 100,
        retries: 8,
      },
    });
  }

  private initializeProducer() {
    this.producer = this.kafka.producer({
      retry: {
        initialRetryTime: 100,
        retries: 8,
      },
    });
  }

  async connectConsumer() {
    try {
      await this.consumer.connect();
      this.logger.log('Kafka consumer connected successfully');
      return this.consumer;
    } catch (error) {
      this.logger.error('Failed to connect Kafka consumer:', error);
      throw error;
    }
  }

  async connectProducer() {
    try {
      await this.producer.connect();
      this.logger.log('Kafka producer connected successfully');
      return this.producer;
    } catch (error) {
      this.logger.error('Failed to connect Kafka producer:', error);
      throw error;
    }
  }

  getConsumer(): Consumer {
    return this.consumer;
  }

  getProducer(): Producer {
    return this.producer;
  }

  async onModuleDestroy() {
    try {
      await this.consumer.disconnect();
      await this.producer.disconnect();
      this.logger.log('Kafka connections closed');
    } catch (error) {
      this.logger.error('Error closing Kafka connections:', error);
    }
  }
}
