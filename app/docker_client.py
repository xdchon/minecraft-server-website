import docker

from .config import settings

# Connect to the Docker socket
docker_client = docker.DockerClient(base_url=settings.docker_base_url)
