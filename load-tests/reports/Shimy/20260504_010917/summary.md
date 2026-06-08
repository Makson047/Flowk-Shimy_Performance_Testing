# k6 run: shimy/shimyChatLoad.js

- **Timestamp**: 20260504_010917
- **Max VUs**: 10
- **Verdict**: ✅ PASS (3/3 thresholds)

## WebSocket
- Sessions OK: 23
- Handshake failures: 0
- Session duration avg/p95/max (ms): 30409.17 / 30418.80 / 30431.00
- Messages received: 1195
- Chat delivery latency p50/p95/p99 (ms): 0.00 / 0.00 / 0.00
- Chat messages sent: n/a

## Threshold details
- ✅ `socket_session_duration`: `avg>2000`
- ✅ `chat_delivery_latency_ms`: `p(95)<2000`
- ✅ `socket_connection_failures`: `count<5`