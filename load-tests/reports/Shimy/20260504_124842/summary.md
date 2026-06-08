# k6 run: shimy/shimyFeedLoad.js

- **Timestamp**: 20260504_124842
- **Max VUs**: 1000
- **Verdict**: ✅ PASS (2/2 thresholds)

## HTTP
- Total requests: 9318
- Avg RPS: 24.25
- Latency p50/p95/p99: 32169.65 / 37906.79 / 39573.29 ms
- Pass / Fail: 3910 / 5358
- Error breakdown: 4xx=0, 5xx=5157, network=201

## Threshold details
- ✅ `http_req_failed`: `rate<0.05`
- ✅ `http_req_duration{name:feed}`: `p(95)<1500`