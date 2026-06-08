# k6 run: shimy/shimyChatLoad.js

- **Timestamp**: 20260504_130742
- **Max VUs**: 50
- **Verdict**: ✅ PASS (3/3 thresholds)

## WebSocket
- Sessions OK: 50
- Handshake failures: 0
- Session duration avg/p95/max (ms): 300489.98 / 300600.30 / 300605.00
- Messages received: 52979
- Chat delivery latency p50/p95/p99 (ms): 0.00 / 0.00 / 0.00
- Chat messages sent: n/a

## Threshold details
- ✅ `socket_connection_failures`: `count<5`
- ✅ `socket_session_duration`: `avg>2000`
- ✅ `chat_delivery_latency_ms`: `p(95)<2000`