#!/bin/bash
set -e

# Function to wait for PostgreSQL
wait_for_postgres() {
  echo "Waiting for PostgreSQL at $DB_HOST:$DB_PORT..."
  
  max_retries=30
  retries=0
  
  while ! nc -z $DB_HOST $DB_PORT; do
    retries=$((retries+1))
    if [ $retries -eq $max_retries ]; then
      echo "Error: PostgreSQL not available after $max_retries attempts. Continuing anyway..."
      break
    fi
    echo "PostgreSQL not available yet (attempt $retries/$max_retries), retrying..."
    sleep 2
  done
  
  if [ $retries -lt $max_retries ]; then
    echo "PostgreSQL is ready!"
  fi
}

# Wait for PostgreSQL to be ready
wait_for_postgres

# Run the application with migrations before startup
NODE_OPTIONS="--max-old-space-size=4096" node -e "require('./server/src/db/migrate')().then(() => { console.log('Migration process completed.'); })"

# Run the server normally 
exec "$@"