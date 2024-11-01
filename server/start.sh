#!/bin/bash

# Start Xvfb in the background with the desired dimensions
Xvfb :0 -screen 0 900x400x24 &

# Wait for Xvfb to start
sleep 2

# Execute the Node.js application
exec npm run server