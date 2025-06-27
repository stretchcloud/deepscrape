#!/bin/bash

echo "🔍 Checking CORS configuration on app.extractr.ai"
echo "================================================"
echo ""

# Check the CORS diagnostic endpoint
echo "1️⃣ Checking CORS configuration:"
curl -s https://app.extractr.ai/cors-check \
  -H "Origin: http://localhost:8080" | jq '.' || echo "Endpoint not available"

echo ""
echo "2️⃣ Checking health endpoint:"
curl -s https://app.extractr.ai/health | jq '.' || echo "Health check failed"

echo ""
echo "3️⃣ Testing OPTIONS request with headers:"
curl -X OPTIONS https://app.extractr.ai/api/map \
  -H "Origin: http://localhost:8080" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type,x-api-key" \
  -i 2>/dev/null | head -20

echo ""
echo "📝 To fix CORS on your server:"
echo "1. Set CORS_OPEN_MODE=true in your .env file"
echo "2. OR set NODE_ENV=development"
echo "3. OR add allowed origins to ALLOWED_ORIGINS=http://localhost:8080,http://localhost:3000"
echo "4. Restart the server after making changes"