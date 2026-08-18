DOCKER_COMPOSE := docker compose

all: up

help:
	@echo "Available targets:"
	@echo "  make all               Start the production stack"
	@echo "  make build             Build Docker images"
	@echo "  make clean             Stop the containers and remove project volumes/networks"
	@echo "  make fclean            Full cleanup of the project and Docker leftovers"
	@echo "  make re                Rebuild from scratch"
	@echo "  make up                Start the production stack"
	@echo "  make up-dev            Start the development stack with hot reload"
	@echo "  make down              Stop the containers"
	@echo "  make down-vol          Stop the containers and remove the volumes"
	@echo "  make logs              Follow container logs"
	@echo "  make ps                Show container status"
	@echo "  make backend-shell     Open a shell inside the backend container"
	@echo "  make frontend-shell    Open a shell inside the frontend container"

build:
	$(DOCKER_COMPOSE) build

clean:
	-$(DOCKER_COMPOSE) down --volumes --remove-orphans
	-docker volume prune -f
	-docker network prune -f

fclean: clean
	-docker image prune -af
	-docker builder prune -af
	-docker system prune -af

re: fclean build

up:
	$(DOCKER_COMPOSE) up -d

up-dev:
	$(DOCKER_COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml up -d

down:
	$(DOCKER_COMPOSE) down

down-vol:
	$(DOCKER_COMPOSE) down -v

logs:
	$(DOCKER_COMPOSE) logs -f

ps:
	$(DOCKER_COMPOSE) ps

backend-shell:
	$(DOCKER_COMPOSE) exec backend sh

frontend-shell:
	$(DOCKER_COMPOSE) exec frontend sh

.PHONY: help all up up-dev down down-vol logs ps backend-shell frontend-shell build clean fclean re
