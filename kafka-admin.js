const { Kafka } = require('kafkajs');

const kafka = new Kafka({
  clientId: 'admin-client',
  brokers: ['localhost:9094'],
});

async function listConsumerGroups() {
  const admin = kafka.admin();
  try {
    await admin.connect();
    const groups = await admin.listGroups();
    console.log('Consumer Groups:');
    groups.groups.forEach(group => {
      console.log(`- ${group.groupId} (${group.protocolType})`);
    });
    await admin.disconnect();
  } catch (error) {
    console.error('Error:', error);
    await admin.disconnect();
  }
}

async function deleteConsumerGroup(groupId) {
  const admin = kafka.admin();
  try {
    await admin.connect();
    await admin.deleteGroups([groupId]);
    console.log(`✅ Deleted consumer group: ${groupId}`);
    await admin.disconnect();
  } catch (error) {
    console.error('Error:', error);
    await admin.disconnect();
  }
}

// Command line usage
const command = process.argv[2];
const groupId = process.argv[3];

if (command === 'list') {
  listConsumerGroups();
} else if (command === 'delete' && groupId) {
  deleteConsumerGroup(groupId);
} else {
  console.log('Usage:');
  console.log('  node kafka-admin.js list');
  console.log('  node kafka-admin.js delete <groupId>');
}