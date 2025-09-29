import { ConfigService } from '@nestjs/config';

export const createKafkaConfig = (configService: ConfigService) => ({
  clientId: configService.get('KAFKA_CLIENT_ID'),
  brokers: configService.get('KAFKA_BROKERS').split(','),
  ssl: false,
  retry: {
    initialRetryTime: 100,
    retries: 8,
  },
  connectionTimeout: 3000,
  requestTimeout: 30000,
});
