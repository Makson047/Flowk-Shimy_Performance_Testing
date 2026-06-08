# k6 run: shimy/shimyChatLoad.js

- **Timestamp**: 20260504_122425
- **Max VUs**: 10
- **Verdict**: ✅ PASS (3/3 thresholds)

## WebSocket
- Sessions OK: 23
- Handshake failures: 0
- Session duration avg/p95/max (ms): 30471.61 / 30596.10 / 30604.00
- Messages received: 260
- Chat delivery latency p50/p95/p99 (ms): 153.00 / 220.10 / 255.10
- Chat messages sent: 333

## Threshold details
- ✅ `socket_connection_failures`: `count<5`
- ✅ `chat_delivery_latency_ms`: `p(95)<2000`
- ✅ `socket_session_duration`: `avg>2000`