/**
 * WebSocket Test Script
 * Tests the WebSocket chat endpoint
 */

const WebSocket = require('ws');

const WS_URL = 'ws://localhost:3000/ws/chat';

console.log('🔌 Connecting to WebSocket server...');
console.log('URL:', WS_URL);

const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log('✅ Connected to WebSocket server');
  
  // Send a test message
  const testMessage = {
    type: 'chat',
    message: 'Hello, this is a test message',
    conversationHistory: [],
    selectedTickers: [],
    timezone: 'America/New_York'
  };
  
  console.log('\n📤 Sending test message:', testMessage.message);
  ws.send(JSON.stringify(testMessage));
});

ws.on('message', (data) => {
  try {
    const message = JSON.parse(data.toString());
    console.log('\n📥 Received:', message.type);
    
    if (message.type === 'content') {
      process.stdout.write(message.content);
    } else if (message.type === 'thinking') {
      console.log('💭', message.content);
    } else if (message.type === 'done') {
      console.log('\n\n✅ Response complete');
      ws.close();
    } else if (message.type === 'error') {
      console.error('\n❌ Error:', message.error);
      ws.close();
    } else {
      console.log('   Data:', JSON.stringify(message).substring(0, 100));
    }
  } catch (error) {
    console.error('Failed to parse message:', error);
  }
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error.message);
});

ws.on('close', () => {
  console.log('\n🔌 Disconnected from WebSocket server');
  process.exit(0);
});

// Timeout after 30 seconds
setTimeout(() => {
  console.log('\n⏱️  Test timeout - closing connection');
  ws.close();
}, 30000);
