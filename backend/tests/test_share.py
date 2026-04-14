"""Tests for the share API (Phase 8)."""
import pytest
from httpx import AsyncClient, ASGITransport
from api.main import app


@pytest.fixture
async def client(tmp_path, monkeypatch):
    """Provide an async test client with an isolated data directory."""
    from api import config as cfg_module
    from api.routes import share as share_module

    # Point data_dir and SHARE_DB_PATH to a temp directory
    monkeypatch.setattr(cfg_module.settings, "data_dir", tmp_path)
    monkeypatch.setattr(share_module, "SHARE_DB_PATH", tmp_path / "shares.json")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


class TestShareCreate:
    async def test_create_returns_eight_char_id(self, client):
        resp = await client.post("/api/share", json={"state": "abc123"})
        assert resp.status_code == 200
        data = resp.json()
        assert "id" in data
        assert len(data["id"]) == 8
        # Must be lowercase hex chars
        assert all(c in "0123456789abcdef" for c in data["id"])

    async def test_empty_state_rejected(self, client):
        resp = await client.post("/api/share", json={"state": ""})
        assert resp.status_code == 400

    async def test_payload_too_large_rejected(self, client):
        big = "x" * (2 * 1024 * 1024 + 1)
        resp = await client.post("/api/share", json={"state": big})
        assert resp.status_code == 413


class TestShareGet:
    async def test_roundtrip(self, client):
        payload = "H4sIABC123compressed"
        create_resp = await client.post("/api/share", json={"state": payload})
        share_id = create_resp.json()["id"]

        get_resp = await client.get(f"/api/share/{share_id}")
        assert get_resp.status_code == 200
        assert get_resp.json()["state"] == payload

    async def test_not_found(self, client):
        resp = await client.get("/api/share/00000000")
        assert resp.status_code == 404

    async def test_invalid_id_format_rejected(self, client):
        # Must be exactly 8 lowercase hex chars — uppercase, dots, and extra
        # length should all be rejected.
        for bad_id in ("ABCDEF12", "abc.defg", "abc!defg", "000000000"):
            resp = await client.get(f"/api/share/{bad_id}")
            assert resp.status_code == 400, f"Expected 400 for id={bad_id!r}, got {resp.status_code}"

    async def test_invalid_id_too_short(self, client):
        resp = await client.get("/api/share/abc")
        assert resp.status_code == 400

    async def test_multiple_shares_independent(self, client):
        r1 = await client.post("/api/share", json={"state": "state-one"})
        r2 = await client.post("/api/share", json={"state": "state-two"})
        id1 = r1.json()["id"]
        id2 = r2.json()["id"]

        assert id1 != id2
        assert (await client.get(f"/api/share/{id1}")).json()["state"] == "state-one"
        assert (await client.get(f"/api/share/{id2}")).json()["state"] == "state-two"
