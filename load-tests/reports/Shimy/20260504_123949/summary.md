# k6 run: shimy/shimyChatLoad.js

- **Timestamp**: 20260504_123949
- **Max VUs**: 50
- **Verdict**: ✅ PASS (3/3 thresholds)

## WebSocket
- Sessions OK: 68
- Handshake failures: 0
- Session duration avg/p95/max (ms): 120500.22 / 120594.50 / 120623.00
- Messages received: 22600
- Chat delivery latency p50/p95/p99 (ms): 0.00 / 0.00 / 0.00
- Chat messages sent: n/a

## Threshold details
- ✅ `chat_delivery_latency_ms`: `p(95)<2000`
- ✅ `socket_connection_failures`: `count<5`
- ✅ `socket_session_duration`: `avg>2000`