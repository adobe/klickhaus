#!/usr/bin/env node

/**
 * Create a GCS bucket for Fastly log ingestion to ClickHouse
 *
 * Usage: node create-bucket.mjs <fastly-service-id>
 *
 * Prerequisites:
 *   - gcloud CLI authenticated with sufficient permissions
 *   - Project: helix-225321
 *
 * Configuration:
 *   - Location: us-east4
 *   - Public access: prevented
 *   - Soft delete: 7 days
 *   - Lifecycle: auto-delete after 7 days
 *   - IAM:
 *     - fastly-logs-for-clickhouse@helix-225321.iam.gserviceaccount.com: Storage Object Creator
 *     - clickhouse-log-ingestion@helix-225321.iam.gserviceaccount.com: Storage Bucket Viewer + Object Viewer
 */

import { execSync } from 'child_process';

const PROJECT = 'helix-225321';
const LOCATION = 'us-east4';
const SOFT_DELETE_DAYS = 7;
const LIFECYCLE_DELETE_DAYS = 7;
const FASTLY_SERVICE_ACCOUNT = 'fastly-logs-for-clickhouse';
const FASTLY_SERVICE_ACCOUNT_FULL = `${FASTLY_SERVICE_ACCOUNT}@${PROJECT}.iam.gserviceaccount.com`;

// Service accounts and their roles
const IAM_BINDINGS = [
  {
    member: `serviceAccount:${FASTLY_SERVICE_ACCOUNT_FULL}`,
    role: 'roles/storage.objectCreator'
  },
  {
    member: `serviceAccount:clickhouse-log-ingestion@${PROJECT}.iam.gserviceaccount.com`,
    role: 'roles/storage.legacyBucketReader'  // "Storage Bucket Viewer (Beta)"
  },
  {
    member: `serviceAccount:clickhouse-log-ingestion@${PROJECT}.iam.gserviceaccount.com`,
    role: 'roles/storage.objectViewer'
  }
];

function run(cmd, options = {}) {
  console.log(`$ ${cmd}`);
  try {
    const result = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], ...options });
    if (result.trim()) console.log(result.trim());
    return result;
  } catch (err) {
    console.error(`Error: ${err.stderr || err.message}`);
    throw err;
  }
}

