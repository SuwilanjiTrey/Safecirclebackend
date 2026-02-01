// server.js
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MoneyUnify Configuration
const MONEYUNIFY_AUTH_ID = process.env.MONEYUNIFY_AUTH_ID;
const MONEYUNIFY_API_URL = 'https://api.moneyunify.one';

// Validate environment variables
if (!MONEYUNIFY_AUTH_ID) {
  console.error('⚠️  WARNING: MONEYUNIFY_AUTH_ID is not set in environment variables');
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'SafeCircle Payment API',
    timestamp: new Date().toISOString(),
    moneyunify_configured: !!MONEYUNIFY_AUTH_ID
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'SafeCircle Payment API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      createPayment: '/create-mobile-money-payment',
      verifyPayment: '/verify-mobile-money-payment'
    }
  });
});

/**
 * POST /create-mobile-money-payment
 * Initiates a mobile money payment request
 * ONLY handles payment API - no Firebase updates
 */
app.post('/create-mobile-money-payment', async (req, res) => {
  try {
    const { from_payer, amount } = req.body;

    console.log('📥 Payment request received:', {
      from_payer: from_payer ? `${from_payer.substring(0, 3)}****${from_payer.substring(7)}` : 'N/A',
      amount
    });

    // Validate input
    if (!from_payer || !amount) {
      console.log('❌ Missing required fields');
      return res.status(400).json({
        isError: true,
        message: 'Missing required fields: from_payer or amount'
      });
    }

    // Validate phone number format (should be 10 digits)
    if (!/^\d{10}$/.test(from_payer)) {
      console.log('❌ Invalid phone number format:', from_payer);
      return res.status(400).json({
        isError: true,
        message: 'Invalid phone number format. Must be 10 digits (e.g., 0971234567)'
      });
    }

    // Validate amount
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      console.log('❌ Invalid amount:', amount);
      return res.status(400).json({
        isError: true,
        message: 'Invalid amount. Must be a positive number.'
      });
    }

    // Check if auth_id is configured
    if (!MONEYUNIFY_AUTH_ID) {
      console.log('❌ MONEYUNIFY_AUTH_ID not configured');
      return res.status(500).json({
        isError: true,
        message: 'Payment service not configured. Please contact support.'
      });
    }

    // Prepare form data for MoneyUnify
    const formData = new URLSearchParams();
    formData.append('from_payer', from_payer);
    formData.append('amount', parsedAmount.toString());
    formData.append('auth_id', MONEYUNIFY_AUTH_ID);
    formData.append('webhook_url', ''); // Empty since we're using polling

    console.log('🔄 Calling MoneyUnify API...');

    // Call MoneyUnify API
    const response = await fetch(`${MONEYUNIFY_API_URL}/payments/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: formData.toString()
    });

    const contentType = response.headers.get('content-type');
    let data;

    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      console.error('❌ Non-JSON response from MoneyUnify:', text);
      throw new Error('Invalid response from payment provider');
    }

    if (data.isError || !response.ok) {
      console.error('❌ MoneyUnify error:', data);
      return res.status(400).json({
        isError: true,
        message: data.message || 'Payment initiation failed'
      });
    }

    console.log('✅ Payment initiated successfully:', data.data.transaction_id);

    // Return payment data to app
    res.json({
      isError: false,
      message: data.message,
      data: data.data
    });

  } catch (error) {
    console.error('❌ Create payment error:', error);
    res.status(500).json({
      isError: true,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred'
    });
  }
});

/**
 * POST /verify-mobile-money-payment
 * Verifies the status of a mobile money payment
 * ONLY returns payment status - app handles Firebase updates
 */
app.post('/verify-mobile-money-payment', async (req, res) => {
  try {
    const { transaction_id } = req.body;

    console.log('🔍 Verification request received:', transaction_id);

    if (!transaction_id) {
      console.log('❌ Missing transaction_id');
      return res.status(400).json({
        isError: true,
        message: 'Missing required field: transaction_id'
      });
    }

    // Check if auth_id is configured
    if (!MONEYUNIFY_AUTH_ID) {
      console.log('❌ MONEYUNIFY_AUTH_ID not configured');
      return res.status(500).json({
        isError: true,
        message: 'Payment service not configured. Please contact support.'
      });
    }

    // Prepare form data for MoneyUnify
    const formData = new URLSearchParams();
    formData.append('auth_id', MONEYUNIFY_AUTH_ID);
    formData.append('transaction_id', transaction_id);

    console.log('🔄 Calling MoneyUnify verify API...');

    // Call MoneyUnify verify endpoint
    const response = await fetch(`${MONEYUNIFY_API_URL}/payments/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: formData.toString()
    });

    const contentType = response.headers.get('content-type');
    let data;

    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      console.error('❌ Non-JSON response from MoneyUnify:', text);
      throw new Error('Invalid response from payment provider');
    }

    console.log('✅ Verification result:', {
      transaction_id,
      status: data.data?.status || 'unknown'
    });

    // Return the payment status to app
    res.json({
      isError: false,
      message: data.message,
      data: data.data
    });

  } catch (error) {
    console.error('❌ Verify payment error:', error);
    res.status(500).json({
      isError: true,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred'
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    isError: true,
    message: 'Endpoint not found',
    path: req.path
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('💥 Unhandled error:', err);
  res.status(500).json({
    isError: true,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : 'An error occurred'
  });
});

// Start server
app.listen(PORT, () => {
  console.log('🚀 SafeCircle Payment API Server Started');
  console.log(`📡 Listening on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔐 MoneyUnify configured: ${!!MONEYUNIFY_AUTH_ID ? 'Yes ✅' : 'No ❌'}`);
  console.log(`\n📋 Available endpoints:`);
  console.log(`   GET  /health`);
  console.log(`   GET  /`);
  console.log(`   POST /create-mobile-money-payment`);
  console.log(`   POST /verify-mobile-money-payment`);
  console.log('\n✨ Server is ready to accept requests!\n');
});
