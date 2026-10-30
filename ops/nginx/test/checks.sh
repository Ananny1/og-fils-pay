#!/bin/sh
# SEC-5 checks, run INSIDE a client container on the test network (see
# edge-test.sh). Every request comes from this one container, i.e. one
# client IP, which is exactly what the per-IP limits key on.
set -u

EDGE=http://edge
pass=0
fail=0

ok()  { pass=$((pass + 1)); echo "  PASS  $1"; }
bad() { fail=$((fail + 1)); echo "  FAIL  $1"; }
check() { if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1 (got $2, want $3)"; fi; }

code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

# Fires N back-to-back requests and prints "<200 count> <429 count>".
flood() {
  n=$1; shift
  c200=0; c429=0; i=0
  while [ "$i" -lt "$n" ]; do
    c=$(code "$@")
    [ "$c" = 200 ] && c200=$((c200 + 1))
    [ "$c" = 429 ] && c429=$((c429 + 1))
    i=$((i + 1))
  done
  echo "$c200 $c429"
}

# Lets every leaky bucket drain before the next check.
cool() { sleep "${1:-4}"; }

echo "== normal traffic is never limited"
c200=0; i=0
while [ "$i" -lt 15 ]; do
  [ "$(code "$EDGE/v1/transactions")" = 200 ] && c200=$((c200 + 1))
  sleep 0.2   # 5 requests a second, half the API rate
  i=$((i + 1))
done
check "15 API requests at 5/s all get 200" "$c200" 15

c200=0; i=0
while [ "$i" -lt 6 ]; do
  [ "$(code -X POST "$EDGE/v1/auth/login")" = 200 ] && c200=$((c200 + 1))
  sleep 1.1   # a person typing: ~1 login call a second
  i=$((i + 1))
done
check "6 login calls at ~1/s all get 200" "$c200" 6
cool

echo "== API flood (10 r/s, burst 20) is cut with 429"
set -- $(flood 60 "$EDGE/v1/transactions")
echo "  60 back-to-back: $1 x 200, $2 x 429"
[ "$1" -ge 20 ] && [ "$1" -le 40 ] && ok "about burst+1 got through ($1)" || bad "200s out of range ($1)"
[ "$2" -ge 20 ] && ok "the rest got 429 ($2)" || bad "too few 429 ($2)"
cool

echo "== login flood (1 r/s, burst 5) is cut much earlier"
set -- $(flood 20 -X POST "$EDGE/v1/auth/login")
echo "  merchant login, 20 back-to-back: $1 x 200, $2 x 429"
[ "$1" -le 8 ] && ok "at most ~6 got through ($1)" || bad "too many 200 ($1)"
[ "$2" -ge 12 ] && ok "the rest got 429 ($2)" || bad "too few 429 ($2)"
cool 7

set -- $(flood 20 -X POST "$EDGE/v1/admin/auth/otp/verify")
echo "  admin OTP verify, 20 back-to-back: $1 x 200, $2 x 429"
[ "$1" -le 8 ] && ok "admin auth limited too ($1 got through)" || bad "too many 200 ($1)"
cool 7

echo "== payment endpoints (3 r/s, burst 10)"
set -- $(flood 30 -X POST "$EDGE/v1/payment-links/tok_abc/pay")
echo "  pay, 30 back-to-back: $1 x 200, $2 x 429"
[ "$1" -ge 10 ] && [ "$1" -le 16 ] && ok "about burst+1 got through ($1)" || bad "200s out of range ($1)"
cool 5

echo "== a 429 is a JSON error the dashboards understand"
i=0; body=""
while [ "$i" -lt 12 ]; do
  body=$(curl -s -X POST "$EDGE/v1/auth/login")
  i=$((i + 1))
done
echo "  body: $body"
case "$body" in *'"error":"rate_limited"'*) ok "429 body is {\"error\":\"rate_limited\"}";; *) bad "429 body not JSON";; esac
retry=$(curl -s -D - -o /dev/null -X POST "$EDGE/v1/auth/login" | tr -d '\r' | grep -i '^retry-after:' | head -1)
[ -n "$retry" ] && ok "Retry-After header sent ($retry)" || bad "no Retry-After header"
cool 7

echo "== the API sees the real client IP, not a spoofed one"
me=$(hostname -i | awk '{print $1}')
body=$(curl -s -H 'X-Forwarded-For: 6.6.6.6' -H 'X-Real-IP: 6.6.6.6' "$EDGE/v1/transactions")
echo "  upstream saw: $body"
case "$body" in *6.6.6.6*) bad "spoofed IP reached the API";; *) ok "spoofed IP dropped";; esac
check "X-Real-IP is this client" "$(echo "$body" | sed -n 's/.*real=\([^ ]*\).*/\1/p')" "$me"
check "X-Forwarded-For is only this client" "$(echo "$body" | sed -n 's/.*xff=\([^ ]*\).*/\1/p')" "$me"

echo "== method allowlist"
check "TRACE" "$(code -X TRACE "$EDGE/v1/transactions")" 405
check "PUT" "$(code -X PUT "$EDGE/v1/transactions")" 405
check "PATCH" "$(code -X PATCH "$EDGE/v1/transactions")" 200
check "OPTIONS" "$(code -X OPTIONS "$EDGE/v1/transactions")" 200

echo "== dotfiles are hidden"
check "/.env" "$(code "$EDGE/.env")" 404
check "/.git/config" "$(code "$EDGE/.git/config")" 404
check "/assets/.htpasswd" "$(code "$EDGE/assets/.htpasswd")" 404
check "/.well-known/security.txt still served" "$(code "$EDGE/.well-known/security.txt")" 200

echo "== body size"
head -c 2000000 /dev/zero > /tmp/2m.bin
head -c 9000000 /dev/zero > /tmp/9m.bin
head -c 12000000 /dev/zero > /tmp/12m.bin
check "2 MB JSON to the API" "$(code -X POST --data-binary @/tmp/2m.bin "$EDGE/v1/transactions")" 413
check "2 MB KYC upload" "$(code -X POST --data-binary @/tmp/2m.bin "$EDGE/v1/merchants/m1/kyc/documents")" 200
check "9 MB KYC upload (8 MiB file + multipart overhead)" "$(code -X POST --data-binary @/tmp/9m.bin "$EDGE/v1/merchants/m1/kyc/documents")" 200
check "12 MB KYC upload" "$(code -X POST --data-binary @/tmp/12m.bin "$EDGE/v1/merchants/m1/kyc/documents")" 413

echo "== server version hidden"
server=$(curl -s -D - -o /dev/null "$EDGE/v1/transactions" | tr -d '\r' | grep -i '^server:' | head -1)
check "Server header" "$server" "Server: nginx"
cool

echo "== connection flood (20 per IP) is cut with 429"
rm -f /tmp/conn.*
i=0
while [ "$i" -lt 35 ]; do
  ( code --limit-rate 200k "$EDGE/static/big.bin"; echo ) > "/tmp/conn.$i" &
  i=$((i + 1))
done
wait
c200=$(cat /tmp/conn.* | grep -c 200)
c429=$(cat /tmp/conn.* | grep -c 429)
echo "  35 slow downloads at once: $c200 x 200, $c429 x 429"
[ "$c200" -ge 15 ] && [ "$c200" -le 22 ] && ok "about 20 connections served ($c200)" || bad "200s out of range ($c200)"
[ "$c429" -ge 10 ] && ok "the rest got 429 ($c429)" || bad "too few 429 ($c429)"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
