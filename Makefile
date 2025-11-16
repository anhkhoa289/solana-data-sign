.PHONY: help install build deploy up down logs clean test

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-15s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install dependencies
	npm install
	cd consumer && npm install

build: ## Build Anchor program and consumer
	anchor build
	cd consumer && npm run build

deploy: ## Deploy program to devnet
	anchor deploy --provider.cluster devnet

up: ## Start all services with docker-compose
	docker-compose up -d

down: ## Stop all services
	docker-compose down

logs: ## Show logs from all services
	docker-compose logs -f

logs-consumer: ## Show consumer logs only
	docker-compose logs -f solana-consumer

logs-emqx: ## Show EMQX logs only
	docker-compose logs -f emqx

clean: ## Clean build artifacts
	rm -rf target
	rm -rf node_modules
	rm -rf consumer/node_modules
	rm -rf consumer/dist
	docker-compose down -v

test: ## Run tests
	anchor test

rebuild: ## Rebuild and restart docker services
	docker-compose down
	docker-compose up --build -d

keypair: ## Generate new Solana keypair
	solana-keygen new --outfile keypair.json

airdrop: ## Request SOL airdrop (devnet)
	@if [ -f keypair.json ]; then \
		solana airdrop 2 $$(solana-keygen pubkey keypair.json) --url devnet; \
	else \
		echo "keypair.json not found. Run 'make keypair' first."; \
	fi

balance: ## Check wallet balance
	@if [ -f keypair.json ]; then \
		solana balance $$(solana-keygen pubkey keypair.json) --url devnet; \
	else \
		echo "keypair.json not found. Run 'make keypair' first."; \
	fi

publish-test: ## Publish test message to EMQX
	docker exec -it emqx mosquitto_pub -h localhost -t 'data/sensor/test' \
		-m '{"data":"Test message from Makefile","timestamp":'$$(date +%s)'000,"source":"makefile"}'
