FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# server.py's __main__ serves Streamable HTTP on $PORT (defaults to 8080).
# We ship this Dockerfile so Cloud Build doesn't auto-generate one that runs
# `python -m fastmcp` (which is not a valid entry point on FastMCP 2.x/3.x).
CMD ["python", "server.py"]
