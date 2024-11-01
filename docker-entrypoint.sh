#!/bin/sh

# Start backend server
cd /app && npm run start:server -- --host 0.0.0.0 &

# Start nginx
nginx -g 'daemon off;'
