import httpx


class CloudflareDNS:
    def __init__(self, api_token: str, zone_id: str | None, zone_name: str | None) -> None:
        self.api_token = api_token.strip()
        self.zone_id = (zone_id or "").strip() or None
        self.zone_name = (zone_name or "").strip() or None

        if not self.api_token:
            raise ValueError("CF_API_TOKEN is empty")

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_token}",
            "Content-Type": "application/json",
        }

    def _base(self) -> str:
        return "https://api.cloudflare.com/client/v4"

    def _get_zone_id(self) -> str:
        if self.zone_id:
            return self.zone_id
        if not self.zone_name:
            raise ValueError("Set CF_ZONE_ID or CF_ZONE_NAME")

        with httpx.Client(timeout=15) as client:
            r = client.get(
                f"{self._base()}/zones",
                headers=self._headers(),
                params={"name": self.zone_name, "status": "active", "per_page": 50},
            )
            r.raise_for_status()
            data = r.json()
            if not data.get("success") or not data.get("result"):
                raise RuntimeError(f"Could not find zone for {self.zone_name}: {data.get('errors')}")
            return data["result"][0]["id"]

    def _list_records(self, zone_id: str, record_type: str, name: str) -> list[dict]:
        with httpx.Client(timeout=15) as client:
            r = client.get(
                f"{self._base()}/zones/{zone_id}/dns_records",
                headers=self._headers(),
                params={"type": record_type, "name": name, "per_page": 100},
            )
            r.raise_for_status()
            data = r.json()
            if not data.get("success"):
                raise RuntimeError(f"Cloudflare list failed: {data.get('errors')}")
            return data.get("result", [])

    def upsert_minecraft_srv(self, server_fqdn: str, port: int) -> str:
        """
        Creates or updates:
          name:   _minecraft._tcp.<server_fqdn>
          target: <server_fqdn>
          port:   <port>
        """
        zone_id = self._get_zone_id()
        srv_name = f"_minecraft._tcp.{server_fqdn}".rstrip(".")
        target = server_fqdn.rstrip(".")

        desired = {
            "type": "SRV",
            "name": srv_name,
            "data": {"priority": 0, "weight": 0, "port": int(port), "target": target},
            "ttl": 120,
            "comment": "Managed by mc-manager",
        }

        existing = self._list_records(zone_id, "SRV", srv_name)

        with httpx.Client(timeout=15) as client:
            if existing:
                rec = existing[0]
                rec_id = rec["id"]
                current = rec.get("data") or {}
                if int(current.get("port", -1)) == int(port) and (current.get("target") or "").rstrip(".") == target:
                    return "unchanged"

                r = client.put(
                    f"{self._base()}/zones/{zone_id}/dns_records/{rec_id}",
                    headers=self._headers(),
                    json=desired,
                )
                r.raise_for_status()
                data = r.json()
                if not data.get("success"):
                    raise RuntimeError(f"Cloudflare update failed: {data.get('errors')}")
                return "updated"

            r = client.post(
                f"{self._base()}/zones/{zone_id}/dns_records",
                headers=self._headers(),
                json=desired,
            )
            r.raise_for_status()
            data = r.json()
            if not data.get("success"):
                raise RuntimeError(f"Cloudflare create failed: {data.get('errors')}")
            return "created"

    def delete_minecraft_srv(self, server_fqdn: str) -> int:
        zone_id = self._get_zone_id()
        srv_name = f"_minecraft._tcp.{server_fqdn}".rstrip(".")

        existing = self._list_records(zone_id, "SRV", srv_name)
        if not existing:
            return 0

        deleted = 0
        with httpx.Client(timeout=15) as client:
            for rec in existing:
                rec_id = rec["id"]
                r = client.delete(
                    f"{self._base()}/zones/{zone_id}/dns_records/{rec_id}",
                    headers=self._headers(),
                )
                r.raise_for_status()
                data = r.json()
                if data.get("success"):
                    deleted += 1
        return deleted
