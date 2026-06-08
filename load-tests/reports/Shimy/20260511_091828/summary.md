# k6 run: shimy/shimyFeedLoad.js

- **Timestamp**: 20260511_091828
- **Max VUs**: 10
- **Verdict**: ✅ PASS (2/2 thresholds)

## HTTP
- Total requests: 522
- Avg RPS: 5.42
- Latency p50/p95/p99: 235.35 / 502.35 / 514.52 ms
- Pass / Fail: 472 / 0
- Error breakdown: 4xx=0, 5xx=0, network=0

## Threshold details
- ✅ `http_req_duration`: `p(95)<1000`
- ✅ `http_req_failed`: `rate<0.05`