export type KafkaMessageInput = {
  key?: string;
  value: string;
  headers?: Record<string, string>;
};

export interface KafkaProducerLike {
  connect(): Promise<void>;
  send(topic: string, messages: KafkaMessageInput[]): Promise<void>;
  disconnect(): Promise<void>;
}
