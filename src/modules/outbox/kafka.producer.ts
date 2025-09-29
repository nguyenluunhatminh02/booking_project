import { Kafka, logLevel, Producer, Message } from 'kafkajs';
import { KafkaMessageInput, KafkaProducerLike } from './types';

export class KafkaProducerAdapter implements KafkaProducerLike {
  private kafka: Kafka;
  private producer: Producer;

  constructor(brokersCsv: string, clientId = 'booking-outbox') {
    const brokers = brokersCsv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    this.kafka = new Kafka({ brokers, clientId, logLevel: logLevel.INFO });
    this.producer = this.kafka.producer();
  }

  async connect() {
    await this.producer.connect();
  }

  async send(topic: string, messages: KafkaMessageInput[]) {
    const payload: Message[] = messages.map((m) => ({
      key: m.key ? Buffer.from(m.key) : undefined,
      value: Buffer.from(m.value),
      headers: m.headers as any,
    }));
    await this.producer.send({ topic, messages: payload });
  }

  async disconnect() {
    await this.producer.disconnect();
  }
}
