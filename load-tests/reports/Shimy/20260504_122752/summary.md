# k6 run: shimy/shimyFeedLoad.js

- **Timestamp**: 20260504_122752
- **Max VUs**: 200
- **Verdict**: ✅ PASS (3/3 thresholds)

## HTTP
- Total requests: 3600
- Avg RPS: 12.08
- Latency p50/p95/p99: 13609.73 / 15636.97 / 16463.34 ms
- Pass / Fail: 3550 / 0
- Error breakdown: 4xx=0, 5xx=0, network=0

## Threshold details
- ✅ `http_req_duration{name:feed}`: `p(95)<800`
- ✅ `http_req_duration{name:feed}`: `p(99)<1500`
- ✅ `http_req_failed`: `rate<0.01`