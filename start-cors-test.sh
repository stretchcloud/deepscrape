#!/bin/bash

echo "🚀 Starting local web server for CORS testing..."
echo "📍 The test page will be available at: http://localhost:8080/test-cors.html"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

# Check if Python 3 is available
if command -v python3 &> /dev/null; then
    echo "Using Python 3 HTTP server..."
    python3 -m http.server 8080
# Check if Python 2 is available
elif command -v python &> /dev/null; then
    echo "Using Python 2 SimpleHTTPServer..."
    python -m SimpleHTTPServer 8080
# Check if Node.js is available
elif command -v npx &> /dev/null; then
    echo "Using Node.js http-server..."
    npx http-server -p 8080
else
    echo "❌ No suitable web server found!"
    echo "Please install Python or Node.js"
    exit 1
fi