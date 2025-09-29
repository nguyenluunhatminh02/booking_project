import { Kafka, logLevel } from 'kafkajs';
import { topicName } from './topicName';

function list(name: string, fallback: string[] = []) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
function num(name: string, d: number) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : d;
}
function brokers() {
  return (process.env.KAFKA_BROKERS ?? 'localhost:9094')
    .split(',')
    .map((s) => s.trim());
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function ensureTopics() {
  const kafka = new Kafka({
    clientId: process.env.KAFKA_CLIENT_ID ?? 'booking-admin',
    brokers: brokers(),
    logLevel: logLevel.INFO,
  });
  const admin = kafka.admin();
  await admin.connect();

  try {
    const prefix = process.env.KAFKA_TOPIC_PREFIX ?? '';
    const base = list('EVENT_TOPICS', [
      // defaults nếu thiếu ENV
      'booking.held',
      'booking.expired',
      'booking.cancelled',
      'booking.refunded',
      'booking.paid',
      'booking.confirmed',
    ]);

    // Ghép prefix 1 lần, tránh double-prefix
    const topics = Array.from(new Set(base.map((t) => topicName(prefix, t))));
    const desiredPartitions = num('KAFKA_NUM_PARTITIONS', 3);
    const replicationFactor = num('KAFKA_REPLICATION_FACTOR', 1);

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
