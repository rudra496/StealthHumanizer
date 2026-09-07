#!/bin/bash
# Deploy patched main.py to the stealth-models container and verify live.
# Run via: ssh -i <key> ubuntu@129.159.229.170 'bash -s' < deploy_and_verify.sh
set -e
echo "=== 1. backup current main.py ==="
sudo cp /opt/stealth-models/app/main.py /opt/stealth-models/app/main.py.bak.$(date +%s)
echo "=== 2. install patched main.py ==="
sudo cp /tmp/main_deploy.py /opt/stealth-models/app/main.py
sudo chown root:root /opt/stealth-models/app/main.py
echo "=== 3. restart container ==="
sudo docker restart stealth-models
echo "=== 4. wait for model load ==="
for i in $(seq 1 30); do
  sleep 10
  H=$(curl -s -m 5 http://localhost:8000/health || true)
  echo "  health: $H"
  echo "$H" | grep -q '"loaded":true' && break
done
echo "=== 5. live humanize tests (bypass nginx auth via localhost) ==="
for T in \
  '{"text":"Furthermore, it is important to note that the implementation of machine learning algorithms has significantly revolutionized the landscape of modern data analysis methodologies, thereby facilitating unprecedented insights into complex datasets."}' \
  '{"text":"In conclusion, the aforementioned findings underscore the paramount importance of this novel approach, which undoubtedly delves into uncharted territories and navigates the multifaceted complexities inherent in contemporary research paradigms."}' ; do
  echo "--- input: $(echo $T | head -c 90)..."
  R=$(curl -s -m 180 http://localhost:8000/humanize/ -H 'Content-Type: application/json' -d "$T")
  echo "    output: $(echo $R | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("humanized","ERR: "+str(d))[:250], "| model:", d.get("model","?"), "| ms:", d.get("elapsed_ms","?"))' 2>/dev/null || echo "$R" | head -c 200)"
done
echo "=== 6. detector sanity ==="
curl -s -m 60 http://localhost:8000/detect/ -H 'Content-Type: application/json' -d '{"text":"The quick brown fox jumps over the lazy dog and then it runs off into the woods behind the old farmhouse."}' | head -c 200
echo
echo "=== deploy done ==="
