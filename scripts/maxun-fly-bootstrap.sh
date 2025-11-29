#!/usr/bin/env bash
set -euo pipefail

main() {

  fly launch --name maxun-backend --org lex-ai --no-deploy --config fly.backend.production.toml
  fly launch --name maxun-frontend --org lex-ai --no-deploy --config fly.frontend.production.toml
  fly launch --name maxun-minio --org lex-ai --no-deploy --config fly.minio.production.toml
      
  fly volumes create maxun_minio_data --size 1 --region fra --app maxun-minio

  fly deploy --app maxun-minio --config fly.minio.production.tomlfl
  fly deploy --app maxun-backend --config fly.backend.production.toml
  fly deploy --app maxun-frontend --config fly.frontend.production.toml  
}

main "$@"


