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

# Run database migrations using npm script
echo "Running database migrations..."
npm run migrate

if [ $? -eq 0 ]; then
  echo "✅ Migrations completed successfully!"
else
  echo "⚠️  Migration failed, but continuing to start server..."
fi

# Run the server normally
exec "$@"