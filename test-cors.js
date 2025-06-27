#!/usr/bin/env node

/**
 * CORS Test Script for DeepScraper API
 * Tests the API from a Node.js environment (simulating browser behavior)
 */

const https = require('https');
const http = require('http');

// Configuration
const API_URL = 'https://app.extractr.ai/api/map';
const API_KEY = 'test-key';

// ANSI color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

// Test 1: Preflight Request (OPTIONS)
async function testPreflight() {
    log('\n🔍 Test 1: CORS Preflight Request (OPTIONS)', 'cyan');
    log('=' .repeat(50), 'cyan');
    
    const url = new URL(API_URL);
    const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'OPTIONS',
        headers: {
            'Origin': 'http://localhost:3000',
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'content-type,x-api-key'
        }
    };

    return new Promise((resolve) => {
        const req = https.request(options, (res) => {
            log(`\nStatus Code: ${res.statusCode}`, res.statusCode === 200 ? 'green' : 'red');
            log('\nCORS Headers:', 'yellow');
            
            const corsHeaders = [
                'access-control-allow-origin',
                'access-control-allow-methods',
                'access-control-allow-headers',
                'access-control-allow-credentials',
                'access-control-max-age'
            ];
            
            corsHeaders.forEach(header => {
                const value = res.headers[header];
                if (value) {
                    log(`  ${header}: ${value}`, 'green');
                } else {
                    log(`  ${header}: NOT SET`, 'red');
                }
            });
            
            resolve(res.statusCode === 200 || res.statusCode === 204);
        });

        req.on('error', (error) => {
            log(`\n❌ Preflight request failed: ${error.message}`, 'red');
            resolve(false);
        });

        req.end();
    });
}

// Test 2: Actual API Request
async function testAPIRequest() {
    log('\n\n🚀 Test 2: Actual API Request (POST)', 'cyan');
    log('=' .repeat(50), 'cyan');
    
    const requestBody = JSON.stringify({
        url: "https://www.firecrawl.dev/",
        maxUrls: 5000,
        includeSubdomains: true,
        timeoutMs: 120000,
        crawlOptions: {
            maxCrawlDepth: 4,
            maxConcurrentCrawlers: 15,
            crawlTimeoutPerPage: 7000,
            maxLinksPerPage: 300,
            enableDeepCrawling: true,
            browserPoolSize: 15
        },
        skipSitemaps: false,
        sitemapsOnly: false
    });

    const url = new URL(API_URL);
    const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': API_KEY,
            'Content-Length': Buffer.byteLength(requestBody),
            'Origin': 'http://localhost:3000' // Simulate browser origin
        }
    };

    return new Promise((resolve) => {
        const startTime = Date.now();
        const req = https.request(options, (res) => {
            const responseTime = Date.now() - startTime;
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                log(`\nStatus Code: ${res.statusCode}`, res.statusCode === 200 ? 'green' : 'red');
                log(`Response Time: ${responseTime}ms`, 'yellow');
                
                // Check CORS headers in response
                log('\nCORS Headers in Response:', 'yellow');
                const corsHeaders = ['access-control-allow-origin', 'access-control-allow-credentials'];
                corsHeaders.forEach(header => {
                    const value = res.headers[header];
                    if (value) {
                        log(`  ${header}: ${value}`, 'green');
                    }
                });
                
                try {
                    const jsonData = JSON.parse(data);
                    log('\nResponse Preview:', 'yellow');
                    log(JSON.stringify(jsonData, null, 2).substring(0, 500) + '...', 'blue');
                } catch (e) {
                    log('\nResponse:', 'yellow');
                    log(data.substring(0, 500) + '...', 'blue');
                }
                
                resolve(res.statusCode === 200);
            });
        });

        req.on('error', (error) => {
            log(`\n❌ API request failed: ${error.message}`, 'red');
            resolve(false);
        });

        req.write(requestBody);
        req.end();
    });
}

// Test 3: Browser Simulation with Fetch
async function testWithFetch() {
    log('\n\n🌐 Test 3: Simulating Browser Fetch Request', 'cyan');
    log('=' .repeat(50), 'cyan');
    
    // Check if fetch is available (Node 18+)
    if (typeof fetch === 'undefined') {
        log('⚠️  Fetch API not available in this Node version (requires Node 18+)', 'yellow');
        return false;
    }
    
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': API_KEY,
                'Origin': 'http://localhost:3000'
            },
            body: JSON.stringify({
                url: "https://www.firecrawl.dev/",
                maxUrls: 100 // Smaller request for quick test
            })
        });
        
        log(`\nStatus: ${response.status} ${response.statusText}`, response.ok ? 'green' : 'red');
        
        // Log CORS headers
        log('\nCORS Headers:', 'yellow');
        for (const [key, value] of response.headers.entries()) {
            if (key.toLowerCase().startsWith('access-control-')) {
                log(`  ${key}: ${value}`, 'green');
            }
        }
        
        const data = await response.json();
        log('\nResponse:', 'yellow');
        log(JSON.stringify(data, null, 2).substring(0, 300) + '...', 'blue');
        
        return response.ok;
    } catch (error) {
        log(`\n❌ Fetch request failed: ${error.message}`, 'red');
        return false;
    }
}

// Main test runner
async function runTests() {
    log('🧪 DeepScraper CORS Test Suite', 'cyan');
    log('Testing API: ' + API_URL, 'blue');
    log('Using API Key: ' + API_KEY, 'blue');
    
    const results = {
        preflight: await testPreflight(),
        apiRequest: await testAPIRequest(),
        fetch: await testWithFetch()
    };
    
    // Summary
    log('\n\n📊 Test Summary', 'cyan');
    log('=' .repeat(50), 'cyan');
    
    Object.entries(results).forEach(([test, passed]) => {
        log(`${test}: ${passed ? '✅ PASSED' : '❌ FAILED'}`, passed ? 'green' : 'red');
    });
    
    const allPassed = Object.values(results).every(r => r);
    log(`\nOverall: ${allPassed ? '✅ All tests passed!' : '❌ Some tests failed'}`, allPassed ? 'green' : 'red');
    
    if (!allPassed) {
        log('\n💡 Troubleshooting Tips:', 'yellow');
        log('1. Ensure the server has CORS properly configured', 'yellow');
        log('2. Check if NODE_ENV is set to development for open CORS', 'yellow');
        log('3. Verify the API key is correct', 'yellow');
        log('4. Check server logs for any errors', 'yellow');
    }
}

// Run the tests
runTests().catch(console.error);