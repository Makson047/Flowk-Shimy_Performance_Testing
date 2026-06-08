# k6 run: shimy/shimyChatLoad.js

- **Timestamp**: 20260504_125657
- **Max VUs**: 50
- **Verdict**: ✅ PASS (3/3 thresholds)

## WebSocket
- Sessions OK: 50
- Handshake failures: 0
- Session duration avg/p95/max (ms): 300463.60 / 300533.10 / 300542.00
- Messages received: 13183
- Chat delivery latency p50/p95/p99 (ms): 160.00 / 245.00 / 275.00
- Chat messages sent: 13292

## Threshold details
- ✅ `socket_session_duration`: `avg>2000`
- ✅ `socket_connection_failures`: `count<5`
- ✅ `chat_delivery_latency_ms`: `p(95)<2000`