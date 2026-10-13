"""Tests for the asynchronous Sulcus Python client."""

import asyncio
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from sulcus import AsyncSulcus, Memory
from sulcus.security import SecurityValidationError


def test_async_init_and_repr():
    client = AsyncSulcus(api_key="sk-live_12345678abcdef")
    assert client.base_url == "https://api.sulcus.ca"
    assert client.namespace == "default"
    assert "sk-...cdef" in repr(client)
    assert "sk-live_12345678abcdef" not in repr(client)


def test_async_localhost_init():
    client = AsyncSulcus(base_url="http://localhost:8080")
    assert client.base_url == "http://localhost:8080"
    assert client.api_key is None
    assert "Authorization" not in client._client.headers


def test_async_remember():
    async def _run():
        client = AsyncSulcus(api_key="sk-test12345678")

        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "id": "mem-async-1",
            "pointer_summary": "Async preferences node",
            "memory_type": "preference",
            "current_heat": 0.8,
            "base_utility": 1.0,
            "is_pinned": True,
            "modality": "text",
            "namespace": "default",
        }
        mock_resp.raise_for_status = MagicMock()

        with patch.object(client._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_resp
            mem = await client.remember(
                "Async preferences node",
                memory_type="preference",
                is_pinned=True,
            )

            assert isinstance(mem, Memory)
            assert mem.id == "mem-async-1"
            assert mem.is_pinned is True
            mock_post.assert_awaited_once()

    asyncio.run(_run())


def test_async_remember_security_guard_reject():
    async def _run():
        client = AsyncSulcus(api_key="sk-test12345678", security_guard="reject")
        with pytest.raises(SecurityValidationError, match="Security violation"):
            await client.remember("Secret token: ghp_1234567890abcdefghijklmnopqrstuvwxyz12")

    asyncio.run(_run())


def test_async_search():
    async def _run():
        client = AsyncSulcus(api_key="sk-test12345678")

        mock_resp = MagicMock()
        mock_resp.json.return_value = [
            {
                "id": "mem-search-1",
                "pointer_summary": "Documentation search result",
                "memory_type": "semantic",
                "current_heat": 0.95,
                "base_utility": 1.0,
                "is_pinned": False,
                "modality": "text",
                "namespace": "default",
            }
        ]
        mock_resp.raise_for_status = MagicMock()

        with patch.object(client._client, "post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_resp
            results = await client.search("Documentation", limit=10)

            assert len(results) == 1
            assert results[0].id == "mem-search-1"
            mock_post.assert_awaited_once()

    asyncio.run(_run())


def test_async_validate_connection():
    async def _run():
        client = AsyncSulcus(api_key="sk-test12345678")

        with patch.object(client, "status", new_callable=AsyncMock) as mock_status:
            mock_status.return_value = {"status": "ok", "version": "3.0.0"}
            res = await client.validate_connection()
            assert res["ok"] is True
            assert "latency_ms" in res
            assert res["service_status"]["version"] == "3.0.0"

    asyncio.run(_run())


def test_async_scan_sensitive_data():
    client = AsyncSulcus(api_key="sk-test12345678")
    matches = client.scan_sensitive_data("Deploy key: AKIA1234567890ABCDEF")
    assert len(matches) == 1
    assert matches[0]["type"] == "aws_access_key"
