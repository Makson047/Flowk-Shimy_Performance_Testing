# k6 run: shimy/shimyChatLoad.js

- **Timestamp**: 20260514_134703
- **Max VUs**: 50
- **Verdict**: ✅ PASS (3/3 thresholds)

## WebSocket
- Sessions OK: 69
- Handshake failures: 0
- Session duration avg/p95/max (ms): 120211.65 / 120671.20 / 120766.00
- Messages received: n/a
- Chat delivery latency p50/p95/p99 (ms): 0.00 / 0.00 / 0.00
- Chat messages sent: 5706
- ⚠ Closed by 4409 (duplicate session): 1

## Threshold details
- ✅ `socket_connection_failures`: `count<5`
- ✅ `socket_session_duration`: `avg>2000`
- ✅ `chat_delivery_latency_ms`: `p(95)<2000`