# k6 run: shimy/shimyChatLoad.js

- **Timestamp**: 20260514_135538
- **Max VUs**: 50
- **Verdict**: ✅ PASS (3/3 thresholds)

## WebSocket
- Sessions OK: 69
- Handshake failures: 0
- Session duration avg/p95/max (ms): 118780.83 / 120528.80 / 120610.00
- Messages received: 5508
- Chat delivery latency p50/p95/p99 (ms): 163.00 / 250.00 / 296.21
- Chat messages sent: 5710
- ⚠ Closed by 4409 (duplicate session): 1

## Threshold details
- ✅ `chat_delivery_latency_ms`: `p(95)<2000`
- ✅ `socket_connection_failures`: `count<5`
- ✅ `socket_session_duration`: `avg>2000`