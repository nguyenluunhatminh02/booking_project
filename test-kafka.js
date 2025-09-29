const { Kafka } = require('kafkajs');

async function createConsumerGroup() {
  const kafka = new Kafka({
    clientId: 'setup-client',
    brokers: ['localhost:9094'],
    retry: {
      initialRetryTime: 100,
      retries: 8,
    },
  });

  const consumer = kafka.consumer({ 
    groupId: 'booking-app-consumer',
    sessionTimeout: 30000,
    heartbeatInterval: 3000,
  });

  try {
    console.log('Creating consumer group...');
    await consumer.connect();
    console.log('✅ Consumer connected');

    // Subscribe to at least one topic to create the group
    await consumer.subscribe({ 
      topic: 'dev.booking.events', 
      fromBeginning: false 
    });
    console.log('✅ Subscribed to dev.booking.events');

    // Start consuming briefly to register the group
    const runPromise = consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        console.log(`📨 Test message from ${topic}[${partition}]`);
        // Stop after first message or timeout
        await consumer.stop();
      },
    });

    console.log('✅ Consumer group created and registered');
    
    // Wait a bit then stop
    setTimeout(async () => {
      try {
        await consumer.stop();
        await consumer.disconnect();
        console.log('✅ Consumer group setup completed');
        process.exit(0);
      } catch (error) {
        console.error('Error stopping consumer:', error);
        process.exit(1);
      }
    }, 3000);

  } catch (error) {
    console.error('❌ Error creating consumer group:', error);
    await consumer.disconnect();
    process.exit(1);
  }
}

createConsumerGroup();