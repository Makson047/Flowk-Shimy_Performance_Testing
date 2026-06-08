# k6 run: shimy/shimyFeedLoad.js

- **Timestamp**: 20260511_092827
- **Max VUs**: 1000
- **Verdict**: ✅ PASS (2/2 thresholds)

## HTTP
- Total requests: 10012
- Avg RPS: 26.40
- Latency p50/p95/p99: 32706.14 / 37762.05 / 38702.78 ms
- Pass / Fail: 5001 / 4961
- Error breakdown: 4xx=0, 5xx=4313, network=648

## Threshold details
- ✅ `http_req_duration{name:feed}`: `p(95)<1500`
- ✅ `http_req_failed`: `rate<0.05`