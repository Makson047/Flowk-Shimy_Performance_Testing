# k6 run: shimy/shimyChatLoad.js

- **Timestamp**: 20260511_093540
- **Max VUs**: 50
- **Verdict**: ✅ PASS (3/3 thresholds)

## WebSocket
- Sessions OK: 50
- Handshake failures: 0
- Session duration avg/p95/max (ms): 300410.48 / 300429.65 / 300438.00
- Messages received: 13196
- Chat delivery latency p50/p95/p99 (ms): 143.00 / 166.00 / 195.00
- Chat messages sent: 13298

## Threshold details
- ✅ `socket_connection_failures`: `count<5`
- ✅ `socket_session_duration`: `avg>2000`
- ✅ `chat_delivery_latency_ms`: `p(95)<2000`