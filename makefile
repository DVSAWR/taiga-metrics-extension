.PHONY: help install-dev test test-fast lint format format-check type-check check-all clear pre-commit docker-build stand-up stand-down stand-logs check-assets

TAIGA_DOCKER_DIR ?= ../taiga-docker
IMAGE ?= taiga-metrics:latest
STAND = cd $(TAIGA_DOCKER_DIR) && TAIGA_METRICS_IMAGE=$(IMAGE) docker compose -f docker-compose.yml -f $(CURDIR)/deploy/taiga-metrics.yml

GREEN_BOLD = \033[1;32m
CYAN_BOLD = \033[1;36m
RESET = \033[0m

help:
	@echo "$(GREEN_BOLD)USAGE:$(RESET)"
	@echo "  make $(CYAN_BOLD)<COMMAND>$(RESET)"
	@echo "$(GREEN_BOLD)COMMANDS:$(RESET)"
	@echo "  $(CYAN_BOLD)install-dev$(RESET)    - Install development dependencies"
	@echo "  $(CYAN_BOLD)test$(RESET)           - Run tests with coverage"
	@echo "  $(CYAN_BOLD)test-fast$(RESET)      - Run tests quickly without coverage"
	@echo "  $(CYAN_BOLD)lint$(RESET)           - Run ruff linter and fix automatically"
	@echo "  $(CYAN_BOLD)format$(RESET)         - Format code with ruff format"
	@echo "  $(CYAN_BOLD)format-check$(RESET)   - Check formatting without making changes"
	@echo "  $(CYAN_BOLD)type-check$(RESET)     - Run mypy type checking"
	@echo "  $(CYAN_BOLD)check-all$(RESET)      - Run all checks (format-check, lint, type-check, test)"
	@echo "  $(CYAN_BOLD)clear$(RESET)          - Clean up temporary files"
	@echo "  $(CYAN_BOLD)pre-commit$(RESET)     - Install pre-commit hooks"
	@echo "  $(CYAN_BOLD)check-assets$(RESET)   - Check that no icon or logo is copied from Taiga's frontend"
	@echo "  $(CYAN_BOLD)docker-build$(RESET)   - Build the Docker image"
	@echo "  $(CYAN_BOLD)stand-up$(RESET)       - Build and start the extension next to a local taiga-docker"
	@echo "  $(CYAN_BOLD)stand-down$(RESET)     - Stop the extension services of the local stand"
	@echo "  $(CYAN_BOLD)stand-logs$(RESET)     - Follow the extension logs of the local stand"
	@echo ""

install-dev:
	uv sync --extra dev

test:
	uv run pytest tests/ -v --cov=taiga_metrics --cov-report=term-missing --cov-report=html

test-fast:
	uv run pytest tests/ -v

lint:
	uv run ruff check . --fix

format:
	uv run ruff format .

format-check:
	uv run ruff format --check .

type-check:
	uv run mypy

check-all: format-check lint type-check test

clear:
	find . -type d -name "__pycache__" -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete
	find . -type d -name ".mypy_cache" -exec rm -rf {} +
	find . -type d -name ".pytest_cache" -exec rm -rf {} +
	find . -type d -name ".ruff_cache" -exec rm -rf {} +
	find . -type f -name ".coverage" -delete
	find . -type d -name "htmlcov" -exec rm -rf {} +
	rm -rf *.egg-info dist build frontend/dist

pre-commit:
	uv run pre-commit install

check-assets:
	uv run python scripts/check_taiga_assets.py

docker-build:
	docker build -t $(IMAGE) .

stand-up: docker-build
	$(STAND) up -d taiga-metrics taiga-metrics-worker taiga-metrics-db

stand-down:
	$(STAND) stop taiga-metrics taiga-metrics-worker taiga-metrics-db

stand-logs:
	$(STAND) logs -f taiga-metrics taiga-metrics-worker
