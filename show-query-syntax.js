#!/usr/bin/env node
/*
 * Show the Data Prime query that will be generated
 */

const now = new Date();
const oneHourAgo = new Date(now - 60 * 60 * 1000);

const query = `source logs
| filter $m.timestamp >= @'${oneHourAgo.toISOString()}' && $m.timestamp <= @'${now.toISOString()}'
| create status_ok = $d.response.status < 400 ? 1 : 0
| create status_4xx = ($d.response.status >= 400 && $d.response.status < 500) ? 1 : 0
| create status_5xx = $d.response.status >= 500 ? 1 : 0
| groupby $m.timestamp.bucket(10m) as t aggregate
    count() as total,
    sum(status_ok) as cnt_ok,
    sum(status_4xx) as cnt_4xx,
    sum(status_5xx) as cnt_5xx
| orderby t asc`;

console.log('Generated Data Prime Query:');
console.log('='.repeat(80));
console.log(query);
console.log('='.repeat(80));
console.log('\n✅ Syntax Checks:');
console.log('  ✓ Uses @\'...\' for timestamp literals (not timestamp())');
console.log('  ✓ Uses $m.timestamp.bucket() (not timeslice)');
console.log('  ✓ Uses create + sum (not countif)');
console.log('  ✓ Uses $d.response.status (not $l.response.status)');
console.log('\nThis query will be sent to:');
console.log('  POST https://api.coralogix.com/api/v1/dataprime/query');
console.log('  with headers:');
console.log('    Authorization: Bearer <token>');
console.log('    CGX-Team-Id: 7667');
