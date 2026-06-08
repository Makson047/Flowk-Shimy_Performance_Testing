# k6 run: shimy/shimyChatLoad.js

- **Timestamp**: 20260504_010343
- **Max VUs**: 10
- **Verdict**: ✅ PASS (3/3 thresholds)

## WebSocket
- Sessions OK: 23
- Handshake failures: 0
- Session duration avg/p95/max (ms): 30407.83 / 30413.90 / 30419.00
- Messages received: 264
- Chat delivery latency p50/p95/p99 (ms): 146.00 / 195.00 / 215.74
- Chat messages sent: 340

## Threshold details
- ✅ `chat_delivery_latency_ms`: `p(95)<2000`
- ✅ `socket_session_duration`: `avg>2000`
- ✅ `socket_connection_failures`: `count<5`