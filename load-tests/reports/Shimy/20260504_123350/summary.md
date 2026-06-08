# k6 run: shimy/shimyChatLoad.js

- **Timestamp**: 20260504_123350
- **Max VUs**: 50
- **Verdict**: ✅ PASS (3/3 thresholds)

## WebSocket
- Sessions OK: 68
- Handshake failures: 0
- Session duration avg/p95/max (ms): 120492.94 / 120604.20 / 120822.00
- Messages received: 5597
- Chat delivery latency p50/p95/p99 (ms): 160.00 / 245.00 / 272.04
- Chat messages sent: 5711

## Threshold details
- ✅ `socket_connection_failures`: `count<5`
- ✅ `socket_session_duration`: `avg>2000`
- ✅ `chat_delivery_latency_ms`: `p(95)<2000`