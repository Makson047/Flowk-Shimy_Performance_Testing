# k6 run: shimy/shimyFeedLoad.js

- **Timestamp**: 20260503_235134
- **Max VUs**: 10
- **Verdict**: ✅ PASS (2/2 thresholds)

## HTTP
- Total requests: 504
- Avg RPS: 5.22
- Latency p50/p95/p99: 284.76 / 508.74 / n/a ms
- Pass / Fail: 454 / 0
- Error breakdown: 4xx=0, 5xx=0, network=0

## Threshold details
- ✅ `http_req_failed`: `rate<0.05`
- ✅ `http_req_duration`: `p(95)<1000`