#!/bin/sh
# Health check script for Docker container
exec wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1