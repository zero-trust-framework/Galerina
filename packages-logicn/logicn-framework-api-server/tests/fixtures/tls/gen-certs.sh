#!/usr/bin/env bash
# Regenerate the committed TLS fixtures used by tests/api-server-tls.test.mjs.
#
# These are throwaway, test-only certificates (no secret value) committed so the test
# suite has NO runtime openssl dependency. Run this only to rotate/refresh them.
#
#   bash gen-certs.sh
#
# Produces (and keeps): ca.crt, server.key, server.crt, client-good.key/.crt,
# client-untrusted.key/.crt. Intermediate keys/CSRs/serials are deleted.
set -euo pipefail
cd "$(dirname "$0")"
DAYS=7300 # ~20 years, so fixtures don't expire mid-CI

# 1) Trusted root CA (signs the server + the "good" client).
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days "$DAYS" \
  -subj "/CN=LogicN-Test-Root-CA" >/dev/null 2>&1

# 2) Server identity, signed by the CA. SAN IP:127.0.0.1 + DNS:localhost.
openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=127.0.0.1" >/dev/null 2>&1
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days "$DAYS" \
  -extfile <(printf "subjectAltName=IP:127.0.0.1,DNS:localhost") >/dev/null 2>&1

# 3) GOOD client, signed by the trusted CA → Node sets socket.authorized === true.
openssl req -newkey rsa:2048 -nodes -keyout client-good.key -out client-good.csr -subj "/CN=good-client" >/dev/null 2>&1
openssl x509 -req -in client-good.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out client-good.crt -days "$DAYS" >/dev/null 2>&1

# 4) UNTRUSTED CA + a client signed by it (NOT in the server's trust store) → socket.authorized === false.
openssl req -x509 -newkey rsa:2048 -nodes -keyout untrusted-ca.key -out untrusted-ca.crt -days "$DAYS" \
  -subj "/CN=Untrusted-Rogue-CA" >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes -keyout client-untrusted.key -out client-untrusted.csr -subj "/CN=rogue-client" >/dev/null 2>&1
openssl x509 -req -in client-untrusted.csr -CA untrusted-ca.crt -CAkey untrusted-ca.key -CAcreateserial \
  -out client-untrusted.crt -days "$DAYS" >/dev/null 2>&1

# Keep only what the test loads; drop CA private keys, CSRs and serials.
rm -f ./*.csr ./*.srl ca.key untrusted-ca.key untrusted-ca.crt
echo "Regenerated TLS fixtures:"
ls -1
