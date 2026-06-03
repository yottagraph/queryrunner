# MCP Server Development (FastMCP)

> **Are you trying to USE the Lovelace platform MCP servers (`elemental`,
> `stocks`, `wiki`, `polymarket`), not build a new one?** Wrong file —
> see [data.md](data.md) § "Lovelace MCP Servers" for how to call them
> programmatically, interpret responses, and translate the
> `.agents/mcp.json` `lovelace-*` aliases into real URLs.

This project supports developing and deploying **custom** MCP (Model
Context Protocol) servers alongside the UI. Servers live in the
`mcp-servers/` directory and deploy to Google Cloud Run via the
`/deploy_mcp` command.

MCP servers expose tools that agents can call. They act as bridges
between AI agents and external data sources or APIs.

## Directory Structure

Each MCP server is a self-contained Python package:

```
mcp-servers/<server-name>/
├── server.py           # Required: FastMCP server definition, must define `mcp = FastMCP("...")`
├── requirements.txt    # Required: must include fastmcp
└── Dockerfile          # Optional: auto-generated if missing
```

## Writing an MCP Server

Use [FastMCP](https://github.com/jlowin/fastmcp) (v2.x) to define servers:

```python
import os
from fastmcp import FastMCP

mcp = FastMCP("my-data-server")

@mcp.tool()
def search_records(query: str, limit: int = 10) -> list[dict]:
    """Search records matching the query.

    Args:
        query: Search text to match against record names and descriptions.
        limit: Maximum number of results to return.

    Returns:
        List of matching records with id, name, and description fields.
    """
    # Your implementation here
    return [{"id": "1", "name": "Example", "description": "..."}]

@mcp.tool()
def get_record(record_id: str) -> dict:
    """Get a specific record by ID.

    Args:
        record_id: The unique identifier of the record.

    Returns:
        The full record with all fields.
    """
    return {"id": record_id, "name": "Example", "data": {}}

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    mcp.run(transport="sse", host="0.0.0.0", port=port)
```

Key rules:

- The FastMCP instance MUST be named `mcp` — the Dockerfile runs `fastmcp run server:mcp` to find it
- FastMCP 2.x takes a single positional name argument: `FastMCP("name")`. Do NOT pass `name=` or `description=` as keyword arguments
- Use `@mcp.tool()` decorators to define tools
- Tool docstrings are essential: agents read them to understand the tool's purpose, parameters, and return values
- Use type hints on all tool parameters and return values

## Local Testing

Test MCP servers locally:

```bash
cd mcp-servers/<server-name>
pip install -r requirements.txt
python server.py
```

This starts the server on port 8080 (or `$PORT`). You can also use the FastMCP CLI, which matches the production Dockerfile entry point:

```bash
python -m fastmcp run server:mcp --transport streamable-http --host 0.0.0.0 --port 8080
```

## Deployment

Deploy with the `/deploy_mcp` Cursor command. This will:

1. Build a container image via Cloud Build
2. Deploy to Cloud Run with IAM authentication
3. Grant invoker permissions to tenant and Portal service accounts
4. Register the server in Firestore (via the Portal API)
5. Add the server to `.agents/mcp.json` for agent access (Cursor and Claude Code)

## Connecting MCP Servers to Agents

Once deployed, agents can connect to your MCP server. Add the Cloud Run URL to your agent's MCP configuration. The agent's service account (from `broadchurch.yaml`) is already authorized to invoke the server.

## MCP Server Design Guidelines

- One server per data domain or external service
- Keep tools focused and well-documented
- Return structured data (dicts/lists), not raw strings — MCP handles serialization via the protocol. (This differs from ADK agent tools, which should return formatted strings because the LLM reads tool output directly — see [agents.md](agents.md) in this skill.)
- Handle errors by returning descriptive error messages in the response
- Use environment variables for API keys and configuration (never hardcode secrets)
- For secrets, use GCP Secret Manager and access at runtime
