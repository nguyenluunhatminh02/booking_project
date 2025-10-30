import { Kafka, logLevel } from 'kafkajs';
import { topicName } from './topicName';
import { KafkaConfig } from '../../config/app-config.service';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function ensureTopics(config: KafkaConfig) {
  if (!config.brokers.length) {
    console.warn(
      '[Kafka] Skipping topic ensure because no brokers configured.',
    );
    return [];
  }
  const kafka = new Kafka({
    clientId: `${config.clientId || 'booking-api'}-admin`,
    brokers: config.brokers,
    ssl: config.ssl || undefined,
    sasl: config.sasl as any,
    logLevel: logLevel.INFO,
  });
  const admin = kafka.admin();
  await admin.connect();

  try {
    const prefix = config.topicPrefix ?? '';
    const base = config.admin.eventTopics;

    // Ghép prefix 1 lần, tránh double-prefix
    const topics = Array.from(new Set(base.map((t) => topicName(prefix, t))));
    const desiredPartitions = config.admin.numPartitions;
    const replicationFactor = config.admin.replicationFactor;

    // 1) Tạo nếu thiếu
    const existing = new Set(await admin.listTopics());
    const toCreate = topics.filter((t) => !existing.has(t));
    if (toCreate.length) {
      console.log('[Kafka] Creating topics:', toCreate);
      await admin.createTopics({
        topics: toCreate.map((t) => ({
          topic: t,
          numPartitions: desiredPartitions,
          replicationFactor,
        })),
        waitForLeaders: true,
      });
    } else {
      console.log('[Kafka] All topics already exist.');
    }

    // 2) Tăng partitions nếu đang ít hơn desired
    const meta = await admin.fetchTopicMetadata({ topics });
    const toGrow = meta.topics
      .filter((t) => t.partitions.length < desiredPartitions)
      .map((t) => ({ topic: t.name, count: desiredPartitions }));

    if (toGrow.length) {
      await admin.createPartitions({ topicPartitions: toGrow });
      console.log('[Kafka] Partitions increased:', toGrow);
    }

    // 3) Đợi tất cả partitions có leader
    const deadline = Date.now() + 15_000;
    for (;;) {
      const m = await admin.fetchTopicMetadata({ topics });
      const noLeader = m.topics.flatMap((t) =>
        t.partitions
          .filter((p) => p.leader === -1)
          .map((p) => ({ topic: t.name, partition: p.partitionId })),
      );
      if (!noLeader.length) break;
      if (Date.now() > deadline) {
        throw new Error(
          'Some partitions still have no leader: ' + JSON.stringify(noLeader),
        );
      }
      await sleep(500);
    }

    const finalMeta = await admin.fetchTopicMetadata({ topics });
    console.log(
      '[Kafka] Topics ready:',
      finalMeta.topics.map((t) => `${t.name} (p=${t.partitions.length})`),
    );

    return topics;
  } finally {
    await admin.disconnect();
  }
}
