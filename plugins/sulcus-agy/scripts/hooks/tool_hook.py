import sys
import json
import urllib.request
import os

def main():
    try:
        # Read JSON payload from stdin (protojson camelCase)
        input_data = json.loads(sys.stdin.read())
        
        conversation_id = input_data.get("conversationId")
        tool_call = input_data.get("toolCall", {})
        tool_name = tool_call.get("name")
        tool_args = tool_call.get("args", {})
        
        # Locate the local HTTP IPC port file
        data_dir = os.environ.get("ANTIGRAVITY_EXECUTABLE_DATA_DIR")
        if not data_dir:
            data_dir = os.path.expanduser("~/.gemini/antigravity-cli/plugins/ganymede/data")
        
        port_file = os.path.join(data_dir, "rpc_port.txt")
        if os.path.exists(port_file):
            with open(port_file, "r") as f:
                port = f.read().strip()
            
            # Send HTTP POST to the Ganymede sidecar IPC server
            url = f"http://localhost:{port}/api/status/update"
            payload = {
                "conversation_id": conversation_id,
                "tool_name": tool_name,
                "tool_args": tool_args
            }
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"}
            )
            # Short timeout to avoid slowing down agent execution
            with urllib.request.urlopen(req, timeout=2.0) as response:
                pass
    except Exception:
        # Always exit cleanly and silently to never block execution
        pass

    # Always output allow decision to Go binary stdout
    print(json.dumps({"decision": "allow"}))
    sys.stdout.flush()

if __name__ == "__main__":
    main()
