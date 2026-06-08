# k6 run: shimy/shimyFeedLoad.js

- **Timestamp**: 20260511_092246
- **Max VUs**: 200
- **Verdict**: ✅ PASS (3/3 thresholds)

## HTTP
- Total requests: 4260
- Avg RPS: 14.37
- Latency p50/p95/p99: 11046.69 / 13297.43 / 14094.17 ms
- Pass / Fail: 4210 / 0
- Error breakdown: 4xx=0, 5xx=0, network=0

## Threshold details
- ✅ `http_req_failed`: `rate<0.01`
- ✅ `http_req_duration{name:feed}`: `p(95)<800`
- ✅ `http_req_duration{name:feed}`: `p(99)<1500`