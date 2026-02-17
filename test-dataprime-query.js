#!/usr/bin/env node
/*
 * Test script to verify Data Prime query syntax
 * Makes a test API call to Coralogix
 */

import './js/coralogix/config.js'; // Load config first
import { login } from './js/coralogix/auth.js';
import { executeDataPrimeQuery } from './js/coralogix/api.js';

async function test() {
  try {
    console.log('🔐 Logging in to Coralogix...');
    await login({
      username: 'yoni@coralogix.com',
      password: 'Verint1!',
    });
    console.log('✅ Login successful!\n');

    // Build a simple test query
    const now = new Date();
    const oneHourAgo = new Date(now - 60 * 60 * 1000);

    const query = `source logs
| filter $m.timestamp >= @'${oneHourAgo.toISOString()}' && $m.timestamp <= @'${now.toISOString()}'
| limit 1`;

    console.log('📝 Test Query:');
    console.log('='.repeat(80));
    console.log(query);
    console.log('='.repeat(80));
    console.log('\n🔄 Executing query...\n');

    const result = await executeDataPrimeQuery(query, {
      tier: 'TIER_ARCHIVE',
    });

    console.log('✅ Query executed successfully!');
    console.log('Result:', JSON.stringify(result, null, 2));

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Response:', await error.response.text());
    }
    process.exit(1);
  }
}

test();
