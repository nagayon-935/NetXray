from typing import Any
from pydantic import BaseModel


class CollectRequest(BaseModel):
    topology_name: str
    clab_topology: str | None = None
    credentials: dict[str, str] | None = None


class TopologyMeta(BaseModel):
    name: str
    node_count: int
    link_count: int


class TopologyListResponse(BaseModel):
    topologies: list[TopologyMeta]


class SaveResponse(BaseModel):
    status: str
    name: str


class ConfigGenerateRequest(BaseModel):
    base_ir: dict[str, Any]
    target_ir: dict[str, Any]
    node_id: str
