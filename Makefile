DOCKER_COMPOSE := docker compose

all: up

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

.PHONY: all up up-dev down down-vol logs ps backend-shell frontend-shell build clean fclean re
