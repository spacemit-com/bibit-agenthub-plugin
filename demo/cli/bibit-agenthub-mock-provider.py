#!/usr/bin/env python3
"""Managed stdio AgentHub demo Provider. Uses only the Python standard library."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

MAX_STORE_BYTES = 512 * 1024 * 1024
CHUNK_BYTES = 64 * 1024
SAFE_SEGMENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


class Provider:
    def __init__(self, data_dir: Path, emit=None) -> None:
        self.data_dir = data_dir.resolve()
        self.packages = self.data_dir / "packages"
        self.catalog_path = self.data_dir / "catalog.json"
        self.packages.mkdir(parents=True, exist_ok=True, mode=0o700)
        self._emit = emit or self._write
        self._write_lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._active: tuple[str, threading.Event] | None = None
        self._reserved_bytes = 0
        self.delay = max(0, int(os.environ.get("BIBIT_AGENTHUB_MOCK_DELAY_MS", "10"))) / 1000

    def _write(self, value: dict[str, Any]) -> None:
        with self._write_lock:
            print(json.dumps(value, separators=(",", ":")), flush=True)

    def _catalog(self) -> dict[str, dict[str, Any]]:
        try:
            value = json.loads(self.catalog_path.read_text(encoding="utf-8"))
            return value if isinstance(value, dict) else {}
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return {}

    def _save_catalog(self, catalog: dict[str, dict[str, Any]]) -> None:
        temporary = self.catalog_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(catalog, sort_keys=True), encoding="utf-8")
        os.replace(temporary, self.catalog_path)

    def _resource(self, locator: str) -> Path:
        parts = locator.split("/")
        if not locator or len(locator) > 512 or any(not SAFE_SEGMENT.fullmatch(part) for part in parts):
            raise ValueError("unsafe resource locator")
        candidate = self.data_dir.joinpath(*parts)
        current = self.data_dir
        for part in parts[:-1]:
            current /= part
            if current.is_symlink():
                raise ValueError("symlink resource locator")
        if candidate.parent.resolve() != candidate.parent or self.data_dir not in candidate.parents:
            raise ValueError("resource outside Provider data")
        return candidate

    def _event(self, service_id: str, job_id: str, sequence: int, kind: str, **payload: Any) -> None:
        self._emit({
            "jsonrpc": "2.0",
            "method": "bibit.jobEvent",
            "params": {
                "serviceId": service_id,
                "jobId": job_id,
                "providerSequence": sequence,
                "kind": kind,
                **payload,
            },
        })

    def invoke(self, operation: str, params: dict[str, Any]) -> Any:
        if operation == "agents.list.v1":
            return [
                {"id": key, "name": value["displayName"], "description": "Local demo Agent package"}
                for key, value in sorted(self._catalog().items())
            ]
        if operation == "settings.get.v1":
            return {"showExperimental": False, "refreshMinutes": 15}
        if operation == "settings.update.v1":
            return params
        raise ValueError("unknown operation")

    def start(self, params: dict[str, Any]) -> bool:
        job_id = params.get("jobId")
        operation = params.get("operationId")
        resources = params.get("resources")
        if (
            not isinstance(job_id, str)
            or operation not in ("agents.upload.v1", "agents.download.v1")
            or not isinstance(resources, list)
            or len(resources) != 1
            or not isinstance(resources[0], dict)
        ):
            return False
        with self._state_lock:
            if self._active is not None:
                return False
            cancelled = threading.Event()
            self._active = (job_id, cancelled)
        threading.Thread(
            target=self._run_job,
            args=(params, cancelled),
            daemon=True,
            name=f"agenthub-job-{job_id[:8]}",
        ).start()
        return True

    def cancel(self, job_id: str) -> bool:
        with self._state_lock:
            if self._active is None or self._active[0] != job_id:
                return False
            self._active[1].set()
            return True

    def _copy(self, source: Path, target: Path, total: int, cancelled: threading.Event, progress, *, replace: bool = False) -> str:
        digest = hashlib.sha256()
        completed = 0
        with source.open("rb") as input_file, target.open("wb" if replace else "xb") as output_file:
            while chunk := input_file.read(CHUNK_BYTES):
                if cancelled.is_set():
                    raise InterruptedError
                output_file.write(chunk)
                digest.update(chunk)
                completed += len(chunk)
                progress(completed, total)
                if self.delay:
                    time.sleep(self.delay)
            output_file.flush()
            os.fsync(output_file.fileno())
        return digest.hexdigest()

    def _run_job(self, params: dict[str, Any], cancelled: threading.Event) -> None:
        service_id = params["serviceId"]
        job_id = params["jobId"]
        operation = params["operationId"]
        resource = params["resources"][0]
        sequence = 0
        temporary: Path | None = None
        reserved = 0

        def progress(completed: int, total: int) -> None:
            nonlocal sequence
            sequence += 1
            self._event(service_id, job_id, sequence, "progress", progress={
                "completedBytes": completed,
                "totalBytes": total,
            })

        try:
            path = self._resource(resource["resourcePath"])
            if operation == "agents.upload.v1":
                size = path.stat().st_size
                with self._state_lock:
                    used = sum(item.get("bytes", 0) for item in self._catalog().values())
                    if used + self._reserved_bytes + size > MAX_STORE_BYTES:
                        raise OverflowError
                    self._reserved_bytes += size
                    reserved = size
                agent_id = job_id
                temporary = self.packages / f".{agent_id}.tmp"
                package = self.packages / f"{agent_id}.demo-agent"
                sha256 = self._copy(path, temporary, size, cancelled, progress)
                os.replace(temporary, package)
                temporary = None
                display_name = params.get("input", {}).get("displayName") or "Uploaded Agent"
                with self._state_lock:
                    catalog = self._catalog()
                    catalog[agent_id] = {
                        "displayName": str(display_name)[:128],
                        "bytes": size,
                        "sha256": sha256,
                        "file": package.name,
                    }
                    self._save_catalog(catalog)
                    self._reserved_bytes -= reserved
                    reserved = 0
                output = {"agentId": agent_id, "displayName": display_name, "bytes": size, "sha256": sha256}
                sequence += 1
                self._event(service_id, job_id, sequence, "result_ready", result={"output": output})
            else:
                agent_id = params.get("input", {}).get("agentId")
                item = self._catalog().get(agent_id)
                if not item:
                    raise FileNotFoundError
                source = self.packages / item["file"]
                if path.is_symlink() or not path.is_file():
                    raise ValueError("invalid output resource")
                sha256 = self._copy(source, path, item["bytes"], cancelled, progress, replace=True)
                output = {"agentId": agent_id, "bytes": item["bytes"], "sha256": sha256}
                sequence += 1
                self._event(service_id, job_id, sequence, "result_ready", result={
                    "output": output,
                    "resource": {"resourcePath": resource["resourcePath"], "byteLength": item["bytes"], "sha256": sha256},
                })
        except InterruptedError:
            if temporary:
                temporary.unlink(missing_ok=True)
            try:
                if operation == "agents.download.v1":
                    self._resource(resource["resourcePath"]).unlink(missing_ok=True)
            except (KeyError, OSError, ValueError):
                pass
            sequence += 1
            self._event(service_id, job_id, sequence, "cancelled")
        except Exception as error:
            if temporary:
                temporary.unlink(missing_ok=True)
            sequence += 1
            code = "resource_exhausted" if isinstance(error, OverflowError) else "incompatible"
            self._event(service_id, job_id, sequence, "failed", error={
                "code": code,
                "message": "AgentHub demo transfer failed",
                "retryable": not isinstance(error, (ValueError, FileNotFoundError)),
            })
        finally:
            with self._state_lock:
                if reserved:
                    self._reserved_bytes -= reserved
                if self._active and self._active[0] == job_id:
                    self._active = None


def serve(provider: Provider) -> None:
    for line in sys.stdin:
        message: Any = None
        try:
            message = json.loads(line)
            request_id = message.get("id")
            method = message.get("method")
            params = message.get("params", {})
            if method == "bibit.initialize":
                result = {
                    "protocolVersion": 2,
                    "providerVersion": "agenthub-mock-1",
                    "capabilities": {"invoke": True, "jobs": True, "cancellation": True, "maxConcurrentJobs": 1},
                    "operations": ["agents.list.v1", "settings.get.v1", "settings.update.v1", "agents.upload.v1", "agents.download.v1"],
                }
            elif method == "bibit.invoke":
                result = provider.invoke(params["operationId"], params.get("params", {}))
            elif method == "bibit.job.start":
                if not provider.start(params):
                    raise ValueError("job rejected")
                result = {"jobId": params["jobId"], "accepted": True}
            elif method == "bibit.job.cancel":
                result = {"jobId": params["jobId"], "accepted": provider.cancel(params["jobId"])}
            elif method == "bibit.cancel":
                continue
            elif method == "bibit.shutdown":
                break
            else:
                raise ValueError("unknown method")
            provider._emit({"jsonrpc": "2.0", "id": request_id, "result": result})
        except Exception:
            provider._emit({"jsonrpc": "2.0", "id": message.get("id") if isinstance(message, dict) else None, "error": {"code": -32602, "message": "Invalid Provider request", "data": {"code": "incompatible"}}})


def self_test() -> None:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        events: list[dict[str, Any]] = []
        provider = Provider(root, events.append)
        source = root / "transfers" / "self-test" / "input.bin"
        source.parent.mkdir(parents=True)
        source.write_bytes(b"agenthub-demo" * 100_000)
        upload = {"serviceId": "store", "jobId": "upload", "operationId": "agents.upload.v1", "input": {"displayName": "Self Test"}, "resources": [{"resourcePath": "transfers/self-test/input.bin", "byteLength": source.stat().st_size}]}
        assert provider.start(upload)
        while provider._active:
            time.sleep(0.01)
        uploaded = next(event for event in events if event["params"]["kind"] == "result_ready")
        agent_id = uploaded["params"]["result"]["output"]["agentId"]
        expected = hashlib.sha256(source.read_bytes()).hexdigest()
        events.clear()
        output = root / "transfers" / "self-test" / "output.bin"
        output.touch()
        download = {"serviceId": "store", "jobId": "download", "operationId": "agents.download.v1", "input": {"agentId": agent_id}, "resources": [{"resourcePath": "transfers/self-test/output.bin", "byteLength": 0}]}
        assert provider.start(download)
        while provider._active:
            time.sleep(0.01)
        assert hashlib.sha256(output.read_bytes()).hexdigest() == expected
        events.clear()
        provider.delay = 0.02
        output.unlink()
        output.touch()
        cancel = {**download, "jobId": "cancel"}
        assert provider.start(cancel)
        assert provider.cancel("cancel")
        while provider._active:
            time.sleep(0.01)
        assert any(event["params"]["kind"] == "cancelled" for event in events)
        print(json.dumps({"ok": True, "sha256": expected, "bytes": source.stat().st_size}))


if __name__ == "__main__":
    arguments = argparse.ArgumentParser()
    arguments.add_argument("provider", nargs="?")
    arguments.add_argument("--self-test", action="store_true")
    options = arguments.parse_args()
    if options.self_test:
        self_test()
    else:
        serve(Provider(Path(os.environ["BIBIT_PROVIDER_DATA_DIR"])))
