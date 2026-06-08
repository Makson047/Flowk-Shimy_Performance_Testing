# k6 run: shimy/shimyFeedLoad.js

- **Timestamp**: 20260504_011937
- **Max VUs**: 10
- **Verdict**: ✅ PASS (2/2 thresholds)

## HTTP
- Total requests: 488
- Avg RPS: 5.05
- Latency p50/p95/p99: 322.55 / 589.02 / 661.57 ms
- Pass / Fail: 438 / 0
- Error breakdown: 4xx=0, 5xx=0, network=0

## Threshold details
- ✅ `http_req_failed`: `rate<0.05`
- ✅ `http_req_duration`: `p(95)<1000`