async function main() {
  const [,, serviceId] = process.argv;

  if (!serviceId) {
    console.error('Usage: node create-bucket.mjs <fastly-service-id>');
    console.error('Example: node create-bucket.mjs 1PluOUd9jqp1prQ8PHd85n');
    process.exit(1);
  }

  const bucketName = `fastly-logs-${serviceId.toLowerCase()}`;
  const bucketUrl = `gs://${bucketName}`;

  console.log(`\n=== Creating bucket: ${bucketName} ===\n`);

  // 1. Create the bucket
  console.log('1. Creating bucket...');
  run(`gcloud storage buckets create ${bucketUrl} \
    --project=${PROJECT} \
    --location=${LOCATION} \
    --uniform-bucket-level-access \
    --public-access-prevention`);

  // 2. Set soft delete policy (7 days = 604800 seconds)
  console.log('\n2. Setting soft delete policy (7 days)...');
  run(`gcloud storage buckets update ${bucketUrl} \
    --soft-delete-duration=${SOFT_DELETE_DAYS}d`);

  // 3. Set lifecycle rule to delete objects after 7 days
  console.log('\n3. Setting lifecycle rule (delete after 7 days)...');
  const lifecycleConfig = {
    rule: [
      {
        action: { type: 'Delete' },
        condition: { age: LIFECYCLE_DELETE_DAYS }
      }
    ]
  };
  const lifecycleJson = JSON.stringify(lifecycleConfig);
  // Write to temp file since gcloud needs a file
  const tempFile = `/tmp/lifecycle-${bucketName}.json`;
  execSync(`cat > ${tempFile} << 'EOF'\n${lifecycleJson}\nEOF`);
  run(`gcloud storage buckets update ${bucketUrl} --lifecycle-file=${tempFile}`);
  execSync(`rm ${tempFile}`);

  // 4. Add IAM bindings
  console.log('\n4. Adding IAM bindings...');
  for (const binding of IAM_BINDINGS) {
    console.log(`   Granting ${binding.role} to ${binding.member.split(':')[1]}...`);
    run(`gcloud storage buckets add-iam-policy-binding ${bucketUrl} \
      --member="${binding.member}" \
      --role="${binding.role}"`);
  }

  // 5. Grant Fastly impersonation on the service account
  console.log('\n5. Granting Fastly impersonation on service account...');
  const fastlyLoggingSA = 'fastly-logging@datalog-bulleit-9e86.iam.gserviceaccount.com';
  run(`gcloud iam service-accounts add-iam-policy-binding ${FASTLY_SERVICE_ACCOUNT_FULL} \
    --member="serviceAccount:${fastlyLoggingSA}" \
    --role="roles/iam.serviceAccountTokenCreator"`);
  console.log(`   Granted serviceAccountTokenCreator to ${fastlyLoggingSA}`);

  // 6. Verify configuration
  console.log('\n=== Bucket created successfully ===\n');
  console.log('Configuration:');
  run(`gcloud storage buckets describe ${bucketUrl} --format="table(name,location,public_access_prevention,soft_delete_policy.retentionDurationSeconds)"`);

  console.log('\nIAM Policy:');
  run(`gcloud storage buckets get-iam-policy ${bucketUrl} --format="table(bindings.role,bindings.members)"`);

  console.log(`\n${'='.repeat(60)}`);
  console.log('NEXT STEPS: Configure Fastly Logging');
  console.log('='.repeat(60));

  console.log(`
1. Open: https://manage.fastly.com/configure/services/${serviceId}

2. Clone to edit → Logging → Create endpoint → Google Cloud Storage
   - Name: GCS-Clickhouse
   - Placement: None
   - Bucket name: ${bucketName}
   - Access method: IAM role
   - Service account name: ${FASTLY_SERVICE_ACCOUNT}
   - Project ID: ${PROJECT}
   - Period: 60
   - Processing region: US

3. VCL → Snippets → Add snippet
   - Name: log 100 - Log to GCS-Clickhouse
   - Placement: within subroutine: log
   - Priority: 100
   - Contents: (paste the VCL below)

4. Leave version comment: gcs/clickhouse logging

5. Activate
`);

  console.log('='.repeat(60));
  console.log('VCL SNIPPET CONTENTS');
  console.log('='.repeat(60));

  const vclSnippet = `if (req.http.X-HIPAA) {
  return (deliver);
}
log {"syslog "} req.service_id {" GCS-Clickhouse :: { "}
  {""timestamp":"} json.escape(time.start.msec) {", "}
  {""applicationName":"fastly", "}
  {""subsystemName":""} req.service_id {"", "}
  {""severity":"} json.escape(if(resp.status<400,"3","")) json.escape(if(resp.status>=400 && resp.status<500,"4","")) json.escape(if(resp.status>=500,"5","")) {", "}
  {""json": {"}
    {""cdn": {"}
      # {""service_id":""} req.service_id {"", "}
      {""version":""} req.vcl.version {"", "}
      {""url":""} if(req.http.Fastly-SSL, "https", "http") "://" json.escape(req.http.host) json.escape(if(req.http.X-Orig-URL, req.http.X-Orig-URL, req.url)) {"", "}
      {""originating_ip":""} json.escape(req.http.X-Originating-IP) {"", "}
      {""time_elapsed_msec":"} json.escape(std.strtof(time.elapsed.msec "." time.elapsed.msec_frac, 10)) {", "}
      {""is_edge":"} if(fastly.ff.visits_this_service == 0, "true", "false") {", "}
      {""datacenter":""} server.datacenter {"", "}
      {""region_code":""} server.region {"", "}
      if(fastly.error, {""fastly_error":""} json.escape(fastly.error) {"", "}, "")
      {""cache_status":""} fastly_info.state {"", "}
      {""cache_ttl":"} obj.ttl {" "}
    {"}, "}
    {""client": {"}
      {""name":""} json.escape(client.as.name) {"", "}
      {""number":"} json.escape(client.as.number) {", "}
      {""city_name":""} json.escape(client.geo.city.ascii) {"", "}
      {""country_name":""} json.escape(client.geo.country_name.ascii) {"", "}
      {""ip":""} json.escape(client.ip) {"" "}
    {"}, "}
    {""helix": {"}
      {""request_type":""} json.escape(req.http.X-Request-Type) {"", "}
      {""backend_type":""} json.escape(req.http.X-Backend-Type) {"", "}
      {""contentbus_prefix":""} json.escape(req.http.X-Contentbus-Prefix) {"" "}
    {"}, "}
    {""request": {"}
      {""method":""} req.method {"", "}
      {""host":""} req.http.host {"", "}
      {""url":""} json.escape(if(req.http.X-Orig-URL, req.http.X-Orig-URL, req.url)) {"", "}
      if(req.url.path ~ "[A-Z]", {""is_mixed_case":true, "}, "")
      {""qs":""} json.escape(if(req.http.X-QS, req.http.X-QS, "")) {"", "}
      {""protocol":""} req.proto {"", "}
      {""backend":""} json.escape(regsuball(req.backend, "^.*--F_", "")) {"", "}
      {""restarts":"} json.escape(req.restarts) {", "}
      {""body_size":"} json.escape(req.body_bytes_read) {", "}
      {""headers": {"}
        if(req.http.Accept-Encoding, {""accept_encoding":""} json.escape(req.http.Accept-Encoding) {"", "}, "")
        if(req.http.Fastly-Orig-Accept-Encoding, {""fastly_orig_accept_encoding":""} json.escape(req.http.Fastly-Orig-Accept-Encoding) {"", "}, "")
        if(req.http.Accept-Language, {""accept_language":""} json.escape(req.http.Accept-Language) {"", "}, "")
        if(req.http.Cache-Control, {""cache_control":""} json.escape(req.http.Cache-Control) {"", "}, "")
        if(req.http.akamai-origin-hop, {""akamai_origin_hop":""} json.escape(req.http.akamai-origin-hop) {"", "}, "")
        if(req.http.CDN-Loop, {""cdn_loop":""} json.escape(req.http.CDN-Loop) {"", "}, "")
        if(req.http.Fastly-FF, {""fastly_ff":""} json.escape(req.http.Fastly-FF) {"", "}, "")
        if(req.http.If-Modified-Since, {""if_modified_since":""} json.escape(req.http.If-Modified-Since) {"", "}, "")
        if(req.http.Origin, {""origin":""} json.escape(req.http.Origin) {"", "}, "")
        if(req.http.Referer, {""referer":""} json.escape(req.http.Referer) {"", "}, "")
        if(req.http.Range, {""range":""} json.escape(req.http.Range) {"", "}, "")
        if(req.http.User-Agent, {""user_agent":""} json.escape(req.http.User-Agent) {"", "}, "")
        if(req.http.Via, {""via":""} json.escape(req.http.Via) {"", "}, "")
        if(req.http.X-Abuse-Info, {""x_abuse_info":""} json.escape(req.http.X-Abuse-Info) {"", "}, "")
        if(req.http.X-Automation, {""x_automation":""} json.escape(req.http.X-Automation) {"", "}, "")
        if(req.http.X-Browser-Validation, {""x_browser_validation":""} json.escape(req.http.X-Browser-Validation) {"", "}, "")
        if(req.http.X-BYO-CDN-Type, {""x_byo_cdn_type":""} json.escape(req.http.X-BYO-CDN-Type) {"", "}, "")
        if(req.http.X-Forwarded-For, {""x_forwarded_for":""} json.escape(req.http.X-Forwarded-For) {"", "}, "")
        if(req.http.X-Push-Invalidation, {""x_push_invalidation":""} json.escape(req.http.X-Push-Invalidation) {"", "}, "")
        {""x_forwarded_host":""} json.escape(req.http.X-Forwarded-Host) {"" "}
      {"} "}
    {"}, "}
    {""response": {"}
      {""status":""} resp.status {"", "}
      {""body_size":"} resp.body_bytes_written {", "}
      {""headers": {"}
        {""cache_control":""} json.escape(resp.http.Cache-Control) {"" "}
        if(resp.http.Content-Encoding, {", "content_encoding":""} json.escape(resp.http.Content-Encoding) {"" "}, "")
        if(resp.http.Content-Length, {", "content_length":""} json.escape(resp.http.Content-Length) {"" "}, "")
        if(resp.http.Content-Range, {", "content-range":""} json.escape(resp.http.Content-Range) {"" "}, "")
        if(resp.http.Content-Type, {", "content_type":""} json.escape(resp.http.Content-Type) {"" "}, "")
        if(resp.http.Last-Modified, {", "last_modified":""} json.escape(resp.http.Last-Modified) {"" "}, "")
        if(resp.http.Location, {", "location":""} json.escape(resp.http.Location) {"" "}, "")
        if(resp.http.Vary, {", "vary":""} json.escape(resp.http.Vary) {"" "}, "")
        if(resp.http.CDN-Cache-Control, {", "cdn_cache_control":""} json.escape(resp.http.CDN-Cache-Control) {"" "}, "")
        if(resp.http.Edge-Control, {", "edge_control":""} json.escape(resp.http.Edge-Control) {"" "}, "")
        if(resp.http.Surrogate-Control, {", "surrogate_control":""} json.escape(resp.http.Surrogate-Control) {"" "}, "")
        if(resp.http.Surrogate-Key, {", "surrogate_key":""} json.escape(resp.http.Surrogate-Key) {"" "}, "")
        if(req.http.X-Surrogate-Key, {", "x_surrogate_key":""} json.escape(req.http.X-Surrogate-Key) {"" "}, "")
        if(resp.http.Cache-Tag, {", "cache_tag":""} json.escape(resp.http.Cache-Tag) {"" "}, "")
        if(resp.http.Edge-Cache-Tag, {", "edge_cache_tag":""} json.escape(resp.http.Edge-Cache-Tag) {"" "}, "")
        if(resp.http.X-Robots-Tag, {", "x_robots_tag":""} json.escape(resp.http.X-Robots-Tag) {"" "}, "")
        if(req.http.X-Warning, {", "x_warning":""} json.escape(req.http.X-Warning) {"" "}, "")
        if(req.http.X-Audit, {", "x_audit":""} json.escape(req.http.X-Audit) {"" "}, "")
        if(resp.http.X-Error, {", "x_error":""} json.escape(resp.http.X-Error) {"" "}, "")
        if(resp.http.X-Rate-Limited-Rate, {", "x_rate_limited_rate":""} json.escape(resp.http.X-Rate-Limited-Rate) {"" "}, "")
      {"} "}
    {"} "}
  {"} "}
"}";`;

  console.log(vclSnippet);

  console.log('\n' + '='.repeat(60));
  console.log('CLICKHOUSE CLICKPIPES SETUP');
  console.log('='.repeat(60));

  console.log(`
6. Open: https://console.clickhouse.cloud/services/98bbc250-de9c-479b-9cfe-1e3c85991839/imports/new/gcs

7. Configure ClickPipes:
   - Name: Fastly GCS ${serviceId}
   - Authentication Method: credentials
   - Access Key: (see README.local.md - GCS HMAC Access Key)
   - Secret Key: (see README.local.md - GCS HMAC Secret Key)
   - GCS file path: https://storage.googleapis.com/${bucketName}/*.log
   - Click "Incoming data" to verify connection

8. After connection is verified:
   - Enable "Continuous ingestion"
   - Click "Parse information"
   - Select "Existing table" → fastly_logs_incoming2
   - Click "Details and settings"
   - Under Permissions, select "Full access"
   - Click "Create ClickPipe"
`);

  console.log('='.repeat(60));
  console.log(`✓ Bucket ${bucketName} is ready for Fastly service ${serviceId}`);
}

main().catch(err => {
  console.error('\nFailed to create bucket:', err.message);
  process.exit(1);
});
