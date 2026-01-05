// Test script to verify Figma CORS works with DigitalOcean endpoint
// You can run this code directly in your Figma Make app

const testEndpoint = async () => {
  try {
    console.log('Testing DigitalOcean endpoint from Figma...');
    
    const response = await fetch('https://catalyst-copilot-2nndy.ondigitalocean.app/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: 'What is the institutional ownership for AAPL?',
        selectedTickers: ['AAPL']
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('✅ Success! Response:', data);
    return data;
    
  } catch (error) {
    console.error('❌ Error:', error);
    
    // Check if it's a CORS error
    if (error.message.includes('CORS') || error.message.includes('NetworkError')) {
      console.error('This is a CORS error - the deployment might not be complete yet');
    }
    
    throw error;
  }
};

// Run the test
testEndpoint();
