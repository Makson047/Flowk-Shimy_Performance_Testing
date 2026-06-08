# k6 run: shimy/shimyFeedLoad.js

- **Timestamp**: 20260504_122212
- **Max VUs**: 10
- **Verdict**: ✅ PASS (2/2 thresholds)

## HTTP
- Total requests: 482
- Avg RPS: 4.94
- Latency p50/p95/p99: 348.22 / 620.98 / 794.98 ms
- Pass / Fail: 432 / 0
- Error breakdown: 4xx=0, 5xx=0, network=0

## Threshold details
- ✅ `http_req_failed`: `rate<0.05`
- ✅ `http_req_duration`: `p(95)<1000`