#!/bin/bash

echo "🧪 Testing CORS headers with curl"
echo "=================================="
echo ""

API_URL="https://app.extractr.ai/api/map"

echo "1️⃣ Testing OPTIONS request (preflight):"
echo "----------------------------------------"
curl -X OPTIONS "$API_URL" \
  -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type,x-api-key" \
  -i 2>/dev/null | grep -i "access-control" || echo "No CORS headers found!"

echo ""
echo ""
echo "2️⃣ Testing POST request with Origin header:"
echo "--------------------------------------------"
curl -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: test-key" \
  -H "Origin: http://localhost:3000" \
  -d '{"url":"https://www.firecrawl.dev/","maxUrls":10}' \
  -i 2>/dev/null | head -20 | grep -E "(HTTP|access-control)" || echo "Request failed!"

echo ""
echo ""
echo "3️⃣ Testing server configuration:"
echo "---------------------------------"
echo "If CORS is properly configured, you should see:"
echo "  - Access-Control-Allow-Origin: * (or http://localhost:3000)"
echo "  - Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS"
echo "  - Access-Control-Allow-Headers: Content-Type, Authorization, X-API-Key"
echo "  - Access-Control-Allow-Credentials: true"