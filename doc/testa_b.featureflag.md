curl -s -X POST http://localhost:3000/_ff/landing-v2 \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "payload": { "rollout": 50, "salt": "landing-v2" }}' \
| jq


curl -i http://localhost:3000/landing


{ "variant": "A", "uid": "2cf8b1d3-..." }

curl -i --cookie "aid=2cf8b1d3-..." http://localhost:3000/landing


curl -s -X POST http://localhost:3000/_ff/landing-v2 \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "payload": { "rollout": 80, "salt": "landing-v2" }}' \
| jq


curl -i --cookie "aid=2cf8b1d3-..." http://localhost:3000/landing


# Thêm allowUsers: ["qa-user-123"]
curl -s -X POST http://localhost:3000/_ff/landing-v2 \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "payload": { "rollout": 0, "allowUsers": ["qa-user-123"], "salt": "landing-v2" }}' \
| jq

