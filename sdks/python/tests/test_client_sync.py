"""Tests for the synchronous Sulcus Python client."""

import pytest
from unittest.mock import patch, MagicMock
from sulcus import Sulcus, SulcusError, Memory
from sulcus.security import SecurityValidationError


def test_init_defaults():
    client = Sulcus(api_key="sk-test12345678")
    assert client.base_url == "https://api.sulcus.ca"
    assert client.namespace == "default"
    assert client.api_key == "sk-test12345678"
    assert client.security_guard == "warn"


def test_init_localhost_no_api_key():
    client = Sulcus(base_url="http://localhost:8080")
    assert client.base_url == "http://localhost:8080"
    assert client.api_key is None
    headers = client._headers()
    assert "Authorization" not in headers
    assert headers["User-Agent"] == "sulcus-python/3.0.0"


def test_headers_with_api_key():
    client = Sulcus(api_key="sk-test12345678")
    headers = client._headers()
    assert headers["Authorization"] == "Bearer sk-test12345678"
    assert headers["Content-Type"] == "application/json"
    assert headers["User-Agent"] == "sulcus-python/3.0.0"


@patch.object(Sulcus, "_post")
def test_remember_sync(mock_post):
    mock_post.return_value = {
        "id": "mem-123",
        "label": "User likes espresso",
        "pointer_summary": "User likes espresso",
        "memory_type": "preference",
        "current_heat": 0.85,
        "base_utility": 1.0,
        "is_pinned": True,
        "modality": "text",
        "namespace": "default",
    }
    client = Sulcus(api_key="sk-test12345678")
    mem = client.remember(
        "User likes espresso",
        memory_type="preference",
        heat=0.85,
        is_pinned=True,
    )

    assert isinstance(mem, Memory)
    assert mem.id == "mem-123"
    assert mem.pointer_summary == "User likes espresso"
    assert mem.memory_type == "preference"
    assert mem.is_pinned is True

    mock_post.assert_called_once_with(
        "/api/v1/agent/nodes",
        {
            "label": "User likes espresso",
            "memory_type": "preference",
            "heat": 0.85,
            "namespace": "default",
            "is_pinned": True,
        },
    )


def test_remember_security_guard_reject():
    client = Sulcus(api_key="sk-test12345678", security_guard="reject")
    with pytest.raises(SecurityValidationError, match="Security violation"):
        client.remember("Save secret key AKIA1234567890ABCDEF for production")


@patch.object(Sulcus, "_post")
def test_search_sync(mock_post):
    mock_post.return_value = [
        {
            "id": "mem-1",
            "pointer_summary": "Preference for Vim keybindings",
            "memory_type": "preference",
            "current_heat": 0.9,
            "base_utility": 1.0,
            "is_pinned": False,
            "modality": "text",
            "namespace": "default",
        }
    ]
    client = Sulcus(api_key="sk-test12345678")
    results = client.search("Vim", limit=5, memory_type="preference")

    assert len(results) == 1
    assert results[0].pointer_summary == "Preference for Vim keybindings"
    mock_post.assert_called_once_with(
        "/api/v1/agent/search",
        {"query": "Vim", "limit": 5, "memory_type": "preference"},
    )


@patch.object(Sulcus, "_get")
def test_list_sync(mock_get):
    mock_get.return_value = [
        {
            "id": "mem-2",
            "pointer_summary": "Daily standup at 9am",
            "memory_type": "procedural",
            "current_heat": 0.7,
            "base_utility": 1.0,
            "is_pinned": False,
            "modality": "text",
            "namespace": "team",
        }
    ]
    client = Sulcus(api_key="sk-test12345678", namespace="team")
    results = client.list(page=1, page_size=10, pinned=False, namespace="team")

    assert len(results) == 1
    assert results[0].id == "mem-2"
    mock_get.assert_called_once()
    called_path = mock_get.call_args[0][0]
    assert "namespace=team" in called_path
    assert "pinned=false" in called_path


@patch.object(Sulcus, "_patch")
def test_update_and_pin(mock_patch):
    mock_patch.return_value = {
        "id": "mem-1",
        "pointer_summary": "Updated summary",
        "memory_type": "preference",
        "current_heat": 0.9,
        "base_utility": 1.0,
        "is_pinned": True,
        "modality": "text",
        "namespace": "default",
    }
    client = Sulcus(api_key="sk-test12345678")
    mem = client.pin("mem-1")
    assert mem.is_pinned is True
    mock_patch.assert_called_once_with(
        "/api/v1/agent/nodes/mem-1",
        {"is_pinned": True},
    )


@patch.object(Sulcus, "_delete")
def test_forget(mock_delete):
    client = Sulcus(api_key="sk-test12345678")
    success = client.forget("mem-1")
    assert success is True
    mock_delete.assert_called_once_with("/api/v1/agent/nodes/mem-1")


@patch.object(Sulcus, "hot_context")
@patch.object(Sulcus, "list_triggers")
@patch.object(Sulcus, "get_notifications")
def test_build_context_xml(mock_notifs, mock_trigs, mock_hot):
    mock_hot.return_value = [
        Memory(
            id="mem-pref",
            pointer_summary="Dark mode enabled",
            memory_type="preference",
            current_heat=0.9,
            base_utility=1.0,
            is_pinned=True,
            modality="text",
            namespace="default",
        )
    ]
    mock_trigs.return_value = [
        {"name": "test_trig", "event": "on_recall", "action": "boost"}
    ]
    mock_notifs.return_value = []

    client = Sulcus(api_key="sk-test12345678")
    xml_context = client.build_context(token_budget=1000)

    assert "<sulcus_context" in xml_context
    assert "<preferences>" in xml_context
    assert "Dark mode enabled" in xml_context
    assert "<active_triggers>" in xml_context
    assert "test_trig" in xml_context


@patch.object(Sulcus, "status")
def test_validate_connection_success(mock_status):
    mock_status.return_value = {"status": "ok", "version": "3.0.0"}
    client = Sulcus(api_key="sk-test12345678")
    res = client.validate_connection()
    assert res["ok"] is True
    assert "latency_ms" in res
    assert res["service_status"]["version"] == "3.0.0"


@patch.object(Sulcus, "status")
def test_validate_connection_failure(mock_status):
    mock_status.side_effect = SulcusError(401, "Unauthorized")
    client = Sulcus(api_key="sk-test12345678")
    res = client.validate_connection()
    assert res["ok"] is False
    assert "latency_ms" in res
    assert "Unauthorized" in res["error"]
