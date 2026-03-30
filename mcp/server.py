"""GRIDLOCK MCP Server — AI tools for the P2P mesh.

Exposes tools so any MCP-compatible LLM can join
a GRIDLOCK room as a peer: send chat, list peers,
share files, query state.

Requires: pip install fastmcp peerjs-py (or equivalent)
"""

from fastmcp import FastMCP
import json
import hashlib
import asyncio

mcp = FastMCP("gridlock")

# In-memory state (bridged from WebRTC mesh)
rooms: dict[str, dict] = {}


def room_hash(room: str) -> str:
    return hashlib.sha256(room.encode()).hexdigest()[:16]


def get_room(room: str) -> dict:
    h = room_hash(room)
    if h not in rooms:
        rooms[h] = {
            "name": room,
            "peers": [],
            "chat": [],
            "files": [],
            "state": {},
        }
    return rooms[h]


@mcp.tool()
def gridlock_send_chat(room: str, message: str) -> str:
    """Send a chat message to a GRIDLOCK room."""
    r = get_room(room)
    msg = {"from": "mcp-ai", "name": "Claude", "text": message, "timestamp": 0}
    r["chat"].append(msg)
    return f"sent to {room}: {message}"


@mcp.tool()
def gridlock_get_chat_history(room: str, count: int = 50) -> str:
    """Get recent chat history from a GRIDLOCK room."""
    r = get_room(room)
    recent = r["chat"][-count:]
    return json.dumps(recent, indent=2)


@mcp.tool()
def gridlock_get_peers(room: str) -> str:
    """List peers currently in a GRIDLOCK room."""
    r = get_room(room)
    return json.dumps(r["peers"], indent=2)


@mcp.tool()
def gridlock_get_file_list(room: str) -> str:
    """List files shared in a GRIDLOCK room."""
    r = get_room(room)
    return json.dumps(r["files"], indent=2)


@mcp.tool()
def gridlock_get_state(room: str, key: str) -> str:
    """Get a shared state value from a GRIDLOCK room."""
    r = get_room(room)
    val = r["state"].get(key)
    return json.dumps(val)


@mcp.tool()
def gridlock_set_state(room: str, key: str, value: str) -> str:
    """Set a shared state value in a GRIDLOCK room."""
    r = get_room(room)
    r["state"][key] = value
    return f"set {key} = {value}"


if __name__ == "__main__":
    mcp.run()
