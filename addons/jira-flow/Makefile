.PHONY: test smoke down manifests
test:
	cd services/metrics-service && dotnet test
	cd services/ingest-gateway && npm ci && npm run typecheck && npm run test:coverage
smoke:
	docker compose up --build -d --wait ingest-gateway metrics-service && ./scripts/smoke.sh
down:
	docker compose down -v
manifests:
	kubectl kustomize deploy/overlays/local && kubectl kustomize deploy/kafka
