// src/modules/outbox/types.ts
export type KafkaMessage = {
  key?: string | null;
  value: string;
  headers?: Record<string, string | Buffer>;
};

export interface KafkaProducerLike {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(topic: string, messages: KafkaMessage[]): Promise<void>;
}
