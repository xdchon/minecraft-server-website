import docker
from docker.errors import DockerException

from .config import settings

_docker_client: docker.DockerClient | None = None


def get_docker_client() -> docker.DockerClient:
    """
    Lazily creates a Docker client.

    Import-time Docker connectivity failures would otherwise prevent the API from booting,
    even though most routes can still render and surface a clear 503 when Docker is down.
    """
    global _docker_client
    if _docker_client is not None:
        return _docker_client
    try:
        client = docker.DockerClient(base_url=settings.docker_base_url)
    except DockerException:
        raise
    except Exception as exc:
        raise DockerException(str(exc)) from exc
    _docker_client = client
    return client
